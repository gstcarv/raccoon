import process from "node:process";
import { config as loadDotenv } from "dotenv";
import { createServer } from "node:http";
import { loadConfig } from "./config/loader.js";
import { logger } from "./shared/logger.js";
import { buildContainer } from "./composition/container.js";
import { createApp } from "./adapters/http/app.js";
import { GitHubProjectsBoardProvider } from "./adapters/board/github-projects/index.js";
import { GitHubAuth } from "./adapters/board/github-projects/auth.js";
import { GitHubVcsProvider } from "./adapters/vcs/github/index.js";
import { ClaudeCodeRunner } from "./adapters/agent/claude-code/index.js";
import { GitWorkspaceManager } from "./adapters/workspaces/git-workspace-manager.js";
import { SqliteRunStore } from "./adapters/store/sqlite-run-store.js";
import { MemoryRunStore } from "./adapters/store/memory-run-store.js";
import { InMemoryQueue } from "./adapters/queue/in-memory-queue.js";
import { BullMQQueue } from "./adapters/queue/bullmq-queue.js";
import { processJob } from "./pipeline/index.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  loadDotenv();
  const config = loadConfig();

  logger.info({ config: config.redacted }, "raccoon starting");

  if (config.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS) {
    logger.warn(
      "RACCOON_ALLOW_DANGEROUS_PERMISSIONS is enabled — run only inside an isolated container",
    );
  }

  const auth = new GitHubAuth(config.env);
  const getToken = () => auth.getToken();

  const boardProvider = new GitHubProjectsBoardProvider(config.env);
  const vcsProvider = new GitHubVcsProvider(config.env);
  const agentRunner = new ClaudeCodeRunner(config.env);
  const workspaceManager = new GitWorkspaceManager(vcsProvider, config.env, getToken);

  const runStore = config.env.DATABASE_URL.startsWith("file:")
    ? new SqliteRunStore(config.env.DATABASE_URL)
    : new MemoryRunStore();

  const jobQueue = config.env.REDIS_URL
    ? new BullMQQueue(config.env.REDIS_URL)
    : new InMemoryQueue();

  const container = buildContainer(config, {
    boardProviders: [boardProvider],
    vcsProvider,
    agentRunner,
    workspaceManager,
    jobQueue,
    runStore,
  });

  jobQueue.process((job) => processJob(container, job));

  const app = createApp(container);
  const server = createServer(app);

  server.listen(config.env.PORT, () => {
    logger.info({ port: config.env.PORT }, "raccoon listening");
  });

  const shutdown = (): void => {
    logger.info("shutting down");
    server.close(() => {
      jobQueue.shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
    });
    setTimeout(() => {
      logger.error("shutdown timeout — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

try {
  main();
} catch (err: unknown) {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
}
