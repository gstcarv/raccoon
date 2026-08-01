import type {
  BoardProvider,
  BoardEvent,
  RawWebhookRequest,
} from "@/ports/board-provider.js";
import type { BoardItemRef, CanonicalBoardStatus, Task } from "@/domain/task/index.js";

export class FakeBoardProvider implements BoardProvider {
  readonly id = "fake-board";

  private tasks = new Map<string, Task>();
  private statuses = new Map<string, CanonicalBoardStatus>();
  private comments: Array<{ ref: BoardItemRef; body: string }> = [];
  private webhookValid = true;
  private nextEvent: BoardEvent | null = null;

  // --- test helpers ---
  setTask(task: Task): void {
    this.tasks.set(task.boardRef.itemId, task);
  }
  setWebhookValid(valid: boolean): void {
    this.webhookValid = valid;
  }
  setNextEvent(event: BoardEvent | null): void {
    this.nextEvent = event;
  }
  getStatus(itemId: string): CanonicalBoardStatus | undefined {
    return this.statuses.get(itemId);
  }
  getComments(): ReadonlyArray<{ ref: BoardItemRef; body: string }> {
    return this.comments;
  }

  // --- port impl ---
  async verifyWebhook(_req: RawWebhookRequest): Promise<boolean> {
    return Promise.resolve(this.webhookValid);
  }

  async parseEvent(_req: RawWebhookRequest): Promise<BoardEvent | null> {
    return Promise.resolve(this.nextEvent);
  }

  async fetchTask(ref: BoardItemRef): Promise<Task> {
    const task = this.tasks.get(ref.itemId);
    if (!task) throw new Error(`FakeBoardProvider: task not found: ${ref.itemId}`);
    return Promise.resolve(task);
  }

  async moveTask(ref: BoardItemRef, status: CanonicalBoardStatus): Promise<void> {
    this.statuses.set(ref.itemId, status);
    return Promise.resolve();
  }

  async comment(ref: BoardItemRef, body: string): Promise<void> {
    this.comments.push({ ref, body });
    return Promise.resolve();
  }
}
