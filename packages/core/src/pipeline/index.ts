import { randomUUID } from "node:crypto";
import type { Container } from "@/composition/container.js";
import type { Run, RunId } from "@/domain/run/index.js";
import { transitionRun } from "@/domain/run/index.js";
import type { Task, CanonicalBoardStatus } from "@/domain/task/index.js";
import type { BoardEvent } from "@/ports/board-provider.js";
import type { Job } from "@/ports/job-queue.js";
import { resolveAgent } from "@/skills/agent-registry.js";
import type { PromptVars } from "@/skills/prompts.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BoardEventPayload {
  event: BoardEvent;
  providerId: string;
}

export interface ManualTriggerPayload {
  task: Task;
  providerId: string;
}

// ponytail: all agents run in IMPLEMENTING; currentAgent field tracks which agent is active.
// REVIEWING is reserved for post-PR review phases in future DAG support.

// ── Pipeline entrypoint ───────────────────────────────────────────────────────

export async function processJob(container: Container, job: Job): Promise<void> {
  container.logger.info({ jobId: job.id, jobType: job.type }, "processing job");
  if (job.type === "BOARD_EVENT") {
    await handleBoardEvent(container, job.payload as unknown as BoardEventPayload);
  } else if (job.type === "MANUAL_TRIGGER") {
    await handleManualTrigger(container, job.payload as unknown as ManualTriggerPayload);
  } else if (job.type === "RETRY_RUN") {
    const payload = job.payload as unknown as { runId: string };
    await resumeRun(container, payload.runId as RunId);
  } else {
    container.logger.warn({ jobType: job.type }, "unknown job type — skipping");
  }
}

async function handleBoardEvent(
  container: Container,
  payload: BoardEventPayload,
): Promise<void> {
  const { event, providerId } = payload;
  container.logger.debug({ eventKind: event.kind, providerId, itemId: event.taskRef.itemId }, "board event received");

  const provider = container.boardProviders.get(providerId);
  if (!provider) {
    container.logger.warn({ providerId }, "board provider not found — ignoring event");
    return;
  }

  if (event.kind !== "TASK_MOVED" && event.kind !== "TASK_CREATED") {
    container.logger.debug({ eventKind: event.kind }, "ignoring event kind");
    return;
  }

  const activeRuns = await container.runStore.listActive();
  const alreadyRunning = activeRuns.some((r) => r.taskRef.itemId === event.taskRef.itemId);
  if (alreadyRunning) {
    container.logger.info({ itemId: event.taskRef.itemId }, "run already active for this task — skipping");
    return;
  }

  container.logger.info({ itemId: event.taskRef.itemId }, "fetching task from board");
  const task = await provider.fetchTask(event.taskRef);
  container.logger.info({ taskTitle: task.title, itemId: event.taskRef.itemId }, "task fetched");
  await startRun(container, task, providerId);
}

async function handleManualTrigger(
  container: Container,
  payload: ManualTriggerPayload,
): Promise<void> {
  container.logger.info({ taskTitle: payload.task.title, providerId: payload.providerId }, "manual trigger received");
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
    currentAgent: null,
  };

  await container.runStore.save(run);
  await executeRun(container, run, task);
}

async function resumeRun(container: Container, runId: RunId): Promise<void> {
  container.logger.info({ runId }, "resuming run");
  const run = await container.runStore.get(runId);
  if (!run) {
    container.logger.warn({ runId }, "run not found — cannot resume");
    return;
  }

  const provider = container.boardProviders.get(run.taskRef.provider);
  if (!provider) {
    container.logger.warn({ runId, provider: run.taskRef.provider }, "board provider not found — cannot resume");
    return;
  }

  const task = await provider.fetchTask(run.taskRef);
  // executeRun handles the RETRYING → PREPARING transition internally
  await executeRun(container, run, task);
}

async function executeRun(container: Container, run: Run, task: Task): Promise<void> {
  const log = container.logger.child({ runId: run.id });
  let currentRun = run;

  log.info({ taskTitle: task.title, repo: `${task.repoRef.owner}/${task.repoRef.repo}` }, "starting run");

  // Stage: PREPARING
  const preparing = transitionRun(currentRun, "PREPARING", container.clock.now());
  await container.runStore.save(preparing);
  currentRun = preparing;

  await moveBoard(container, currentRun, "IN_PROGRESS");

  log.info({ branch: currentRun.branch, repo: `${task.repoRef.owner}/${task.repoRef.repo}` }, "preparing workspace");
  let workspace;
  try {
    workspace = await container.workspaceManager.prepare(
      task.repoRef,
      currentRun.id,
      currentRun.branch,
    );
    log.info({ worktreePath: workspace.path }, "workspace ready");
  } catch (err) {
    await failRun(container, currentRun, err, "Workspace preparation failed");
    return;
  }

  currentRun = { ...currentRun, worktreePath: workspace.path };
  await container.runStore.save(currentRun);

  // Resolve agent list for this run (global default: ["engineer"])
  const agentIds = container.config.env.RACCOON_DEFAULT_AGENTS.split(",").map((s) => s.trim()).filter(Boolean);

  const taskVars: PromptVars = {
    TASK_TITLE: task.title,
    TASK_DESCRIPTION: task.description,
    REPO_OWNER: task.repoRef.owner,
    REPO_NAME: task.repoRef.repo,
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => { controller.abort(); },
    container.config.env.RACCOON_RUN_TIMEOUT_MS,
  );

  try {
    // Run each agent in sequence; propagate sessionId between invocations.
    for (const agentId of agentIds) {
      const def = container.agentCatalog.get(agentId);
      if (!def) {
        log.warn({ agentId }, "agent not found in catalog — skipping");
        continue;
      }

      // Only transition to IMPLEMENTING on the first agent; subsequent agents update currentAgent in-place.
      if (currentRun.state !== "IMPLEMENTING") {
        currentRun = { ...transitionRun(currentRun, "IMPLEMENTING", container.clock.now()), currentAgent: agentId };
      } else {
        currentRun = { ...currentRun, currentAgent: agentId, updatedAt: container.clock.now() };
      }
      await container.runStore.save(currentRun);

      log.info({ agentId }, "invoking agent");

      const spec = await resolveAgent(def, taskVars, process.env);

      log.info({ agentId, sessionId: currentRun.sessionId ?? "new" }, "invoking agent");
      const result = await container.runner.invoke(
        {
          runId: currentRun.id,
          agent: spec,
          task: {
            title: task.title,
            description: task.description,
            owner: task.repoRef.owner,
            repo: task.repoRef.repo,
          },
          workspace: { path: workspace.path, branch: currentRun.branch },
          sessionId: currentRun.sessionId,
          limits: { timeoutMs: container.config.env.RACCOON_RUN_TIMEOUT_MS },
        },
        controller.signal,
      );

      if (!result.success) {
        clearTimeout(timeout);
        await container.workspaceManager.dispose(workspace);
        await failRun(
          container,
          currentRun,
          null,
          `Agent ${agentId} exited with code ${String(result.exitCode)}`,
        );
        return;
      }

      log.info(
        { agentId, exitCode: result.exitCode, durationMs: result.durationMs, costUsd: result.costUsd, sessionId: result.sessionId },
        "agent finished",
      );

      currentRun = {
        ...currentRun,
        sessionId: result.sessionId as typeof currentRun.sessionId,
      };
      await container.runStore.save(currentRun);
    }
  } catch (err) {
    clearTimeout(timeout);
    await container.workspaceManager.dispose(workspace);
    await failRun(container, currentRun, err, "Agent execution failed");
    return;
  } finally {
    clearTimeout(timeout);
  }

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
  log.info("committing changes");
  const sha = await container.workspaceManager.commitAll(workspace, commitMsg, coAuthor);

  if (!sha) {
    log.warn("no changes to commit — skipping PR, marking done");
    await container.workspaceManager.dispose(workspace);
    const done = transitionRun(currentRun, "DONE", container.clock.now());
    await container.runStore.save(done);
    await moveBoard(container, done, "DONE");
    return;
  }

  log.info({ sha }, "changes committed, pushing branch");
  await container.workspaceManager.push(workspace);
  log.info({ branch: currentRun.branch }, "branch pushed");
  await container.workspaceManager.dispose(workspace);

  log.info("opening pull request");
  let pr;
  try {
    pr = await container.vcsProvider.openPullRequest({
      repoRef: task.repoRef,
      branch: currentRun.branch,
      baseBranch: await container.vcsProvider.getDefaultBranch(task.repoRef),
      title: task.title,
      body: `Automated by Raccoon\n\nRun: ${currentRun.id}`,
      draft: false,
    });
  } catch (err) {
    await failRun(container, currentRun, err, "Failed to open pull request");
    return;
  }

  log.info({ prUrl: pr.url }, "pull request opened");
  currentRun = { ...currentRun, prUrl: pr.url };
  await container.runStore.save(currentRun);

  // Stage: IN_REVIEW
  const inReview = transitionRun(currentRun, "IN_REVIEW", container.clock.now());
  await container.runStore.save(inReview);
  currentRun = inReview;
  await moveBoard(container, currentRun, "IN_REVIEW");

  // Stage: DONE
  const done = transitionRun(currentRun, "DONE", container.clock.now());
  await container.runStore.save(done);
  await moveBoard(container, done, "DONE");
  log.info({ prUrl: currentRun.prUrl }, "run completed successfully");
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
  container.logger.debug({ runId: run.id, status, itemId: run.taskRef.itemId }, "moving board card");
  await provider.moveTask(run.taskRef, status).catch((err: unknown) => {
    container.logger.warn({ err, runId: run.id, status }, "failed to move board card");
  });
}
