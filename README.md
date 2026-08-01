# raccoon

> Autonomous coding agent orchestration — connects to your GitHub Projects board, implements tasks with Claude Code, opens PRs, reviews code, and moves cards to Done.

## What it does

raccoon watches your GitHub Projects v2 board. When a card is moved to the right column, it:

1. Creates a git worktree for the task
2. Spawns a Claude Code agent (`claude -p`) with the task prompt and your repo's skills
3. Commits the changes with a co-author trailer
4. Pushes the branch and opens a pull request
5. Posts a review comment and moves the board card to "In Review"

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/gstcarv/raccoon.git
cd raccoon
pnpm install

# 2. Configure
cp packages/core/.env.example .env
# Edit .env — at minimum: GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN, CLAUDE_CODE_OAUTH_TOKEN

# 3. Check your setup
pnpm raccoon doctor

# 4. Start
pnpm dev
```

Or with Docker:

```bash
cp packages/core/.env.example .env
docker compose up -d
```

See [`docs/guides/deployment.md`](docs/guides/deployment.md) for full setup instructions.

## Architecture

Hexagonal architecture — domain has zero I/O, all external interactions go through typed ports with swappable adapters.

See [`docs/architecture.md`](docs/architecture.md) for diagrams.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS, TypeScript strict, ESM |
| HTTP | Express 5, Zod, Pino, prom-client |
| Agent | Claude Code CLI (`claude -p`), NDJSON streaming |
| Board | GitHub Projects v2 (GraphQL) |
| VCS | GitHub REST API (Octokit) |
| Git | simple-git, worktrees, GIT_ASKPASS credentials |
| Persistence | Drizzle ORM + SQLite (default) |
| Queue | In-memory (default) or BullMQ + Redis |
| Tests | Vitest + fake adapter contract tests |
| Infra | Docker multi-stage, tini, GitHub Actions CI |

## Board provider support

| Provider | Status |
|----------|--------|
| GitHub Projects v2 | Implemented |

## Security

See [SECURITY.md](SECURITY.md). Key points:

- Secrets are never committed or logged — all redacted as `[REDACTED]`
- GIT credentials injected via `GIT_ASKPASS`, never in remote URLs
- Webhook payloads verified with HMAC-SHA256 + `timingSafeEqual`
- `--dangerously-skip-permissions` only enabled via explicit env flag with boot warning

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
