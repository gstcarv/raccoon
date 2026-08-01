import type { BoardItemRef, CanonicalBoardStatus, Task } from "../domain/task/index.js";

export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Buffer;
}

export type BoardEventKind = "TASK_CREATED" | "TASK_MOVED" | "TASK_UPDATED";

export interface BoardEvent {
  readonly kind: BoardEventKind;
  readonly deliveryId: string;
  readonly taskRef: BoardItemRef;
}

export interface BoardProvider {
  readonly id: string;
  verifyWebhook(req: RawWebhookRequest): Promise<boolean>;
  parseEvent(req: RawWebhookRequest): Promise<BoardEvent | null>;
  fetchTask(ref: BoardItemRef): Promise<Task>;
  moveTask(ref: BoardItemRef, status: CanonicalBoardStatus): Promise<void>;
  comment(ref: BoardItemRef, body: string): Promise<void>;
}
