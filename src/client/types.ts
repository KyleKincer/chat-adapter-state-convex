import type { Logger } from "chat";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export type ConvexStateComponent = ComponentApi;
export type RunQueryFn = GenericActionCtx<GenericDataModel>["runQuery"];
export type RunMutationFn = GenericActionCtx<GenericDataModel>["runMutation"];

export type ConvexStateAdapterOptions = {
  component: ConvexStateComponent;
  keyPrefix?: string;
  logger?: Logger;
  runMutation: RunMutationFn;
  runQuery: RunQueryFn;
};
