# CLAUDE.md — Instructions for agents working on raccoon

## Commands

```bash
pnpm install          # install deps
pnpm dev              # start dev server (tsx watch)
pnpm build            # compile TS → dist/
pnpm typecheck        # type-check without emit
pnpm lint             # ESLint (0 warnings allowed)
pnpm test             # vitest run
pnpm test:coverage    # vitest with coverage
pnpm raccoon doctor   # verify environment (Phase 8+)
```

## Non-negotiable rules

1. **Zero console.log** — use `logger` from `@/shared/logger.js`
2. **Zero `any`** without a `// ponytail:` comment explaining why
3. **Zero secrets in repo** — `.env.example` only
4. **Never force-push** to main or any branch not owned by raccoon
5. **Never touch** `.github/workflows/**` or any secrets file
6. **Write an ADR** in `docs/adr/` before changing architecture
7. **Update PLAN.md** before and after each phase
8. **Gate before commit:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## Project structure

```
src/domain/        — pure entities and state machine (zero I/O)
src/ports/         — TypeScript interfaces
src/application/   — use cases, pipeline stages
src/adapters/      — concrete implementations
src/config/        — Zod env schema + config loader
src/composition/   — dependency injection root
src/shared/        — logger, result type, branded ids
test/fakes/        — fake implementations for testing
test/unit/         — unit tests (domain, shared)
test/integration/  — integration tests (adapters, HTTP)
test/e2e/          — end-to-end pipeline tests
assets/skills/     — skill files copied into worktrees
assets/mcp/        — MCP server catalog
assets/prompts/    — agent prompt templates
docs/adr/          — architecture decisions
docs/research/     — verified API facts with sources
docs/guides/       — operational guides
```

## Where things live

- State machine: `src/domain/run/state-machine.ts`
- Pipeline stages: `src/application/pipeline/`
- GitHub adapter: `src/adapters/board/github-projects/`
- Worktree manager: `src/adapters/workspace/`
- Claude Code runner: `src/adapters/agent/claude-code/`
- Config schema: `src/config/schema.ts`
- Composition root: `src/composition/container.ts`
