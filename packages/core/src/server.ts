import process from "node:process";
import { loadConfig } from "./config/loader.js";
import { logger } from "./shared/logger.js";

function main(): void {
  const config = loadConfig();

  logger.info({ config: config.redacted }, "raccoon starting");

  if (config.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS) {
    logger.warn(
      "RACCOON_ALLOW_DANGEROUS_PERMISSIONS is enabled — run only inside an isolated container",
    );
  }

  // Full wiring happens in Phase 10 once real adapters exist.
  logger.info({ port: config.env.PORT }, "raccoon server running (adapters wired in Phase 10)");
}

try {
  main();
} catch (err: unknown) {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
}
