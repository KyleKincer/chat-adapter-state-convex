export const PACKAGE_VERSION = "0.1.0";
export const DEFAULT_KEY_PREFIX = "chat-sdk";
export const DEFAULT_CLEANUP_LIMIT_PER_TABLE = 100;
export const NO_EXPIRY = Number.MAX_SAFE_INTEGER;

export const BACKEND_CAPABILITIES = [
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
] as const;

export type BackendCapability = (typeof BACKEND_CAPABILITIES)[number];

export type HealthResponse = {
  capabilities: BackendCapability[];
  version: string;
};

export type StoredQueueEntry = {
  enqueued_at: number;
  expires_at: number;
  message_id: string;
  message_json: string;
};

export type CleanupExpiredStateResult = {
  cache_removed: number;
  lists_removed: number;
  locks_removed: number;
  queue_docs_deleted: number;
  queue_docs_pruned: number;
  queue_entries_pruned: number;
};
