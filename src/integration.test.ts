import {
  Chat,
  Message,
  type Adapter,
  type Message as ChatMessage,
  type RawMessage,
  type Thread,
  parseMarkdown,
} from "chat";
import { componentsGeneric } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { createConvexState } from "./client/index.js";
import type { ComponentApi } from "./component/_generated/component.js";
import { modules, register } from "./test.js";

type MockRawMessage = {
  authorId: string;
  authorName: string;
  id: string;
  isBot: boolean;
  text: string;
  threadId: string;
  timestamp: string;
};

function createMessage(
  threadId: string,
  id: string,
  text: string,
  options?: { isBot?: boolean; userId?: string; userName?: string },
) {
  return new Message({
    attachments: [],
    author: {
      fullName: options?.userName ?? "Alice Example",
      isBot: options?.isBot ?? false,
      isMe: false,
      userId: options?.userId ?? "user-1",
      userName: options?.userName ?? "alice",
    },
    formatted: parseMarkdown(text),
    id,
    metadata: {
      dateSent: new Date("2026-01-01T00:00:00.000Z"),
      edited: false,
    },
    raw: {
      authorId: options?.userId ?? "user-1",
      authorName: options?.userName ?? "alice",
      id,
      isBot: options?.isBot ?? false,
      text,
      threadId,
      timestamp: "2026-01-01T00:00:00.000Z",
    } satisfies MockRawMessage,
    text,
    threadId,
  });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockAdapter(options?: { persistMessageHistory?: boolean }) {
  const threadMessages = new Map<string, ChatMessage<MockRawMessage>[]>();
  const postedMessages: MockRawMessage[] = [];

  function channelIdFromThreadId(threadId: string) {
    const parts = threadId.split(":");
    if (parts[1] === "dm") {
      return threadId;
    }
    return parts.slice(0, 3).join(":");
  }

  function messageFromRaw(raw: MockRawMessage) {
    return createMessage(raw.threadId, raw.id, raw.text, {
      isBot: raw.isBot,
      userId: raw.authorId,
      userName: raw.authorName,
    });
  }

  function rawMessage(threadId: string, text: string): RawMessage<MockRawMessage> {
    const raw = {
      authorId: "mock-bot",
      authorName: "mock-bot",
      id: `sent-${postedMessages.length + 1}`,
      isBot: true,
      text,
      threadId,
      timestamp: new Date().toISOString(),
    } satisfies MockRawMessage;
    return {
      id: raw.id,
      raw,
      threadId,
    };
  }

  const adapter = {
    name: "mock",
    userName: "bot",
    persistMessageHistory: options?.persistMessageHistory,
    async addReaction() {},
    channelIdFromThreadId,
    decodeThreadId(threadId: string) {
      return threadId;
    },
    async deleteMessage() {},
    async editMessage(threadId: string, _messageId: string, message: unknown) {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      return rawMessage(threadId, text);
    },
    encodeThreadId(threadId: string) {
      return threadId;
    },
    async fetchMessages(threadId: string) {
      return {
        messages: threadMessages.get(threadId) ?? [],
        nextCursor: undefined,
      } as any;
    },
    async fetchThread(threadId: string) {
      return {
        id: threadId,
        lastMessageAt: null,
        participantCount: 0,
        raw: null,
        replyCount: 0,
        title: null,
      } as any;
    },
    async handleWebhook() {
      return new Response("not implemented", { status: 501 });
    },
    async initialize() {},
    isDM(threadId: string) {
      return threadId.startsWith("mock:dm:");
    },
    parseMessage(raw: MockRawMessage) {
      return messageFromRaw(raw);
    },
    async postMessage(threadId: string, message: unknown) {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      const raw = rawMessage(threadId, text);
      postedMessages.push(raw.raw);
      const parsed = messageFromRaw(raw.raw);
      threadMessages.set(threadId, [...(threadMessages.get(threadId) ?? []), parsed]);
      return raw;
    },
    async removeReaction() {},
    renderFormatted() {
      return "";
    },
    async startTyping() {},
  } satisfies Adapter<string, MockRawMessage>;

  return { adapter, postedMessages };
}

function createHarness(options?: {
  concurrency?: "queue" | "debounce";
  persistMessageHistory?: boolean;
}) {
  const t = convexTest({ modules });
  register(t, "chatState");

  const components = componentsGeneric() as unknown as {
    chatState: ComponentApi<"chatState">;
  };
  const component = components.chatState;
  const state = createConvexState({
    component,
    keyPrefix: "integration",
    runMutation: ((ref: any, args: any) => t.mutation(ref, args)) as any,
    runQuery: ((ref: any, args: any) => t.query(ref, args)) as any,
  });
  const mock = createMockAdapter({
    persistMessageHistory: options?.persistMessageHistory,
  });
  const chat = new Chat({
    adapters: { mock: mock.adapter },
    concurrency: options?.concurrency,
    logger: "error",
    state,
    userName: "bot",
  });

  return {
    chat,
    postedMessages: mock.postedMessages,
    shutdown: async () => {
      await chat.shutdown();
    },
    state,
    t,
  };
}

async function collectMessages(iterable: AsyncIterable<ChatMessage>) {
  const messages: ChatMessage[] = [];
  for await (const message of iterable) {
    messages.push(message);
  }
  return messages;
}

describe("Chat SDK integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("queue concurrency keeps only the latest queued message and exposes skipped context", async () => {
    const harness = createHarness({ concurrency: "queue" });
    cleanups.push(harness.shutdown);
    await harness.chat.initialize();

    const gate = createDeferred();
    const started = createDeferred();
    const handled: Array<{
      id: string;
      skipped: string[];
      total: number;
    }> = [];
    let first = true;

    harness.chat.onDirectMessage(async (_thread, message, _channel, context) => {
      handled.push({
        id: message.id,
        skipped: context?.skipped.map((entry) => entry.id) ?? [],
        total: context?.totalSinceLastHandler ?? 1,
      });
      if (first) {
        first = false;
        started.resolve();
        await gate.promise;
      }
    });

    const threadId = "mock:dm:alice";
    const firstPromise = harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-1", "hello"),
    );
    await started.promise;

    const secondPromise = harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-2", "second"),
    );
    const thirdPromise = harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-3", "third"),
    );

    await sleep(10);
    gate.resolve();
    await Promise.all([firstPromise, secondPromise, thirdPromise]);

    expect(handled).toEqual([
      { id: "msg-1", skipped: [], total: 1 },
      { id: "msg-3", skipped: ["msg-2"], total: 2 },
    ]);
  });

  it("debounce concurrency keeps only the last message in a burst", async () => {
    const harness = createHarness({ concurrency: "debounce" });
    cleanups.push(harness.shutdown);
    await harness.chat.initialize();

    const handled: string[] = [];
    harness.chat.onDirectMessage(async (_thread, message) => {
      handled.push(message.id);
    });

    const threadId = "mock:dm:alice";
    await Promise.all([
      harness.chat.handleIncomingMessage(
        harness.chat.getAdapter("mock"),
        threadId,
        createMessage(threadId, "msg-1", "one"),
      ),
      harness.chat.handleIncomingMessage(
        harness.chat.getAdapter("mock"),
        threadId,
        createMessage(threadId, "msg-2", "two"),
      ),
      harness.chat.handleIncomingMessage(
        harness.chat.getAdapter("mock"),
        threadId,
        createMessage(threadId, "msg-3", "three"),
      ),
    ]);

    await sleep(50);
    expect(handled).toEqual(["msg-3"]);
  });

  it("dedupe via setIfNotExists suppresses duplicate deliveries", async () => {
    const harness = createHarness();
    cleanups.push(harness.shutdown);
    await harness.chat.initialize();

    const handled: string[] = [];
    harness.chat.onDirectMessage(async (_thread, message) => {
      handled.push(message.id);
    });

    const threadId = "mock:dm:alice";
    const message = createMessage(threadId, "msg-1", "duplicate");
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      message,
    );
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      message,
    );

    expect(handled).toEqual(["msg-1"]);
  });

  it("thread.subscribe persists and thread.isSubscribed works across handler invocations", async () => {
    const harness = createHarness();
    cleanups.push(harness.shutdown);
    await harness.chat.initialize();

    let subscribedFromMention = false;
    const followUpChecks: boolean[] = [];

    harness.chat.onNewMention(async (thread) => {
      await thread.subscribe();
      subscribedFromMention = await thread.isSubscribed();
    });

    harness.chat.onSubscribedMessage(async (thread) => {
      followUpChecks.push(await thread.isSubscribed());
    });

    const threadId = "mock:channel:main:thread:1";
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-1", "@bot hello"),
    );
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-2", "follow up"),
    );

    expect(subscribedFromMention).toBe(true);
    expect(followUpChecks).toEqual([true]);
  });

  it("message history cache backs thread history when the adapter opts in", async () => {
    const harness = createHarness({ persistMessageHistory: true });
    cleanups.push(harness.shutdown);
    await harness.chat.initialize();

    let capturedThread: Thread | null = null;
    harness.chat.onDirectMessage(async (thread) => {
      capturedThread = thread;
    });

    const threadId = "mock:dm:alice";
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-1", "hello"),
    );
    await harness.chat.handleIncomingMessage(
      harness.chat.getAdapter("mock"),
      threadId,
      createMessage(threadId, "msg-2", "again"),
    );

    if (!capturedThread) {
      throw new Error("Expected captured thread");
    }

    const thread = capturedThread as Thread;
    const history = await collectMessages(thread.allMessages);
    expect(history.map((message) => message.text)).toEqual(["hello", "again"]);
  });
});
