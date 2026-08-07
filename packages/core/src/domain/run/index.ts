import type { BoardItemRef, RepoRef } from "../task/index.js";
import {
  assertValidTransition,
  type RunState,
} from "./state-machine.js";

export type { RunState } from "./state-machine.js";
export {
  assertValidTransition,
  isTerminal,
  isActive,
  toBoardStatus,
  STATE_TO_BOARD_STATUS,
} from "./state-machine.js";

export type RunId = string & { readonly __brand: "RunId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type CommitSha = string & { readonly __brand: "CommitSha" };
export type BranchName = string & { readonly __brand: "BranchName" };

export interface Run {
  readonly id: RunId;
  readonly taskRef: BoardItemRef;
  readonly repoRef: RepoRef;
  readonly branch: BranchName;
  readonly worktreePath: string;
  readonly state: RunState;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly prUrl: string | null;
  readonly sessionId: SessionId | null;
  readonly errorMessage: string | null;
  readonly currentAgent: string | null;
}

export type RunEventKind =
  | "STATE_CHANGED"
  | "PR_OPENED"
  | "COMMENT_POSTED"
  | "ERROR_RECORDED"
  | "AGENT_OUTPUT";

export interface RunEvent {
  readonly id: string;
  readonly runId: RunId;
  readonly kind: RunEventKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export function transitionRun(
  run: Run,
  to: RunState,
  now: Date = new Date(),
): Run {
  assertValidTransition(run.state, to);
  return {
    ...run,
    state: to,
    updatedAt: now,
    startedAt: run.startedAt ?? (to === "PREPARING" ? now : null),
    completedAt:
      to === "DONE" || to === "FAILED" || to === "CANCELLED" ? now : null,
    attempts:
      to === "PREPARING" && run.state === "RETRYING"
        ? run.attempts + 1
        : run.attempts,
  };
}
