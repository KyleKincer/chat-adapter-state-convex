import type { QueueEntry } from "chat";
import type { StoredQueueEntry } from "../shared.js";

export function serializeValue(value: unknown) {
  return JSON.stringify(value);
}

export function deserializeValue<T>(valueJson: string) {
  return JSON.parse(valueJson) as T;
}

export function serializeQueueEntry(entry: QueueEntry): StoredQueueEntry {
  return {
    enqueued_at: entry.enqueuedAt,
    expires_at: entry.expiresAt,
    message_id: entry.message.id,
    message_json: serializeValue(entry.message),
  };
}

export function deserializeQueueEntry(entry: StoredQueueEntry): QueueEntry {
  return {
    enqueuedAt: entry.enqueued_at,
    expiresAt: entry.expires_at,
    message: deserializeValue(entry.message_json),
  };
}
