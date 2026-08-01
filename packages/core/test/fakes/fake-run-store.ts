import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunEvent, RunId } from "@/domain/run/index.js";

export class FakeRunStore implements RunStore {
  private runs = new Map<RunId, Run>();
  private events: RunEvent[] = [];
  private claims = new Set<string>();

  async save(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    return Promise.resolve();
  }

  async get(id: RunId): Promise<Run | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  async listActive(): Promise<Run[]> {
    return Promise.resolve(
      [...this.runs.values()].filter(
        (r) => r.state !== "DONE" && r.state !== "FAILED" && r.state !== "CANCELLED",
      ),
    );
  }

  async appendEvent(event: RunEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  async claim(key: string): Promise<boolean> {
    if (this.claims.has(key)) return Promise.resolve(false);
    this.claims.add(key);
    return Promise.resolve(true);
  }

  // --- test helpers ---
  getEvents(): ReadonlyArray<RunEvent> {
    return this.events;
  }
  getAllRuns(): ReadonlyArray<Run> {
    return [...this.runs.values()];
  }
}
