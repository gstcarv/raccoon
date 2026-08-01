import { Queue, Worker } from "bullmq";
import type { Job as BullJob } from "bullmq";
import type { Job, JobHandler, JobQueue } from "@/ports/job-queue.js";

const QUEUE_NAME = "raccoon-jobs";

export class BullMQQueue implements JobQueue {
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    const connection = {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      password: url.password || undefined,
      db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
    };
    this.queue = new Queue(QUEUE_NAME, { connection });
  }

  async enqueue(job: Job): Promise<void> {
    await this.queue.add(job.type, job, { jobId: job.id, removeOnComplete: true });
  }

  process(handler: JobHandler): void {
    const connection = (this.queue as unknown as { opts: { connection: object } }).opts.connection;
    this.worker = new Worker(
      QUEUE_NAME,
      async (bullJob: BullJob) => {
        const job = bullJob.data as Job;
        await handler(job);
      },
      { connection, concurrency: 1 },
    );
  }

  async shutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
