/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      acquireLock: FunctionReference<
        "mutation",
        "internal",
        { keyPrefix: string; threadId: string; ttlMs: number },
        { expiresAt: number; threadId: string; token: string } | null,
        Name
      >;
      appendToList: FunctionReference<
        "mutation",
        "internal",
        {
          key: string;
          keyPrefix: string;
          maxLength?: number;
          ttlMs?: number;
          valueJson: string;
        },
        null,
        Name
      >;
      cleanupExpiredState: FunctionReference<
        "mutation",
        "internal",
        { limitPerTable?: number },
        {
          cache_removed: number;
          lists_removed: number;
          locks_removed: number;
          queue_docs_deleted: number;
          queue_docs_pruned: number;
          queue_entries_pruned: number;
        },
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { key: string; keyPrefix: string },
        null,
        Name
      >;
      deleteValue: FunctionReference<
        "mutation",
        "internal",
        { key: string; keyPrefix: string },
        null,
        Name
      >;
      dequeue: FunctionReference<
        "mutation",
        "internal",
        { keyPrefix: string; threadId: string },
        {
          enqueued_at: number;
          expires_at: number;
          message_id: string;
          message_json: string;
        } | null,
        Name
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          entry: {
            enqueued_at: number;
            expires_at: number;
            message_id: string;
            message_json: string;
          };
          keyPrefix: string;
          maxSize: number;
          threadId: string;
        },
        number,
        Name
      >;
      extendLock: FunctionReference<
        "mutation",
        "internal",
        {
          keyPrefix: string;
          lock: { expiresAt: number; threadId: string; token: string };
          ttlMs: number;
        },
        boolean,
        Name
      >;
      forceReleaseLock: FunctionReference<
        "mutation",
        "internal",
        { keyPrefix: string; threadId: string },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { key: string; keyPrefix: string },
        string | null,
        Name
      >;
      getList: FunctionReference<
        "query",
        "internal",
        { key: string; keyPrefix: string },
        Array<string>,
        Name
      >;
      health: FunctionReference<
        "query",
        "internal",
        {},
        { capabilities: Array<string>; version: string },
        Name
      >;
      isSubscribed: FunctionReference<
        "query",
        "internal",
        { keyPrefix: string; threadId: string },
        boolean,
        Name
      >;
      queueDepth: FunctionReference<
        "query",
        "internal",
        { keyPrefix: string; threadId: string },
        number,
        Name
      >;
      releaseLock: FunctionReference<
        "mutation",
        "internal",
        {
          keyPrefix: string;
          lock: { expiresAt: number; threadId: string; token: string };
        },
        null,
        Name
      >;
      set: FunctionReference<
        "mutation",
        "internal",
        { key: string; keyPrefix: string; ttlMs?: number; valueJson: string },
        null,
        Name
      >;
      setIfNotExists: FunctionReference<
        "mutation",
        "internal",
        { key: string; keyPrefix: string; ttlMs?: number; valueJson: string },
        boolean,
        Name
      >;
      subscribe: FunctionReference<
        "mutation",
        "internal",
        { keyPrefix: string; threadId: string },
        null,
        Name
      >;
      unsubscribe: FunctionReference<
        "mutation",
        "internal",
        { keyPrefix: string; threadId: string },
        null,
        Name
      >;
    };
  };
