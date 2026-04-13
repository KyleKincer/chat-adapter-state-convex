import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { storedQueueEntryValidator } from "./schema.js";
import {
  BACKEND_CAPABILITIES,
  DEFAULT_CLEANUP_LIMIT_PER_TABLE,
  NO_EXPIRY,
  PACKAGE_VERSION,
  type StoredQueueEntry,
} from "../shared.js";

const keyPrefixValidator = v.string();
const threadIdValidator = v.string();
const cacheKeyValidator = v.string();
const listKeyValidator = v.string();
const valueJsonValidator = v.string();
const ttlMsValidator = v.number();
const maxLengthValidator = v.optional(v.number());
const limitPerTableValidator = v.optional(v.number());

const lockValidator = v.object({
  threadId: v.string(),
  token: v.string(),
  expiresAt: v.number(),
});

const dequeueResultValidator = v.union(storedQueueEntryValidator, v.null());
const nullableStringValidator = v.union(v.string(), v.null());

function now() {
  return Date.now();
}

function computeExpiresAt(nowMs: number, ttlMs?: number) {
  return ttlMs === undefined ? NO_EXPIRY : nowMs + ttlMs;
}

function isExpired(expiresAt: number, nowMs: number) {
  return expiresAt <= nowMs;
}

function sortQueueEntries(entries: StoredQueueEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.enqueued_at !== right.enqueued_at) {
      return left.enqueued_at - right.enqueued_at;
    }
    return left.message_id.localeCompare(right.message_id);
  });
}

function pruneQueueEntries(entries: StoredQueueEntry[], nowMs: number) {
  return sortQueueEntries(
    entries.filter((entry) => !isExpired(entry.expires_at, nowMs)),
  );
}

function nextQueueExpiry(entries: StoredQueueEntry[]) {
  return entries.reduce(
    (min, entry) => Math.min(min, entry.expires_at),
    NO_EXPIRY,
  );
}

function pickNewestByUpdated<T extends { _creationTime: number; updated_at: number }>(
  docs: T[],
) {
  return [...docs].sort((left, right) => {
    if (left.updated_at !== right.updated_at) {
      return right.updated_at - left.updated_at;
    }
    return right._creationTime - left._creationTime;
  })[0];
}

function pickNewestByCreated<T extends { _creationTime: number; created_at: number }>(
  docs: T[],
) {
  return [...docs].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return right.created_at - left.created_at;
    }
    return right._creationTime - left._creationTime;
  })[0];
}

type DbCtx = { db: any };

async function getSubscriptionDocs(
  ctx: DbCtx,
  keyPrefix: string,
  threadId: string,
): Promise<Doc<"subscriptions">[]> {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_prefix_thread", (q: any) =>
      q.eq("key_prefix", keyPrefix).eq("thread_id", threadId),
    )
    .collect();
}

async function getLockDocs(
  ctx: DbCtx,
  keyPrefix: string,
  threadId: string,
): Promise<Doc<"locks">[]> {
  return await ctx.db
    .query("locks")
    .withIndex("by_prefix_thread", (q: any) =>
      q.eq("key_prefix", keyPrefix).eq("thread_id", threadId),
    )
    .collect();
}

async function getCacheDocs(
  ctx: DbCtx,
  keyPrefix: string,
  cacheKey: string,
): Promise<Doc<"cache">[]> {
  return await ctx.db
    .query("cache")
    .withIndex("by_prefix_key", (q: any) =>
      q.eq("key_prefix", keyPrefix).eq("cache_key", cacheKey),
    )
    .collect();
}

async function getListDocs(
  ctx: DbCtx,
  keyPrefix: string,
  listKey: string,
): Promise<Doc<"lists">[]> {
  return await ctx.db
    .query("lists")
    .withIndex("by_prefix_key", (q: any) =>
      q.eq("key_prefix", keyPrefix).eq("list_key", listKey),
    )
    .collect();
}

async function getQueueDocs(
  ctx: DbCtx,
  keyPrefix: string,
  threadId: string,
): Promise<Doc<"queues">[]> {
  return await ctx.db
    .query("queues")
    .withIndex("by_prefix_thread", (q: any) =>
      q.eq("key_prefix", keyPrefix).eq("thread_id", threadId),
    )
    .collect();
}

async function deleteDocs(ctx: DbCtx, docs: Array<{ _id: string }>) {
  await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
}

function lockResponse(threadId: string, token: string, expiresAt: number) {
  return { threadId, token, expiresAt };
}

export const health = query({
  args: {},
  returns: v.object({
    capabilities: v.array(v.string()),
    version: v.string(),
  }),
  handler: async () => {
    return {
      capabilities: [...BACKEND_CAPABILITIES],
      version: PACKAGE_VERSION,
    };
  },
});

export const isSubscribed = query({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const docs = await getSubscriptionDocs(ctx, args.keyPrefix, args.threadId);
    return docs.length > 0;
  },
});

export const get = query({
  args: {
    keyPrefix: keyPrefixValidator,
    key: cacheKeyValidator,
  },
  returns: nullableStringValidator,
  handler: async (ctx, args) => {
    const docs = await getCacheDocs(ctx, args.keyPrefix, args.key);
    const current = pickNewestByUpdated(
      docs.filter((doc) => !isExpired(doc.expires_at, now())),
    );
    return current?.value_json ?? null;
  },
});

export const getList = query({
  args: {
    keyPrefix: keyPrefixValidator,
    key: listKeyValidator,
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const docs = await getListDocs(ctx, args.keyPrefix, args.key);
    const current = pickNewestByUpdated(
      docs.filter((doc) => !isExpired(doc.expires_at, now())),
    );
    return current?.values_json ?? [];
  },
});

export const queueDepth = query({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const docs = await getQueueDocs(ctx, args.keyPrefix, args.threadId);
    const current = pickNewestByUpdated(docs);
    if (!current) {
      return 0;
    }
    return pruneQueueEntries(current.entries, now()).length;
  },
});

export const subscribe = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await getSubscriptionDocs(ctx, args.keyPrefix, args.threadId);
    if (docs.length === 0) {
      await ctx.db.insert("subscriptions", {
        key_prefix: args.keyPrefix,
        thread_id: args.threadId,
        created_at: now(),
      });
      return null;
    }
    const keep = pickNewestByCreated(docs);
    if (keep) {
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== keep._id),
      );
    }
    return null;
  },
});

export const unsubscribe = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await getSubscriptionDocs(ctx, args.keyPrefix, args.threadId);
    await deleteDocs(ctx, docs);
    return null;
  },
});

export const acquireLock = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
    ttlMs: ttlMsValidator,
  },
  returns: v.union(lockValidator, v.null()),
  handler: async (ctx, args) => {
    const nowMs = now();
    const expiresAt = nowMs + args.ttlMs;
    const docs = await getLockDocs(ctx, args.keyPrefix, args.threadId);
    const liveLock = pickNewestByUpdated(
      docs.filter((doc) => !isExpired(doc.expires_at, nowMs)),
    );
    if (liveLock) {
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== liveLock._id),
      );
      return null;
    }

    const token = crypto.randomUUID();
    const current = pickNewestByUpdated(docs);
    if (current) {
      await ctx.db.patch(current._id, {
        token,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    } else {
      await ctx.db.insert("locks", {
        key_prefix: args.keyPrefix,
        thread_id: args.threadId,
        token,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
    }

    return lockResponse(args.threadId, token, expiresAt);
  },
});

export const releaseLock = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    lock: lockValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await getLockDocs(ctx, args.keyPrefix, args.lock.threadId);
    await deleteDocs(
      ctx,
      docs.filter((doc) => doc.token === args.lock.token),
    );
    return null;
  },
});

export const forceReleaseLock = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await getLockDocs(ctx, args.keyPrefix, args.threadId);
    await deleteDocs(ctx, docs);
    return null;
  },
});

export const extendLock = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    lock: lockValidator,
    ttlMs: ttlMsValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getLockDocs(ctx, args.keyPrefix, args.lock.threadId);
    const matching = pickNewestByUpdated(
      docs.filter((doc) => doc.token === args.lock.token),
    );
    if (!matching) {
      return false;
    }
    if (isExpired(matching.expires_at, nowMs)) {
      await deleteDocs(ctx, docs.filter((doc) => doc.token === args.lock.token));
      return false;
    }
    await ctx.db.patch(matching._id, {
      expires_at: nowMs + args.ttlMs,
      updated_at: nowMs,
    });
    await deleteDocs(
      ctx,
      docs.filter((doc) => doc._id !== matching._id && doc.token === args.lock.token),
    );
    return true;
  },
});

export const set = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    key: cacheKeyValidator,
    valueJson: valueJsonValidator,
    ttlMs: v.optional(ttlMsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getCacheDocs(ctx, args.keyPrefix, args.key);
    const current = pickNewestByUpdated(docs);
    const expiresAt = computeExpiresAt(nowMs, args.ttlMs);
    if (current) {
      await ctx.db.patch(current._id, {
        value_json: args.valueJson,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    } else {
      await ctx.db.insert("cache", {
        key_prefix: args.keyPrefix,
        cache_key: args.key,
        value_json: args.valueJson,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
    }
    return null;
  },
});

export const setIfNotExists = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    key: cacheKeyValidator,
    valueJson: valueJsonValidator,
    ttlMs: v.optional(ttlMsValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getCacheDocs(ctx, args.keyPrefix, args.key);
    const live = pickNewestByUpdated(
      docs.filter((doc) => !isExpired(doc.expires_at, nowMs)),
    );
    if (live) {
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== live._id && !isExpired(doc.expires_at, nowMs)),
      );
      return false;
    }

    const current = pickNewestByUpdated(docs);
    const expiresAt = computeExpiresAt(nowMs, args.ttlMs);
    if (current) {
      await ctx.db.patch(current._id, {
        value_json: args.valueJson,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    } else {
      await ctx.db.insert("cache", {
        key_prefix: args.keyPrefix,
        cache_key: args.key,
        value_json: args.valueJson,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
    }
    return true;
  },
});

export const deleteValue = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    key: cacheKeyValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await getCacheDocs(ctx, args.keyPrefix, args.key);
    await deleteDocs(ctx, docs);
    return null;
  },
});

export { deleteValue as delete };

export const appendToList = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    key: listKeyValidator,
    valueJson: valueJsonValidator,
    maxLength: maxLengthValidator,
    ttlMs: v.optional(ttlMsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getListDocs(ctx, args.keyPrefix, args.key);
    const current = pickNewestByUpdated(docs);
    const liveCurrent =
      current && !isExpired(current.expires_at, nowMs) ? current : undefined;

    let values = liveCurrent ? [...liveCurrent.values_json] : [];
    values.push(args.valueJson);

    if (args.maxLength !== undefined && args.maxLength > 0 && values.length > args.maxLength) {
      values = values.slice(values.length - args.maxLength);
    }

    const expiresAt =
      args.ttlMs !== undefined
        ? nowMs + args.ttlMs
        : liveCurrent?.expires_at ?? NO_EXPIRY;

    if (current) {
      await ctx.db.patch(current._id, {
        values_json: values,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    } else {
      await ctx.db.insert("lists", {
        key_prefix: args.keyPrefix,
        list_key: args.key,
        values_json: values,
        expires_at: expiresAt,
        updated_at: nowMs,
      });
    }
    return null;
  },
});

export const enqueue = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
    entry: storedQueueEntryValidator,
    maxSize: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getQueueDocs(ctx, args.keyPrefix, args.threadId);
    const current = pickNewestByUpdated(docs);
    const liveEntries = current ? pruneQueueEntries(current.entries, nowMs) : [];

    let entries = sortQueueEntries([...liveEntries, args.entry]);
    if (args.maxSize > 0 && entries.length > args.maxSize) {
      entries = entries.slice(entries.length - args.maxSize);
    }

    const updatedAt = nowMs;
    const nextExpiryAt = nextQueueExpiry(entries);
    if (current) {
      await ctx.db.patch(current._id, {
        entries,
        next_expiry_at: nextExpiryAt,
        updated_at: updatedAt,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    } else {
      await ctx.db.insert("queues", {
        key_prefix: args.keyPrefix,
        thread_id: args.threadId,
        entries,
        next_expiry_at: nextExpiryAt,
        updated_at: updatedAt,
      });
    }

    return entries.length;
  },
});

export const dequeue = mutation({
  args: {
    keyPrefix: keyPrefixValidator,
    threadId: threadIdValidator,
  },
  returns: dequeueResultValidator,
  handler: async (ctx, args) => {
    const nowMs = now();
    const docs = await getQueueDocs(ctx, args.keyPrefix, args.threadId);
    const current = pickNewestByUpdated(docs);
    if (!current) {
      return null;
    }

    const liveEntries = pruneQueueEntries(current.entries, nowMs);
    if (liveEntries.length === 0) {
      await deleteDocs(ctx, docs);
      return null;
    }

    const [nextEntry, ...remaining] = liveEntries;
    if (remaining.length === 0) {
      await deleteDocs(ctx, docs);
    } else {
      await ctx.db.patch(current._id, {
        entries: remaining,
        next_expiry_at: nextQueueExpiry(remaining),
        updated_at: nowMs,
      });
      await deleteDocs(
        ctx,
        docs.filter((doc) => doc._id !== current._id),
      );
    }

    return nextEntry;
  },
});

export const cleanupExpiredState = mutation({
  args: {
    limitPerTable: limitPerTableValidator,
  },
  returns: v.object({
    cache_removed: v.number(),
    lists_removed: v.number(),
    locks_removed: v.number(),
    queue_docs_deleted: v.number(),
    queue_docs_pruned: v.number(),
    queue_entries_pruned: v.number(),
  }),
  handler: async (ctx, args) => {
    const nowMs = now();
    const limit = Math.max(1, args.limitPerTable ?? DEFAULT_CLEANUP_LIMIT_PER_TABLE);

    const expiredLocks = await ctx.db
      .query("locks")
      .withIndex("by_expires_at", (q) => q.lte("expires_at", nowMs))
      .take(limit);
    await deleteDocs(ctx, expiredLocks);

    const expiredCache = await ctx.db
      .query("cache")
      .withIndex("by_expires_at", (q) => q.lte("expires_at", nowMs))
      .take(limit);
    await deleteDocs(ctx, expiredCache);

    const expiredLists = await ctx.db
      .query("lists")
      .withIndex("by_expires_at", (q) => q.lte("expires_at", nowMs))
      .take(limit);
    await deleteDocs(ctx, expiredLists);

    const expiredQueues = await ctx.db
      .query("queues")
      .withIndex("by_next_expiry_at", (q) => q.lte("next_expiry_at", nowMs))
      .take(limit);

    let queueDocsDeleted = 0;
    let queueDocsPruned = 0;
    let queueEntriesPruned = 0;

    for (const queueDoc of expiredQueues) {
      const liveEntries = pruneQueueEntries(queueDoc.entries, nowMs);
      queueEntriesPruned += queueDoc.entries.length - liveEntries.length;

      if (liveEntries.length === 0) {
        await ctx.db.delete(queueDoc._id);
        queueDocsDeleted += 1;
        continue;
      }

      await ctx.db.patch(queueDoc._id, {
        entries: liveEntries,
        next_expiry_at: nextQueueExpiry(liveEntries),
        updated_at: nowMs,
      });
      queueDocsPruned += 1;
    }

    return {
      cache_removed: expiredCache.length,
      lists_removed: expiredLists.length,
      locks_removed: expiredLocks.length,
      queue_docs_deleted: queueDocsDeleted,
      queue_docs_pruned: queueDocsPruned,
      queue_entries_pruned: queueEntriesPruned,
    };
  },
});
