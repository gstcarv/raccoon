import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunId, RunEvent } from "@/domain/run/index.js";
import { isActive } from "@/domain/run/index.js";

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<RunId, Run>();
  private readonly events = new Map<RunId, RunEvent[]>();
  private readonly claimed = new Set<string>();

  save(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  get(id: RunId): Promise<Run | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  listActive(): Promise<Run[]> {
    return Promise.resolve([...this.runs.values()].filter((r) => isActive(r.state)));
  }

  appendEvent(event: RunEvent): Promise<void> {
    const existing = this.events.get(event.runId) ?? [];
    existing.push(event);
    this.events.set(event.runId, existing);
    return Promise.resolve();
  }

  claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return Promise.resolve(false);
    this.claimed.add(key);
    return Promise.resolve(true);
  }
}
