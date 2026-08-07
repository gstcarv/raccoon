import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq, or } from "drizzle-orm";
import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunId, RunEvent } from "@/domain/run/index.js";
import type { RunState } from "@/domain/run/index.js";
import type { BoardItemRef, RepoRef } from "@/domain/task/index.js";
import type { BranchName, SessionId } from "@/domain/run/index.js";

// ── Schema ────────────────────────────────────────────────────────────────────

const runsTable = sqliteTable("runs", {
  id: text("id").primaryKey(),
  taskProvider: text("task_provider").notNull(),
  taskProjectId: text("task_project_id").notNull(),
  taskItemId: text("task_item_id").notNull(),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  branch: text("branch").notNull(),
  worktreePath: text("worktree_path").notNull(),
  state: text("state").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  prUrl: text("pr_url"),
  sessionId: text("session_id"),
  errorMessage: text("error_message"),
});

const eventsTable = sqliteTable("run_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

const idempotencyTable = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  claimedAt: text("claimed_at").notNull(),
});

// ── Mapper ────────────────────────────────────────────────────────────────────

type RunRow = typeof runsTable.$inferSelect;

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

function rowToRun(row: RunRow): Run {
  return {
    id: row.id as RunId,
    taskRef: {
      provider: row.taskProvider,
      projectId: row.taskProjectId,
      itemId: row.taskItemId,
    } satisfies BoardItemRef,
    repoRef: { owner: row.repoOwner, repo: row.repoName } satisfies RepoRef,
    branch: row.branch as BranchName,
    worktreePath: row.worktreePath,
    state: row.state as RunState,
    attempts: row.attempts,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    prUrl: row.prUrl ?? null,
    sessionId: (row.sessionId as SessionId | null) ?? null,
    errorMessage: row.errorMessage ?? null,
  };
}

function runToRow(run: Run): RunRow {
  return {
    id: run.id,
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
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    prUrl: run.prUrl,
    sessionId: run.sessionId,
    errorMessage: run.errorMessage,
  };
}

// ── SqliteRunStore ────────────────────────────────────────────────────────────

export class SqliteRunStore implements RunStore {
  private readonly db;

  constructor(databaseUrl: string) {
    const path = databaseUrl.replace(/^file:/, "");
    mkdirSync(dirname(path), { recursive: true });
    const sqlite = new Database(path);
    this.db = drizzle(sqlite);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_provider TEXT NOT NULL,
        task_project_id TEXT NOT NULL,
        task_item_id TEXT NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        pr_url TEXT,
        session_id TEXT,
        error_message TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        claimed_at TEXT NOT NULL
      )
    `);
  }

  save(run: Run): Promise<void> {
    const row = runToRow(run);
    this.db
      .insert(runsTable)
      .values(row)
      .onConflictDoUpdate({ target: runsTable.id, set: row })
      .run();
    return Promise.resolve();
  }

  get(id: RunId): Promise<Run | null> {
    const rows = this.db.select().from(runsTable).where(eq(runsTable.id, id)).all();
    const row = rows[0];
    return Promise.resolve(row ? rowToRun(row) : null);
  }

  listActive(): Promise<Run[]> {
    const conditions = ACTIVE_STATES.map((s) => eq(runsTable.state, s));
    const rows = this.db
      .select()
      .from(runsTable)
      .where(or(...conditions))
      .all();
    return Promise.resolve(rows.map(rowToRun));
  }

  appendEvent(event: RunEvent): Promise<void> {
    this.db
      .insert(eventsTable)
      .values({
        id: event.id,
        runId: event.runId,
        kind: event.kind,
        payload: JSON.stringify(event.payload),
        createdAt: event.createdAt.toISOString(),
      })
      .run();
    return Promise.resolve();
  }

  claim(key: string): Promise<boolean> {
    try {
      this.db
        .insert(idempotencyTable)
        .values({ key, claimedAt: new Date().toISOString() })
        .run();
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
}
