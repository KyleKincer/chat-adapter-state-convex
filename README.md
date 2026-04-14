# chat-adapter-state-convex

[![npm version](https://img.shields.io/npm/v/chat-adapter-state-convex)](https://www.npmjs.com/package/chat-adapter-state-convex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Convex state adapter for [Chat SDK](https://chat-sdk.dev).

This package implements the full `StateAdapter` surface on top of a Convex
component so subscriptions, locks, cache entries, lists, and queued overlap
state all live in Convex.

The v1 target is Chat SDK code running inside Convex actions and workflows.
External Node runtimes using `ConvexHttpClient` are intentionally out of scope.

## Installation

```bash
pnpm add chat-adapter-state-convex
```

## Convex setup

Mount the component in your app's `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import chatStateConvex from "chat-adapter-state-convex/convex.config.js";

const app = defineApp();
app.use(chatStateConvex, { name: "chatState" });

export default app;
```

Then regenerate Convex codegen so `components.chatState` is available in your
app.

## Usage

Create the adapter inside a Convex action or workflow:

```ts
import { createConvexState } from "chat-adapter-state-convex";
import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

export function createStateAdapter(ctx: Pick<ActionCtx, "runQuery" | "runMutation">) {
  return createConvexState({
    component: components.chatState,
    runQuery: ctx.runQuery,
    runMutation: ctx.runMutation,
    keyPrefix: "chat-sdk",
  });
}
```

The adapter requires an explicit `connect()` before use:

```ts
const state = createStateAdapter(ctx);
await state.connect();
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `component` | Yes | The mounted Convex component reference, usually `components.chatState` |
| `runQuery` | Yes | Convex action/workflow `ctx.runQuery` |
| `runMutation` | Yes | Convex action/workflow `ctx.runMutation` |
| `keyPrefix` | No | Prefix for all state rows, defaults to `"chat-sdk"` |
| `logger` | No | Logger instance, defaults to `ConsoleLogger("info").child("convex")` |

## Component data model

The component stores transport state in these tables:

```text
subscriptions
locks
cache
lists
queues
```

All rows are namespaced by `key_prefix`.

## Features

| Feature | Supported |
|---------|-----------|
| Persistence | Yes |
| Multi-instance | Yes |
| Subscriptions | Yes |
| Distributed locking | Yes |
| Key-value caching | Yes |
| List storage | Yes |
| Queue/debounce state | Yes |
| Key prefix namespacing | Yes |

## Expired state cleanup

Convex does not delete expired rows automatically. Run periodic cleanup through
an app-level wrapper action or mutation:

```ts
import { components, internal } from "./_generated/api";
import { cronJobs } from "convex/server";
import { internalAction } from "./_generated/server";

export const cleanupChatState = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runMutation(components.chatState.lib.cleanupExpiredState, {
      limitPerTable: 100,
    });
  },
});

const crons = cronJobs();

crons.interval(
  "chat-state-cleanup",
  { minutes: 15 },
  internal.chatStateCleanup.cleanupChatState,
  {},
);
```

## Development

```bash
pnpm install
pnpm codegen
pnpm build
pnpm test
```
