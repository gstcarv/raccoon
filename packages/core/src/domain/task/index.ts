export type Priority = "low" | "medium" | "high" | "critical";

export type CanonicalBoardStatus =
  | "BACKLOG"
  | "IN_PROGRESS"
  | "IN_REVIEW"
  | "DONE"
  | "BLOCKED";

export interface BoardItemRef {
  readonly provider: string;
  readonly projectId: string;
  readonly itemId: string;
}

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

export interface Task {
  readonly id: string;
  readonly boardRef: BoardItemRef;
  readonly repoRef: RepoRef;
  readonly title: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly priority: Priority;
  readonly metadata: Readonly<Record<string, unknown>>;
}
