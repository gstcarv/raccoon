export interface Job {
  readonly id: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface JobQueue {
  enqueue(job: Job): Promise<void>;
  process(handler: JobHandler): void;
  shutdown(): Promise<void>;
}
