# chat-adapter-state-convex

Convex-backed state adapter component for [Chat SDK](https://www.npmjs.com/package/chat).

This package implements the full `StateAdapter` surface against a Convex
component so Chat SDK concurrency, dedupe, subscriptions, locks, cache, list
storage, and queue state all live in Convex.

The v1 target is Chat SDK code running inside Convex actions or workflows.
External Node runtimes using `ConvexHttpClient` are intentionally out of scope.

## Installation

Until the first npm release, install from a pinned Git SHA:

```bash
pnpm add github:KyleKincer/chat-adapter-state-convex#<commit>
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

Then regenerate Convex codegen in your app so `components.chatState` becomes
available.

## Usage

Create the adapter inside a Convex action or workflow:

```ts
import { createConvexState } from "chat-adapter-state-convex";
import { components } from "./_generated/api";

export function createStateAdapter(ctx: {
  runQuery: typeof import("convex/server").GenericActionCtx.prototype.runQuery;
  runMutation: typeof import("convex/server").GenericActionCtx.prototype.runMutation;
}) {
  return createConvexState({
    component: components.chatState,
    runQuery: ctx.runQuery,
    runMutation: ctx.runMutation,
    keyPrefix: "stagehand",
  });
}
```

The adapter requires an explicit `connect()` before use:

```ts
const state = createConvexState({
  component: components.chatState,
  runQuery: ctx.runQuery,
  runMutation: ctx.runMutation,
});

await state.connect();
```

## Cleanup

Expired rows are not removed automatically by Convex. Run the component cleanup
mutation on a cron, for example every 15 minutes:

```ts
crons.interval(
  "chat-state-cleanup",
  { minutes: 15 },
  components.chatState.lib.cleanupExpiredState,
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
