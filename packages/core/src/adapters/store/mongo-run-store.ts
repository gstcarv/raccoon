import mongoose, { Schema, type Model } from "mongoose";
import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunId, RunEvent } from "@/domain/run/index.js";
import type { RunState } from "@/domain/run/index.js";
import type { BoardItemRef, RepoRef } from "@/domain/task/index.js";
import type { BranchName, SessionId } from "@/domain/run/index.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

const runSchema = new Schema(
  {
    _id: String,
    taskProvider: { type: String, required: true },
    taskProjectId: { type: String, required: true },
    taskItemId: { type: String, required: true },
    repoOwner: { type: String, required: true },
    repoName: { type: String, required: true },
    branch: { type: String, required: true },
    worktreePath: { type: String, required: true },
    state: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    startedAt: String,
    completedAt: String,
    prUrl: String,
    sessionId: String,
    errorMessage: String,
    currentAgent: String,
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    _id: String,
    runId: { type: String, required: true },
    kind: { type: String, required: true },
    payload: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { _id: false },
);

const idempotencySchema = new Schema(
  {
    _id: String,
    claimedAt: { type: String, required: true },
  },
  { _id: false },
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunDoc {
  _id: string;
  taskProvider: string;
  taskProjectId: string;
  taskItemId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  worktreePath: string;
  state: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  prUrl?: string;
  sessionId?: string;
  errorMessage?: string;
  currentAgent?: string;
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
      provider: doc.taskProvider,
      projectId: doc.taskProjectId,
      itemId: doc.taskItemId,
    } satisfies BoardItemRef,
    repoRef: { owner: doc.repoOwner, repo: doc.repoName } satisfies RepoRef,
    branch: doc.branch as BranchName,
    worktreePath: doc.worktreePath,
    state: doc.state as RunState,
    attempts: doc.attempts,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    startedAt: doc.startedAt ? new Date(doc.startedAt) : null,
    completedAt: doc.completedAt ? new Date(doc.completedAt) : null,
    prUrl: doc.prUrl ?? null,
    sessionId: (doc.sessionId as SessionId | null) ?? null,
    errorMessage: doc.errorMessage ?? null,
    currentAgent: doc.currentAgent ?? null,
  };
}

function runToDoc(run: Run) {
  return {
    _id: run.id,
    taskProvider: run.taskRef.provider,
    taskProjectId: run.taskRef.projectId,
    taskItemId: run.taskRef.itemId,
    repoOwner: run.repoRef.owner,
    repoName: run.repoRef.repo,
    branch: run.branch,
    worktreePath: run.worktreePath,
    state: run.state,
    attempts: run.attempts,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    prUrl: run.prUrl ?? undefined,
    sessionId: run.sessionId ?? undefined,
    errorMessage: run.errorMessage ?? undefined,
    currentAgent: run.currentAgent ?? undefined,
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
      payload: JSON.stringify(event.payload),
      createdAt: event.createdAt.toISOString(),
    });
  }

  async claim(key: string): Promise<boolean> {
    try {
      await this.Idempotency.create({ _id: key, claimedAt: new Date().toISOString() });
      return true;
    } catch {
      return false;
    }
  }
}
