/// <reference types="vite/client" />

import { componentsGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentApi } from "./_generated/component.js";
import { modules, register } from "../test.js";

const components = componentsGeneric() as unknown as {
  chatState: ComponentApi<"chatState">;
};
const component = components.chatState;

function createHarness() {
  const t = convexTest({ modules });
  register(t, "chatState");
  return t;
}

function advanceTime(ms: number) {
  vi.advanceTimersByTime(ms);
}

function queueEntry(
  messageId: string,
  enqueuedOffsetMs: number,
  expiresInMs: number,
  payload: Record<string, unknown> = {},
) {
  const base = Date.now();
  return {
    enqueued_at: base + enqueuedOffsetMs,
    expires_at: base + expiresInMs,
    message_id: messageId,
    message_json: JSON.stringify({
      id: messageId,
      ...payload,
    }),
  };
}

describe("chatState component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes, unsubscribes, and reports subscription status idempotently", async () => {
    const t = createHarness();

    expect(
      await t.query(component.lib.isSubscribed, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBe(false);

    await t.mutation(component.lib.subscribe, {
      keyPrefix: "test",
      threadId: "thread-1",
    });
    await t.mutation(component.lib.subscribe, {
      keyPrefix: "test",
      threadId: "thread-1",
    });

    expect(
      await t.query(component.lib.isSubscribed, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBe(true);

    await t.mutation(component.lib.unsubscribe, {
      keyPrefix: "test",
      threadId: "thread-1",
    });

    expect(
      await t.query(component.lib.isSubscribed, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBe(false);
  });

  it("acquires a live lock, rejects a second live lock, and reacquires after expiry", async () => {
    const t = createHarness();

    const first = await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "thread-1",
      ttlMs: 1000,
    });
    expect(first).not.toBeNull();

    const second = await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "thread-1",
      ttlMs: 1000,
    });
    expect(second).toBeNull();

    advanceTime(1001);

    const third = await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "thread-1",
      ttlMs: 1000,
    });
    expect(third).not.toBeNull();
    expect(third?.token).not.toBe(first?.token);
  });

  it("releases matching locks, ignores token mismatches, extends live locks, and force releases", async () => {
    const t = createHarness();
    const lock = await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "thread-1",
      ttlMs: 1000,
    });
    if (!lock) {
      throw new Error("Expected lock");
    }

    await t.mutation(component.lib.releaseLock, {
      keyPrefix: "test",
      lock: {
        ...lock,
        token: "wrong-token",
      },
    });
    expect(
      await t.mutation(component.lib.extendLock, {
        keyPrefix: "test",
        lock,
        ttlMs: 1000,
      }),
    ).toBe(true);

    advanceTime(1001);
    expect(
      await t.mutation(component.lib.extendLock, {
        keyPrefix: "test",
        lock,
        ttlMs: 1000,
      }),
    ).toBe(false);

    const replacement = await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "thread-1",
      ttlMs: 1000,
    });
    if (!replacement) {
      throw new Error("Expected replacement lock");
    }

    await t.mutation(component.lib.releaseLock, {
      keyPrefix: "test",
      lock: replacement,
    });
    expect(
      await t.mutation(component.lib.acquireLock, {
        keyPrefix: "test",
        threadId: "thread-1",
        ttlMs: 1000,
      }),
    ).not.toBeNull();

    await t.mutation(component.lib.forceReleaseLock, {
      keyPrefix: "test",
      threadId: "thread-1",
    });
    expect(
      await t.mutation(component.lib.acquireLock, {
        keyPrefix: "test",
        threadId: "thread-1",
        ttlMs: 1000,
      }),
    ).not.toBeNull();
  });

  it("sets, gets, deletes, and expires cache values", async () => {
    const t = createHarness();

    await t.mutation(component.lib.set, {
      keyPrefix: "test",
      key: "cache-1",
      valueJson: JSON.stringify({ ok: true }),
      ttlMs: 1000,
    });

    expect(
      await t.query(component.lib.get, {
        keyPrefix: "test",
        key: "cache-1",
      }),
    ).toBe(JSON.stringify({ ok: true }));

    advanceTime(1001);
    expect(
      await t.query(component.lib.get, {
        keyPrefix: "test",
        key: "cache-1",
      }),
    ).toBeNull();

    await t.mutation(component.lib.set, {
      keyPrefix: "test",
      key: "cache-1",
      valueJson: JSON.stringify({ ok: "again" }),
    });
    await t.mutation(component.lib.delete, {
      keyPrefix: "test",
      key: "cache-1",
    });

    expect(
      await t.query(component.lib.get, {
        keyPrefix: "test",
        key: "cache-1",
      }),
    ).toBeNull();
  });

  it("setIfNotExists respects live values and treats expired values as absent", async () => {
    const t = createHarness();

    expect(
      await t.mutation(component.lib.setIfNotExists, {
        keyPrefix: "test",
        key: "cache-1",
        valueJson: JSON.stringify({ value: 1 }),
        ttlMs: 1000,
      }),
    ).toBe(true);

    expect(
      await t.mutation(component.lib.setIfNotExists, {
        keyPrefix: "test",
        key: "cache-1",
        valueJson: JSON.stringify({ value: 2 }),
        ttlMs: 1000,
      }),
    ).toBe(false);

    advanceTime(1001);

    expect(
      await t.mutation(component.lib.setIfNotExists, {
        keyPrefix: "test",
        key: "cache-1",
        valueJson: JSON.stringify({ value: 3 }),
        ttlMs: 1000,
      }),
    ).toBe(true);
  });

  it("appends lists in order, trims to max length, and refreshes TTL when provided", async () => {
    const t = createHarness();

    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-1",
      valueJson: JSON.stringify({ index: 1 }),
      maxLength: 3,
      ttlMs: 1000,
    });
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-1",
      valueJson: JSON.stringify({ index: 2 }),
      maxLength: 3,
    });
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-1",
      valueJson: JSON.stringify({ index: 3 }),
      maxLength: 3,
    });
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-1",
      valueJson: JSON.stringify({ index: 4 }),
      maxLength: 3,
      ttlMs: 1000,
    });

    expect(
      await t.query(component.lib.getList, {
        keyPrefix: "test",
        key: "list-1",
      }),
    ).toEqual([
      JSON.stringify({ index: 2 }),
      JSON.stringify({ index: 3 }),
      JSON.stringify({ index: 4 }),
    ]);

    advanceTime(900);
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-1",
      valueJson: JSON.stringify({ index: 5 }),
      maxLength: 4,
      ttlMs: 1000,
    });
    advanceTime(900);

    expect(
      await t.query(component.lib.getList, {
        keyPrefix: "test",
        key: "list-1",
      }),
    ).toEqual([
      JSON.stringify({ index: 2 }),
      JSON.stringify({ index: 3 }),
      JSON.stringify({ index: 4 }),
      JSON.stringify({ index: 5 }),
    ]);
  });

  it("queues messages FIFO, trims to newest max size, and skips expired entries", async () => {
    const t = createHarness();

    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "thread-1",
      entry: queueEntry("b", 20, 5000),
      maxSize: 2,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "thread-1",
      entry: queueEntry("a", 10, 5000),
      maxSize: 2,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "thread-1",
      entry: queueEntry("c", 30, 5000),
      maxSize: 2,
    });

    expect(
      await t.query(component.lib.queueDepth, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBe(2);

    expect(
      await t.mutation(component.lib.dequeue, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toMatchObject({ message_id: "b" });
    expect(
      await t.mutation(component.lib.dequeue, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toMatchObject({ message_id: "c" });
    expect(
      await t.mutation(component.lib.dequeue, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBeNull();

    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "thread-1",
      entry: queueEntry("expired", 10, 100),
      maxSize: 5,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "thread-1",
      entry: queueEntry("live", 20, 5000),
      maxSize: 5,
    });

    advanceTime(101);

    expect(
      await t.query(component.lib.queueDepth, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toBe(1);
    expect(
      await t.mutation(component.lib.dequeue, {
        keyPrefix: "test",
        threadId: "thread-1",
      }),
    ).toMatchObject({ message_id: "live" });
  });

  it("cleanupExpiredState removes expired state and preserves live state", async () => {
    const t = createHarness();

    await t.mutation(component.lib.subscribe, {
      keyPrefix: "test",
      threadId: "thread-live",
    });
    await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "lock-expired",
      ttlMs: 100,
    });
    await t.mutation(component.lib.acquireLock, {
      keyPrefix: "test",
      threadId: "lock-live",
      ttlMs: 5000,
    });
    await t.mutation(component.lib.set, {
      keyPrefix: "test",
      key: "cache-expired",
      valueJson: JSON.stringify({ expired: true }),
      ttlMs: 100,
    });
    await t.mutation(component.lib.set, {
      keyPrefix: "test",
      key: "cache-live",
      valueJson: JSON.stringify({ live: true }),
      ttlMs: 5000,
    });
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-expired",
      valueJson: JSON.stringify({ expired: true }),
      ttlMs: 100,
    });
    await t.mutation(component.lib.appendToList, {
      keyPrefix: "test",
      key: "list-live",
      valueJson: JSON.stringify({ live: true }),
      ttlMs: 5000,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "queue-expired",
      entry: queueEntry("expired-only", 10, 100),
      maxSize: 5,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "queue-mixed",
      entry: queueEntry("expired", 10, 100),
      maxSize: 5,
    });
    await t.mutation(component.lib.enqueue, {
      keyPrefix: "test",
      threadId: "queue-mixed",
      entry: queueEntry("live", 20, 5000),
      maxSize: 5,
    });

    advanceTime(101);

    const result = await t.mutation(component.lib.cleanupExpiredState, {
      limitPerTable: 10,
    });
    expect(result).toMatchObject({
      cache_removed: 1,
      lists_removed: 1,
      locks_removed: 1,
      queue_docs_deleted: 1,
      queue_docs_pruned: 1,
      queue_entries_pruned: 2,
    });

    expect(
      await t.query(component.lib.get, {
        keyPrefix: "test",
        key: "cache-live",
      }),
    ).toBe(JSON.stringify({ live: true }));
    expect(
      await t.query(component.lib.getList, {
        keyPrefix: "test",
        key: "list-live",
      }),
    ).toEqual([JSON.stringify({ live: true })]);
    expect(
      await t.query(component.lib.queueDepth, {
        keyPrefix: "test",
        threadId: "queue-mixed",
      }),
    ).toBe(1);
  });
});
