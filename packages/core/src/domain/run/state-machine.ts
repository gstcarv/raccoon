import { InvalidTransitionError } from "../errors/index.js";
import type { CanonicalBoardStatus } from "../task/index.js";

export type RunState =
  | "QUEUED"
  | "PREPARING"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "PUBLISHING"
  | "IN_REVIEW"
  | "REVIEWING"
  | "DONE"
  | "FAILED"
  | "CANCELLED"
  | "RETRYING";

// Explicit transition table — every valid (from → to) pair.
const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  "QUEUED→PREPARING",
  "QUEUED→CANCELLED",
  "PREPARING→IMPLEMENTING",
  "PREPARING→FAILED",
  "PREPARING→CANCELLED",
  "IMPLEMENTING→VERIFYING",
  "IMPLEMENTING→FAILED",
  "IMPLEMENTING→CANCELLED",
  "VERIFYING→PUBLISHING",
  "VERIFYING→IMPLEMENTING", // retry after test failure
  "VERIFYING→FAILED",
  "VERIFYING→CANCELLED",
  "PUBLISHING→IN_REVIEW",
  "PUBLISHING→DONE", // no changes to commit — skip PR
  "PUBLISHING→FAILED",
  "PUBLISHING→CANCELLED",
  "IN_REVIEW→REVIEWING",
  "IN_REVIEW→DONE", // human merged
  "IN_REVIEW→FAILED",
  "IN_REVIEW→CANCELLED",
  "REVIEWING→DONE",
  "REVIEWING→IMPLEMENTING", // review found issues, retry
  "REVIEWING→FAILED",
  "REVIEWING→CANCELLED",
  "FAILED→RETRYING",
  "RETRYING→PREPARING",
  "RETRYING→FAILED",
]);

export function assertValidTransition(from: RunState, to: RunState): void {
  if (!VALID_TRANSITIONS.has(`${from}→${to}`)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(state: RunState): boolean {
  return state === "DONE" || state === "FAILED" || state === "CANCELLED";
}

export function isActive(state: RunState): boolean {
  return !isTerminal(state);
}

export const STATE_TO_BOARD_STATUS: Readonly<
  Partial<Record<RunState, CanonicalBoardStatus>>
> = {
  QUEUED: "BACKLOG",
  PREPARING: "IN_PROGRESS",
  IMPLEMENTING: "IN_PROGRESS",
  VERIFYING: "IN_PROGRESS",
  PUBLISHING: "IN_PROGRESS",
  IN_REVIEW: "IN_REVIEW",
  REVIEWING: "IN_REVIEW",
  DONE: "DONE",
  FAILED: "BLOCKED",
  CANCELLED: "BLOCKED",
  RETRYING: "IN_PROGRESS",
};

export function toBoardStatus(state: RunState): CanonicalBoardStatus {
  return STATE_TO_BOARD_STATUS[state] ?? "BLOCKED";
}
