import { Message, parseMarkdown } from "chat";
import { describe, expect, it, vi } from "vitest";
import { CONNECT_ERROR_MESSAGE, ConvexStateAdapter } from "./index.js";

function createMessage(threadId: string, id: string, text: string) {
  return new Message({
    attachments: [],
    author: {
      fullName: "Alice Example",
      isBot: false,
      isMe: false,
      userId: "user-1",
      userName: "alice",
    },
    formatted: parseMarkdown(text),
    id,
    metadata: {
      dateSent: new Date("2026-01-01T00:00:00.000Z"),
      edited: false,
    },
    raw: { id, text },
    text,
    threadId,
  });
}

function createBackend() {
  const subscriptions = new Set<string>();
  const cache = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const queues = new Map<
    string,
    Array<{
      enqueued_at: number;
      expires_at: number;
      message_id: string;
      message_json: string;
    }>
  >();
  let healthCalls = 0;

  const component = {
    lib: {
      health: Symbol("health"),
      subscribe: Symbol("subscribe"),
      unsubscribe: Symbol("unsubscribe"),
      isSubscribed: Symbol("isSubscribed"),
      acquireLock: Symbol("acquireLock"),
      releaseLock: Symbol("releaseLock"),
      forceReleaseLock: Symbol("forceReleaseLock"),
      extendLock: Symbol("extendLock"),
      get: Symbol("get"),
      set: Symbol("set"),
      setIfNotExists: Symbol("setIfNotExists"),
      delete: Symbol("delete"),
      appendToList: Symbol("appendToList"),
      getList: Symbol("getList"),
      enqueue: Symbol("enqueue"),
      dequeue: Symbol("dequeue"),
      queueDepth: Symbol("queueDepth"),
    },
  } as any;

  const runQuery = vi.fn(async (ref: symbol, args: any) => {
    if (ref === component.lib.health) {
      healthCalls += 1;
      return {
        capabilities: [
          "subscribe",
          "unsubscribe",
          "isSubscribed",
          "acquireLock",
          "releaseLock",
          "forceReleaseLock",
          "extendLock",
          "get",
          "set",
          "setIfNotExists",
          "delete",
          "appendToList",
          "getList",
          "enqueue",
          "dequeue",
          "queueDepth",
          "cleanupExpiredState",
        ],
        version: "0.1.0",
      };
    }
    const key = `${args.keyPrefix}:${args.threadId ?? args.key}`;
    if (ref === component.lib.isSubscribed) {
      return subscriptions.has(key);
    }
    if (ref === component.lib.get) {
      return cache.get(key) ?? null;
    }
    if (ref === component.lib.getList) {
      return lists.get(key) ?? [];
    }
    if (ref === component.lib.queueDepth) {
      return queues.get(key)?.length ?? 0;
    }
    throw new Error(`Unhandled query ref: ${String(ref)}`);
  });

  const runMutation = vi.fn(async (ref: symbol, args: any) => {
    const key = `${args.keyPrefix}:${args.threadId ?? args.key}`;
    if (ref === component.lib.subscribe) {
      subscriptions.add(key);
      return null;
    }
    if (ref === component.lib.unsubscribe) {
      subscriptions.delete(key);
      return null;
    }
    if (ref === component.lib.acquireLock) {
      return {
        expiresAt: Date.now() + args.ttlMs,
        threadId: args.threadId,
        token: "lock-token",
      };
    }
    if (
      ref === component.lib.releaseLock ||
      ref === component.lib.forceReleaseLock ||
      ref === component.lib.extendLock
    ) {
      return ref === component.lib.extendLock ? true : null;
    }
    if (ref === component.lib.set) {
      cache.set(key, args.valueJson);
      return null;
    }
    if (ref === component.lib.setIfNotExists) {
      if (cache.has(key)) {
        return false;
      }
      cache.set(key, args.valueJson);
      return true;
    }
    if (ref === component.lib.delete) {
      cache.delete(key);
      return null;
    }
    if (ref === component.lib.appendToList) {
      const current = [...(lists.get(key) ?? []), args.valueJson];
      const trimmed =
        args.maxLength && current.length > args.maxLength
          ? current.slice(current.length - args.maxLength)
          : current;
      lists.set(key, trimmed);
      return null;
    }
    if (ref === component.lib.enqueue) {
      const current = [...(queues.get(key) ?? []), args.entry];
      queues.set(key, current);
      return current.length;
    }
    if (ref === component.lib.dequeue) {
      const current = queues.get(key) ?? [];
      const next = current.shift() ?? null;
      if (current.length === 0) {
        queues.delete(key);
      } else {
        queues.set(key, current);
      }
      return next;
    }
    throw new Error(`Unhandled mutation ref: ${String(ref)}`);
  });

  return { component, healthCalls: () => healthCalls, runMutation, runQuery };
}

describe("ConvexStateAdapter", () => {
  it("makes connect and disconnect idempotent", async () => {
    const backend = createBackend();
    const adapter = new ConvexStateAdapter({
      component: backend.component,
      runMutation: backend.runMutation as any,
      runQuery: backend.runQuery as any,
    });

    await adapter.connect();
    await adapter.connect();
    expect(backend.healthCalls()).toBe(1);

    await adapter.disconnect();
    await adapter.disconnect();

    await adapter.connect();
    expect(backend.healthCalls()).toBe(2);
  });

  it("throws for operational methods before connect", async () => {
    const backend = createBackend();
    const adapter = new ConvexStateAdapter({
      component: backend.component,
      runMutation: backend.runMutation as any,
      runQuery: backend.runQuery as any,
    });

    await expect(adapter.subscribe("thread-1")).rejects.toThrow(
      CONNECT_ERROR_MESSAGE,
    );
    await expect(adapter.get("cache-1")).rejects.toThrow(CONNECT_ERROR_MESSAGE);
    await expect(
      adapter.appendToList("list-1", { hello: "world" }),
    ).rejects.toThrow(CONNECT_ERROR_MESSAGE);
    await expect(
      adapter.enqueue(
        "thread-1",
        {
          enqueuedAt: 1,
          expiresAt: 2,
          message: createMessage("thread-1", "msg-1", "hello"),
        },
        5,
      ),
    ).rejects.toThrow(CONNECT_ERROR_MESSAGE);
  });

  it("forwards keyPrefix on every backend call", async () => {
    const backend = createBackend();
    const adapter = new ConvexStateAdapter({
      component: backend.component,
      keyPrefix: "stagehand",
      runMutation: backend.runMutation as any,
      runQuery: backend.runQuery as any,
    });

    await adapter.connect();
    await adapter.subscribe("thread-1");
    await adapter.isSubscribed("thread-1");
    await adapter.acquireLock("thread-1", 1000);
    await adapter.set("cache-1", { ok: true });
    await adapter.get("cache-1");
    await adapter.setIfNotExists("cache-2", { ok: true });
    await adapter.appendToList("list-1", { value: 1 }, { maxLength: 2 });
    await adapter.getList("list-1");
    await adapter.enqueue(
      "thread-1",
      {
        enqueuedAt: 10,
        expiresAt: 20,
        message: createMessage("thread-1", "msg-1", "hello"),
      },
      5,
    );
    await adapter.queueDepth("thread-1");
    await adapter.dequeue("thread-1");
    await adapter.delete("cache-1");
    await adapter.unsubscribe("thread-1");

    const prefixedCalls = [
      ...backend.runQuery.mock.calls,
      ...backend.runMutation.mock.calls,
    ]
      .map(([, args]) => args)
      .filter((args) => args && typeof args === "object" && "keyPrefix" in args);

    expect(prefixedCalls.length).toBeGreaterThan(0);
    expect(prefixedCalls.every((args) => args.keyPrefix === "stagehand")).toBe(
      true,
    );
  });

  it("round-trips JSON values for cache, lists, and queues", async () => {
    const backend = createBackend();
    const adapter = new ConvexStateAdapter({
      component: backend.component,
      runMutation: backend.runMutation as any,
      runQuery: backend.runQuery as any,
    });
    const message = createMessage("thread-1", "msg-1", "hello");

    await adapter.connect();

    await adapter.set("cache-1", {
      nested: { ok: true },
      values: [1, 2, 3],
    });
    expect(await adapter.get("cache-1")).toEqual({
      nested: { ok: true },
      values: [1, 2, 3],
    });

    await adapter.appendToList("list-1", { index: 1 });
    await adapter.appendToList("list-1", { index: 2 });
    expect(await adapter.getList("list-1")).toEqual([
      { index: 1 },
      { index: 2 },
    ]);

    await adapter.enqueue(
      "thread-1",
      {
        enqueuedAt: 100,
        expiresAt: 200,
        message,
      },
      5,
    );
    expect(await adapter.dequeue("thread-1")).toEqual({
      enqueuedAt: 100,
      expiresAt: 200,
      message: message.toJSON(),
    });
  });
});
