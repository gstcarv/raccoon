import type { RaccoonConfig } from "../config/index.js";
import type { BoardProvider } from "../ports/board-provider.js";
import type { VcsProvider } from "../ports/vcs-provider.js";
import type { Runner } from "../ports/runner.js";
import type { WorkspaceManager } from "../ports/workspace-manager.js";
import type { JobQueue } from "../ports/job-queue.js";
import type { RunStore } from "../ports/run-store.js";
import type { Clock } from "../ports/clock.js";
import type { AgentDefinition } from "../domain/agent/index.js";
import { systemClock } from "../ports/clock.js";
import { logger as rootLogger, type Logger } from "../shared/logger.js";

export interface Container {
  readonly config: RaccoonConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly boardProviders: ReadonlyMap<string, BoardProvider>;
  readonly vcsProvider: VcsProvider;
  readonly runner: Runner;
  readonly agentCatalog: ReadonlyMap<string, AgentDefinition>;
  readonly workspaceManager: WorkspaceManager;
  readonly jobQueue: JobQueue;
  readonly runStore: RunStore;
}

export interface ContainerAdapters {
  readonly boardProviders: BoardProvider[];
  readonly vcsProvider: VcsProvider;
  readonly runner: Runner;
  readonly agentCatalog: ReadonlyMap<string, AgentDefinition>;
  readonly workspaceManager: WorkspaceManager;
  readonly jobQueue: JobQueue;
  readonly runStore: RunStore;
}

export function buildContainer(
  config: RaccoonConfig,
  adapters: ContainerAdapters,
): Container {
  const log = rootLogger.child({ service: "raccoon" });

  const boardProviders = new Map<string, BoardProvider>(
    adapters.boardProviders.map((p) => [p.id, p]),
  );

  if (boardProviders.size === 0) {
    throw new Error("At least one board provider must be registered");
  }

  log.info({ config: config.redacted }, "raccoon container initialized");

  return {
    config,
    logger: log,
    clock: systemClock,
    boardProviders,
    vcsProvider: adapters.vcsProvider,
    runner: adapters.runner,
    agentCatalog: adapters.agentCatalog,
    workspaceManager: adapters.workspaceManager,
    jobQueue: adapters.jobQueue,
    runStore: adapters.runStore,
  };
}
