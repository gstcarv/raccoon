import process from "node:process";
import { execa } from "execa";
import { loadConfig } from "./config/loader.js";

const cmd = process.argv[2];

if (cmd === "doctor") {
  await runDoctor();
} else {
  process.stderr.write(`Unknown command: ${cmd ?? ""}\nUsage: raccoon doctor\n`);
  process.exit(1);
}

async function runDoctor(): Promise<void> {
  const failures: string[] = [];

  const check = (label: string, ok: boolean, detail?: string): void => {
    const icon = ok ? "✓" : "✗";
    const line = detail ? `  ${icon} ${label}: ${detail}` : `  ${icon} ${label}`;
    process.stdout.write(line + "\n");
    if (!ok) failures.push(label);
  };

  process.stdout.write("raccoon doctor\n\n");

  // ── Config ───────────────────────────────────────────────────────────────────
  let config;
  try {
    config = loadConfig();
    check("Config", true, "loaded");
  } catch (err) {
    check("Config", false, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  check(
    "GITHUB_WEBHOOK_SECRET",
    config.env.GITHUB_WEBHOOK_SECRET.length >= 16,
    config.env.GITHUB_WEBHOOK_SECRET.length >= 16 ? "set" : "too short (< 16 chars)",
  );

  const hasAuth = Boolean(
    config.env.GITHUB_TOKEN ??
      (config.env.GITHUB_APP_ID &&
        config.env.GITHUB_APP_PRIVATE_KEY &&
        config.env.GITHUB_APP_INSTALLATION_ID),
  );
  check(
    "GitHub auth",
    hasAuth,
    hasAuth ? "configured" : "missing GITHUB_TOKEN or App credentials",
  );

  check(
    "CLAUDE_CODE_OAUTH_TOKEN",
    Boolean(config.env.CLAUDE_CODE_OAUTH_TOKEN),
    config.env.CLAUDE_CODE_OAUTH_TOKEN ? "set" : "not set (required for claude CLI)",
  );

  if (config.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS) {
    check(
      "RACCOON_ALLOW_DANGEROUS_PERMISSIONS",
      true,
      "WARNING: enabled — run only inside an isolated container",
    );
  }

  // ── Claude CLI ───────────────────────────────────────────────────────────────
  try {
    const res = await execa(config.env.CLAUDE_CODE_PATH, ["--version"], { reject: false });
    check("Claude CLI", res.exitCode === 0, res.stdout.trim() || "found");
  } catch {
    check("Claude CLI", false, `not found at ${config.env.CLAUDE_CODE_PATH}`);
  }

  // ── Git ──────────────────────────────────────────────────────────────────────
  try {
    const res = await execa("git", ["--version"], { reject: false });
    check("git", res.exitCode === 0, res.stdout.trim());
  } catch {
    check("git", false, "not found");
  }

  process.stdout.write(
    `\n${failures.length === 0 ? "All checks passed." : `${String(failures.length)} check(s) failed — review above.`}\n`,
  );

  if (failures.length > 0) process.exit(1);
}
