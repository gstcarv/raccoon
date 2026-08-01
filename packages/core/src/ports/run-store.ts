import type { Run, RunEvent, RunId } from "../domain/run/index.js";

export interface RunStore {
  save(run: Run): Promise<void>;
  get(id: RunId): Promise<Run | null>;
  listActive(): Promise<Run[]>;
  appendEvent(event: RunEvent): Promise<void>;
  /** Claim an idempotency key. Returns true if claimed, false if already exists. */
  claim(key: string): Promise<boolean>;
}
