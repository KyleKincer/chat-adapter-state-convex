import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const storedQueueEntryValidator = v.object({
  enqueued_at: v.number(),
  expires_at: v.number(),
  message_id: v.string(),
  message_json: v.string(),
});

export default defineSchema({
  subscriptions: defineTable({
    key_prefix: v.string(),
    thread_id: v.string(),
    created_at: v.number(),
  }).index("by_prefix_thread", ["key_prefix", "thread_id"]),
  locks: defineTable({
    key_prefix: v.string(),
    thread_id: v.string(),
    token: v.string(),
    expires_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_prefix_thread", ["key_prefix", "thread_id"])
    .index("by_expires_at", ["expires_at"]),
  cache: defineTable({
    key_prefix: v.string(),
    cache_key: v.string(),
    value_json: v.string(),
    expires_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_prefix_key", ["key_prefix", "cache_key"])
    .index("by_expires_at", ["expires_at"]),
  lists: defineTable({
    key_prefix: v.string(),
    list_key: v.string(),
    values_json: v.array(v.string()),
    expires_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_prefix_key", ["key_prefix", "list_key"])
    .index("by_expires_at", ["expires_at"]),
  queues: defineTable({
    key_prefix: v.string(),
    thread_id: v.string(),
    entries: v.array(storedQueueEntryValidator),
    next_expiry_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_prefix_thread", ["key_prefix", "thread_id"])
    .index("by_next_expiry_at", ["next_expiry_at"]),
});
