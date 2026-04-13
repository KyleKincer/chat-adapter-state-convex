import { ConsoleLogger, type Lock, type QueueEntry, type StateAdapter } from "chat";
import {
  BACKEND_CAPABILITIES,
  DEFAULT_KEY_PREFIX,
  type HealthResponse,
} from "../shared.js";
import {
  deserializeQueueEntry,
  deserializeValue,
  serializeQueueEntry,
  serializeValue,
} from "./serialize.js";
import type { ConvexStateAdapterOptions } from "./types.js";

const CONNECT_ERROR_MESSAGE =
  "ConvexStateAdapter is not connected. Call connect() first.";

function assertHealth(health: HealthResponse) {
  const missing = BACKEND_CAPABILITIES.filter(
    (capability) => !health.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    throw new Error(
      `Convex state component is missing capabilities: ${missing.join(", ")}`,
    );
  }
}

export class ConvexStateAdapter implements StateAdapter {
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private readonly component;
  private readonly keyPrefix;
  private readonly logger;
  private readonly runMutation;
  private readonly runQuery;

  constructor(options: ConvexStateAdapterOptions) {
    this.component = options.component;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? new ConsoleLogger("info").child("convex");
    this.runMutation = options.runMutation;
    this.runQuery = options.runQuery;
  }

  async connect() {
    if (this.connected) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          const health = (await this.runQuery(this.component.lib.health, {})) as HealthResponse;
          assertHealth(health);
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("Convex connect failed", { error });
          throw error;
        }
      })();
    }
    await this.connectPromise;
  }

  async disconnect() {
    if (!this.connected && !this.connectPromise) {
      return;
    }
    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.subscribe, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
  }

  async unsubscribe(threadId: string) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.unsubscribe, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
  }

  async isSubscribed(threadId: string) {
    this.ensureConnected();
    return await this.runQuery(this.component.lib.isSubscribed, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
  }

  async acquireLock(threadId: string, ttlMs: number) {
    this.ensureConnected();
    return (await this.runMutation(this.component.lib.acquireLock, {
      keyPrefix: this.keyPrefix,
      threadId,
      ttlMs,
    })) as Lock | null;
  }

  async releaseLock(lock: Lock) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.releaseLock, {
      keyPrefix: this.keyPrefix,
      lock,
    });
  }

  async forceReleaseLock(threadId: string) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.forceReleaseLock, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
  }

  async extendLock(lock: Lock, ttlMs: number) {
    this.ensureConnected();
    return await this.runMutation(this.component.lib.extendLock, {
      keyPrefix: this.keyPrefix,
      lock,
      ttlMs,
    });
  }

  async get<T = unknown>(key: string) {
    this.ensureConnected();
    const valueJson = await this.runQuery(this.component.lib.get, {
      keyPrefix: this.keyPrefix,
      key,
    });
    if (valueJson === null) {
      return null;
    }
    return deserializeValue<T>(valueJson);
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.set, {
      keyPrefix: this.keyPrefix,
      key,
      valueJson: serializeValue(value),
      ttlMs,
    });
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number) {
    this.ensureConnected();
    return await this.runMutation(this.component.lib.setIfNotExists, {
      keyPrefix: this.keyPrefix,
      key,
      valueJson: serializeValue(value),
      ttlMs,
    });
  }

  async delete(key: string) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.delete, {
      keyPrefix: this.keyPrefix,
      key,
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: {
      maxLength?: number;
      ttlMs?: number;
    },
  ) {
    this.ensureConnected();
    await this.runMutation(this.component.lib.appendToList, {
      keyPrefix: this.keyPrefix,
      key,
      valueJson: serializeValue(value),
      maxLength: options?.maxLength,
      ttlMs: options?.ttlMs,
    });
  }

  async getList<T = unknown>(key: string) {
    this.ensureConnected();
    const valueJson = await this.runQuery(this.component.lib.getList, {
      keyPrefix: this.keyPrefix,
      key,
    });
    return valueJson.map((item) => deserializeValue<T>(item));
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number) {
    this.ensureConnected();
    return await this.runMutation(this.component.lib.enqueue, {
      keyPrefix: this.keyPrefix,
      threadId,
      entry: serializeQueueEntry(entry),
      maxSize,
    });
  }

  async dequeue(threadId: string) {
    this.ensureConnected();
    const entry = await this.runMutation(this.component.lib.dequeue, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
    if (entry === null) {
      return null;
    }
    return deserializeQueueEntry(entry);
  }

  async queueDepth(threadId: string) {
    this.ensureConnected();
    return await this.runQuery(this.component.lib.queueDepth, {
      keyPrefix: this.keyPrefix,
      threadId,
    });
  }

  private ensureConnected() {
    if (!this.connected) {
      throw new Error(CONNECT_ERROR_MESSAGE);
    }
  }
}

export function createConvexState(options: ConvexStateAdapterOptions) {
  return new ConvexStateAdapter(options);
}

export type { ConvexStateAdapterOptions } from "./types.js";
export { CONNECT_ERROR_MESSAGE };
