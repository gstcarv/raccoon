import mongoose, { Schema, type Model } from "mongoose";
import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunId, RunEvent } from "@/domain/run/index.js";
import type { RunState } from "@/domain/run/index.js";
import type { BranchName, SessionId } from "@/domain/run/index.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

const runSchema = new Schema(
  {
    _id: String,
    task: {
      provider: { type: String, required: true },
      projectId: { type: String, required: true },
      itemId: { type: String, required: true },
    },
    repo: {
      owner: { type: String, required: true },
      name: { type: String, required: true },
    },
    branch: { type: String, required: true },
    worktreePath: { type: String, required: true },
    state: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    currentAgent: String,
    sessionId: String,
    prUrl: String,
    errorMessage: String,
    timestamps: {
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
      startedAt: Date,
      completedAt: Date,
    },
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    _id: String,
    runId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const idempotencySchema = new Schema(
  {
    _id: String,
    claimedAt: { type: Date, required: true },
  },
  { _id: false },
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunDoc {
  _id: string;
  task: { provider: string; projectId: string; itemId: string };
  repo: { owner: string; name: string };
  branch: string;
  worktreePath: string;
  state: string;
  attempts: number;
  currentAgent?: string;
  sessionId?: string;
  prUrl?: string;
  errorMessage?: string;
  timestamps: {
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
  };
}

const ACTIVE_STATES = [
  "QUEUED",
  "PREPARING",
  "IMPLEMENTING",
  "VERIFYING",
  "PUBLISHING",
  "IN_REVIEW",
  "REVIEWING",
  "RETRYING",
] as const;

// ── Mapper ────────────────────────────────────────────────────────────────────

function docToRun(doc: RunDoc): Run {
  return {
    id: doc._id as RunId,
    taskRef: {
      provider: doc.task.provider,
      projectId: doc.task.projectId,
      itemId: doc.task.itemId,
    },
    repoRef: { owner: doc.repo.owner, repo: doc.repo.name },
    branch: doc.branch as BranchName,
    worktreePath: doc.worktreePath,
    state: doc.state as RunState,
    attempts: doc.attempts,
    createdAt: doc.timestamps.createdAt,
    updatedAt: doc.timestamps.updatedAt,
    startedAt: doc.timestamps.startedAt ?? null,
    completedAt: doc.timestamps.completedAt ?? null,
    prUrl: doc.prUrl ?? null,
    sessionId: (doc.sessionId as SessionId | null) ?? null,
    errorMessage: doc.errorMessage ?? null,
    currentAgent: doc.currentAgent ?? null,
  };
}

function runToDoc(run: Run) {
  return {
    _id: run.id,
    task: {
      provider: run.taskRef.provider,
      projectId: run.taskRef.projectId,
      itemId: run.taskRef.itemId,
    },
    repo: { owner: run.repoRef.owner, name: run.repoRef.repo },
    branch: run.branch,
    worktreePath: run.worktreePath,
    state: run.state,
    attempts: run.attempts,
    currentAgent: run.currentAgent ?? undefined,
    sessionId: run.sessionId ?? undefined,
    prUrl: run.prUrl ?? undefined,
    errorMessage: run.errorMessage ?? undefined,
    timestamps: {
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt ?? undefined,
      completedAt: run.completedAt ?? undefined,
    },
  };
}

// ── MongoRunStore ─────────────────────────────────────────────────────────────

// ponytail: typed as `any` because mongoose's generic inference on custom _id schemas is unreliable with exactOptionalPropertyTypes
export class MongoRunStore implements RunStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly Runs: Model<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly Events: Model<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly Idempotency: Model<any>;

  private constructor(conn: mongoose.Connection) {
    this.Runs = conn.model("Run", runSchema, "runs");
    this.Events = conn.model("RunEvent", eventSchema, "run_events");
    this.Idempotency = conn.model("IdempotencyKey", idempotencySchema, "idempotency_keys");
  }

  static async connect(uri: string): Promise<MongoRunStore> {
    const conn = await mongoose.createConnection(uri).asPromise();
    return new MongoRunStore(conn);
  }

  async save(run: Run): Promise<void> {
    const doc = runToDoc(run);
    await this.Runs.findByIdAndUpdate(doc._id, doc, { upsert: true, new: true });
  }

  async get(id: RunId): Promise<Run | null> {
    const doc = await this.Runs.findById(id).lean<RunDoc>();
    return doc ? docToRun(doc) : null;
  }

  async listActive(): Promise<Run[]> {
    const docs = await this.Runs.find({ state: { $in: ACTIVE_STATES } }).lean<RunDoc[]>();
    return docs.map(docToRun);
  }

  async appendEvent(event: RunEvent): Promise<void> {
    await this.Events.create({
      _id: event.id,
      runId: event.runId,
      kind: event.kind,
      payload: event.payload,
      createdAt: event.createdAt,
    });
  }

  async claim(key: string): Promise<boolean> {
    try {
      await this.Idempotency.create({ _id: key, claimedAt: new Date() });
      return true;
    } catch {
      return false;
    }
  }
}
