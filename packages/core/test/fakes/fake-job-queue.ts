import type { JobQueue, Job, JobHandler } from "@/ports/job-queue.ts";

export class FakeJobQueue implements JobQueue {
  jobs: Job[] = [];
  private handler: JobHandler | null = null;
  private running = false;

  async enqueue(job: Job): Promise<void> {
    this.jobs.push(job);
    if (this.handler && this.running) {
      await this.handler(job);
    }
    return Promise.resolve();
  }

  process(handler: JobHandler): void {
    this.handler = handler;
    this.running = true;
  }

  async shutdown(): Promise<void> {
    this.running = false;
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    if (!this.handler) return;
    for (const job of this.jobs) {
      await this.handler(job);
    }
  }
}
