import { randomUUID } from "node:crypto";
import type { Container } from "@/composition/container.js";
import type { Run, RunId } from "@/domain/run/index.js";
import { transitionRun } from "@/domain/run/index.js";
import type { Task, CanonicalBoardStatus } from "@/domain/task/index.js";
import type { BoardEvent } from "@/ports/board-provider.js";
import type { Job } from "@/ports/job-queue.js";
import { buildPrompt } from "@/skills/prompts.js";
import { buildDefaultMcpConfig, materializeMcpConfig } from "@/skills/mcp.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BoardEventPayload {
  event: BoardEvent;
  providerId: string;
}

export interface ManualTriggerPayload {
  task: Task;
  providerId: string;
}

// ── Pipeline entrypoint ───────────────────────────────────────────────────────

export async function processJob(container: Container, job: Job): Promise<void> {
  if (job.type === "BOARD_EVENT") {
    await handleBoardEvent(container, job.payload as unknown as BoardEventPayload);
  } else if (job.type === "MANUAL_TRIGGER") {
    await handleManualTrigger(container, job.payload as unknown as ManualTriggerPayload);
  } else if (job.type === "RETRY_RUN") {
    const payload = job.payload as unknown as { runId: string };
    await resumeRun(container, payload.runId as RunId);
  }
}

async function handleBoardEvent(
  container: Container,
  payload: BoardEventPayload,
): Promise<void> {
  const { event, providerId } = payload;
  const provider = container.boardProviders.get(providerId);
  if (!provider) return;

  if (event.kind !== "TASK_MOVED" && event.kind !== "TASK_CREATED") return;

  const task = await provider.fetchTask(event.taskRef);
  await startRun(container, task, providerId);
}

async function handleManualTrigger(
  container: Container,
  payload: ManualTriggerPayload,
): Promise<void> {
  await startRun(container, payload.task, payload.providerId);
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────

async function startRun(container: Container, task: Task, _providerId: string): Promise<void> {
  const now = container.clock.now();
  const runId = randomUUID() as RunId;
  const branch = `raccoon/${task.boardRef.itemId}-${String(Date.now()).slice(-6)}` as Run["branch"];

  const run: Run = {
    id: runId,
    taskRef: task.boardRef,
    repoRef: task.repoRef,
    branch,
    worktreePath: "",
    state: "QUEUED",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    prUrl: null,
    sessionId: null,
    errorMessage: null,
  };

  await container.runStore.save(run);
  await executeRun(container, run, task);
}

async function resumeRun(container: Container, runId: RunId): Promise<void> {
  const run = await container.runStore.get(runId);
  if (!run) return;

  const provider = container.boardProviders.get(run.taskRef.provider);
  if (!provider) return;

  const task = await provider.fetchTask(run.taskRef);
  const preparing = transitionRun(run, "PREPARING", container.clock.now());
  await container.runStore.save(preparing);
  await executeRun(container, preparing, task);
}

async function executeRun(container: Container, run: Run, task: Task): Promise<void> {
  const log = container.logger.child({ runId: run.id });
  let currentRun = run;

  // Stage: PREPARING
  const preparing = transitionRun(currentRun, "PREPARING", container.clock.now());
  await container.runStore.save(preparing);
  currentRun = preparing;

  await moveBoard(container, currentRun, "IN_PROGRESS");

  let workspace;
  try {
    workspace = await container.workspaceManager.prepare(
      task.repoRef,
      currentRun.id,
      currentRun.branch,
    );
  } catch (err) {
    await failRun(container, currentRun, err, "Workspace preparation failed");
    return;
  }

  // Update worktreePath on run
  currentRun = { ...currentRun, worktreePath: workspace.path };
  await container.runStore.save(currentRun);

  // Stage: IMPLEMENTING
  const implementing = transitionRun(currentRun, "IMPLEMENTING", container.clock.now());
  await container.runStore.save(implementing);
  currentRun = implementing;

  let agentResult;
  let mcpDispose: (() => Promise<void>) | null = null;

  try {
    const prompt = await buildPrompt({
      TASK_TITLE: task.title,
      TASK_DESCRIPTION: task.description,
      REPO_OWNER: task.repoRef.owner,
      REPO_NAME: task.repoRef.repo,
    });

    let mcpConfigPath: string | null = null;
    const mcpConfig = buildDefaultMcpConfig(container.config.env.MCP_GITHUB_TOKEN);
    if (mcpConfig) {
      const materialized = await materializeMcpConfig(mcpConfig);
      mcpConfigPath = materialized.path;
      mcpDispose = materialized.dispose;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, container.config.env.RACCOON_RUN_TIMEOUT_MS);

    try {
      agentResult = await container.agentRunner.run({
        runId: currentRun.id,
        prompt,
        workingDir: workspace.path,
        allowedTools: ["Bash", "Read", "Write", "Edit"],
        maxTurns: 50,
        mcpConfigPath,
        sessionId: currentRun.sessionId,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (mcpDispose) await mcpDispose();
    await container.workspaceManager.dispose(workspace);
    await failRun(container, currentRun, err, "Agent execution failed");
    return;
  } finally {
    if (mcpDispose) await mcpDispose();
  }

  if (!agentResult.success) {
    await container.workspaceManager.dispose(workspace);
    await failRun(container, currentRun, null, `Agent exited with code ${String(agentResult.exitCode)}`);
    return;
  }

  // Update session id
  currentRun = {
    ...currentRun,
    sessionId: agentResult.sessionId as Run["sessionId"],
  };
  await container.runStore.save(currentRun);

  // Stage: VERIFYING (run test command if configured)
  const verifying = transitionRun(currentRun, "VERIFYING", container.clock.now());
  await container.runStore.save(verifying);
  currentRun = verifying;

  // Stage: PUBLISHING (commit + push + open PR)
  const publishing = transitionRun(currentRun, "PUBLISHING", container.clock.now());
  await container.runStore.save(publishing);
  currentRun = publishing;

  const coAuthor = {
    name: container.config.env.RACCOON_COAUTHOR_NAME,
    email: container.config.env.RACCOON_COAUTHOR_EMAIL,
  };

  const commitMsg = `feat: ${task.title}\n\nAutomated by Raccoon (run ${currentRun.id})`;
  const sha = await container.workspaceManager.commitAll(workspace, commitMsg, coAuthor);

  if (!sha) {
    log.warn("No changes to commit — skipping PR");
    await container.workspaceManager.dispose(workspace);
    const done = transitionRun(currentRun, "DONE", container.clock.now());
    await container.runStore.save(done);
    await moveBoard(container, done, "DONE");
    return;
  }

  await container.workspaceManager.push(workspace);
  await container.workspaceManager.dispose(workspace);

  let pr;
  try {
    pr = await container.vcsProvider.openPullRequest({
      repoRef: task.repoRef,
      branch: currentRun.branch,
      baseBranch: "main",
      title: task.title,
      body: `Automated by Raccoon\n\nRun: ${currentRun.id}`,
      draft: false,
    });
  } catch (err) {
    await failRun(container, currentRun, err, "Failed to open pull request");
    return;
  }

  currentRun = { ...currentRun, prUrl: pr.url };
  await container.runStore.save(currentRun);

  // Stage: IN_REVIEW
  const inReview = transitionRun(currentRun, "IN_REVIEW", container.clock.now());
  await container.runStore.save(inReview);
  currentRun = inReview;
  await moveBoard(container, currentRun, "IN_REVIEW");

  // Stage: REVIEWING (agent self-review)
  const reviewing = transitionRun(currentRun, "REVIEWING", container.clock.now());
  await container.runStore.save(reviewing);
  currentRun = reviewing;

  // Stage: DONE
  const done = transitionRun(currentRun, "DONE", container.clock.now());
  await container.runStore.save(done);
  await moveBoard(container, done, "DONE");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function failRun(
  container: Container,
  run: Run,
  err: unknown,
  message: string,
): Promise<void> {
  const errorMessage = err instanceof Error ? `${message}: ${err.message}` : message;
  container.logger.error({ runId: run.id, err }, errorMessage);

  const failed: Run = {
    ...transitionRun(run, "FAILED", container.clock.now()),
    errorMessage,
  };
  await container.runStore.save(failed);
  await moveBoard(container, failed, "BLOCKED");
}

async function moveBoard(
  container: Container,
  run: Run,
  status: CanonicalBoardStatus,
): Promise<void> {
  const provider = container.boardProviders.get(run.taskRef.provider);
  if (!provider) return;
  await provider.moveTask(run.taskRef, status).catch((err: unknown) => {
    container.logger.warn({ err, runId: run.id }, "Failed to move board card");
  });
}
