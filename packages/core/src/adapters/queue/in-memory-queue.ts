import type { Job, JobHandler, JobQueue } from "@/ports/job-queue.js";

export class InMemoryQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private readonly pending: Job[] = [];

  enqueue(job: Job): Promise<void> {
    if (this.handler) {
      this.handler(job).catch(() => undefined);
    } else {
      this.pending.push(job);
    }
    return Promise.resolve();
  }

  process(handler: JobHandler): void {
    this.handler = handler;
    for (const job of this.pending.splice(0)) {
      handler(job).catch(() => undefined);
    }
  }

  shutdown(): Promise<void> {
    this.handler = null;
    return Promise.resolve();
  }
}
