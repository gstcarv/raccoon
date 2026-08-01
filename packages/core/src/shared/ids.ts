import { randomUUID } from "node:crypto";

export type RunId = string & { readonly __brand: "RunId" };
export type TaskId = string & { readonly __brand: "TaskId" };
export type EventId = string & { readonly __brand: "EventId" };

export const newRunId = (): RunId => randomUUID() as RunId;
export const newEventId = (): EventId => randomUUID() as EventId;
