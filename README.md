# raccoon 🦝

> Autonomous coding agent orchestration — connects to your task board, ships code, opens PRs, does review, moves cards to Done.

**Status:** Early development (Phase 0/14)

## What it does

raccoon watches your GitHub Projects board. When a card enters "Backlog", it:

1. Spins up a Claude Code agent in a git worktree
2. Implements the task following your repo conventions
3. Runs your test suite; self-corrects on failure
4. Opens a PR, posts a code review, moves the card to "In Review"
5. Optionally auto-merges when checks pass and moves to "Done"

## Stack

- Node.js 22 LTS, TypeScript strict, ESM
- Express 5, Zod, Pino, Vitest
- Claude Code CLI (`claude -p`) as the agent executor
- GitHub Projects v2 (GraphQL) + GitHub REST API
- Drizzle ORM + SQLite (Postgres optional)
- BullMQ + Redis optional (in-memory default)

## Quickstart

_Coming after Phase 12. See `docs/guides/deployment.md`._

## Board provider support

| Provider | Status |
|----------|--------|
| GitHub Projects v2 | ✅ Planned (Phase 5) |
| Trello | 🚧 Scaffold only |
| Jira | 🚧 Scaffold only |
| ClickUp | 🚧 Scaffold only |

## License

MIT
