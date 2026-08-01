# raccoon — Master Plan

> Source of truth for progress. Updated before and after each phase.
> If context is lost, this file is the recovery point.

## Ambiguity Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Git library: `simple-git` vs `isomorphic-git` | **`simple-git`** | Spawns real git binary — same semantics as the spec's worktree commands; no pure-JS quirks |
| 2 | `bullmq` queue: optional or default | **in-memory default**, BullMQ when `REDIS_URL` set | Spec says so explicitly |
| 3 | Co-author default name | **`Raccoon Bandit <bandit@raccoon.dev>`** | Spec lists this as default |
| 4 | `--dangerously-skip-permissions` | Behind `RACCOON_ALLOW_DANGEROUS_PERMISSIONS=true` flag, with warning in boot log and docs | Security guardrail |
| 5 | GitHub App vs PAT | Both supported via `GitHubAuthProvider` abstraction; App preferred | Spec says App preferred |
| 6 | ADR format | Short: Context / Decision / Consequences | Enough, no bloat |
| 7 | Path aliases | `@/*` → `src/*` via `tsconfig` paths + `vite-tsconfig-paths` for vitest | Standard |

---

## Phase Status

### Phase 0 — Bootstrap and guardrails ✅
- [x] `git init` + remote (github.com/gstcarv/raccoon, main)
- [x] `.gitignore`, `.editorconfig`, MIT license
- [x] Monorepo: Turborepo root + `packages/core` (`raccoon-core`)
- [x] Root `package.json` (workspace) + `pnpm-workspace.yaml` + `turbo.json`
- [x] `packages/core/package.json` with all scripts
- [x] TypeScript strict config (ESM, path aliases `@/*`)
- [x] ESLint flat config (type-checked for src, recommended for test/config) + Prettier
- [x] `lint-staged` + husky pre-commit
- [x] Vitest configured with coverage (v8)
- [x] Skeleton files: `PLAN.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`
- [x] `docs/adr/0001-hexagonal-architecture.md`
- [x] Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green
- [x] Commit: `chore: bootstrap monorepo with turborepo and raccoon-core package`

---

### Phase 1 — Pure domain
- [ ] `Task` entity
- [ ] `Run` entity with all fields
- [ ] Run state machine (all transitions + invalid transition error)
- [ ] `RunEvent` append-only event log
- [ ] `RunState → CanonicalBoardStatus` mapping
- [ ] Error hierarchy: `DomainError`, `InvalidTransitionError`, `ProviderError`, `AgentExecutionError`, `ConfigurationError`
- [ ] Unit tests ≥ 95% coverage
- [ ] Commit: `feat(domain): core entities and run state machine`

---

### Phase 2 — Ports + fakes
- [ ] `BoardProvider` interface
- [ ] `VcsProvider` interface
- [ ] `AgentRunner` interface
- [ ] `WorkspaceManager` interface
- [ ] `JobQueue` interface
- [ ] `RunStore` interface
- [ ] `clock.ts` port
- [ ] Fake implementations in `test/fakes/`
- [ ] Contract tests (reusable per port)
- [ ] Commit: `feat(ports): define provider contracts and test fakes`

---

### Phase 3 — Config and composition root
- [ ] Full Zod env schema with clear messages
- [ ] Multi-layer config: defaults → yaml → env vars
- [ ] Per-repo config mapping
- [ ] `redactConfig()` + test that no secret fields appear in logs
- [ ] `src/composition/container.ts` — `buildContainer(config)`
- [ ] `.env.example` with all vars commented
- [ ] Fail-fast on boot with full error list
- [ ] Commit: `feat(config): typed configuration and composition root`

---

### Phase 4 — HTTP layer
- [ ] `createApp(container)` (testable, no port binding)
- [ ] `server.ts` (binds port)
- [ ] Middlewares: request-id, pino-http, raw-body for HMAC, error handler, 404, helmet, rate limit
- [ ] `POST /webhooks/:provider`
- [ ] `GET /healthz` + `GET /readyz`
- [ ] `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/logs`
- [ ] `POST /api/runs/:id/cancel`, `POST /api/runs/:id/retry`
- [ ] `POST /api/tasks/:provider/:item` (manual trigger)
- [ ] Idempotency by delivery id
- [ ] Graceful shutdown
- [ ] Integration tests with supertest
- [ ] Commit: `feat(http): express layer with webhook ingestion`

---

### Phase 5 — GitHub adapter (board + VCS)
- [ ] Research: GitHub Projects v2 GraphQL, webhook events, scopes → `docs/research/github-projects-v2.md`
- [ ] Webhook HMAC verification (constant-time)
- [ ] `parseEvent` with GraphQL resolution of Projects v2 items
- [ ] Field discovery with TTL cache
- [ ] `moveTask` mutation
- [ ] VCS: create PR, comment, read check status
- [ ] `GitHubAuthProvider` (App token + PAT)
- [ ] Retry with exponential backoff + jitter, Retry-After handling
- [ ] Tests with mocked HTTP
- [ ] Commit: `feat(github): projects v2 board adapter and pull request support`

---

### Phase 6 — Workspace manager (git worktree)
- [ ] Bare clone cache per repo
- [ ] `git fetch --prune` before each run
- [ ] Worktree per run in `runs/<runId>`
- [ ] Branch: `raccoon/<taskId>-<slug>` from `baseBranch`
- [ ] Repo-level lock for concurrent fetch
- [ ] Local git identity per worktree
- [ ] Co-author trailer in every commit
- [ ] Credential injection via `GIT_ASKPASS` (never in URL)
- [ ] `dispose()`: worktree remove + prune + branch delete, always in `finally`
- [ ] Boot-time cleanup of orphaned worktrees
- [ ] Integration tests using real git in tmpdir
- [ ] Commit: `feat(workspace): git worktree lifecycle management`

---

### Phase 7 — Claude Code runner
- [ ] Research: `claude --help`, headless flags, auth → `docs/research/claude-code-cli.md`
- [ ] Spawn with correct flags
- [ ] NDJSON stream parser (incremental, line-buffered, tolerant)
- [ ] Extract and persist `session_id`
- [ ] Exit code: zero vs non-zero only
- [ ] Timeout + AbortSignal (kill process group, SIGKILL after grace)
- [ ] Log streaming to `runs/<runId>/agent.ndjson`
- [ ] Secret redaction before persisting
- [ ] Auth: `CLAUDE_CODE_OAUTH_TOKEN` default, pluggable `apiKeyHelper`
- [ ] Boot-time auth validation
- [ ] Prompt templates in `assets/prompts/`
- [ ] Tests with fake `claude` binary
- [ ] Commit: `feat(agent): claude code headless runner`

---

### Phase 8 — Built-in skills and MCPs
- [ ] Skills: `raccoon-workflow`, `commit-style`, `pull-request`, `test-discipline`, `code-review`
- [ ] `McpRegistry` — loads catalog, filters by available env vars
- [ ] `McpMaterializer` — generates `.mcp.json` per run with 0600 permissions
- [ ] Add `.mcp.json` to worktree `.gitignore`
- [ ] `docs/guides/mcp.md`
- [ ] `pnpm raccoon doctor` command
- [ ] Tests: materialization (missing env → omitted, interpolation, 0600 mode)
- [ ] Commit: `feat(agent): built-in skills and mcp registry`

---

### Phase 9 — Orchestration pipeline
- [ ] `TaskPipeline` with explicit stages
- [ ] All 10 stages: ClaimTask, MoveToInProgress, PrepareWorkspace, Implement, Verify, Publish, MoveToInReview, Review, Finalize, Cleanup
- [ ] Crash-safe state persistence before each stage
- [ ] Boot-time recovery of active runs
- [ ] Failure handling: FAILED state, board BLOCKED, comment with redacted error
- [ ] Guardrails: repo allowlist, file/line limits, `.github/workflows/**` protection
- [ ] E2e test with all fakes + real git in tmpdir
- [ ] Commit: `feat(pipeline): end-to-end task orchestration`

---

### Phase 10 — Queue, concurrency, persistence
- [ ] `InMemoryQueue` + `BullMQQueue` (same contract test)
- [ ] Global concurrency limit + per-repo limit (default 1)
- [ ] `SqliteRunStore` with drizzle + versioned migrations
- [ ] `MemoryRunStore` for tests
- [ ] Tables: `runs`, `run_events`, `webhook_deliveries`, `locks`
- [ ] Retry with backoff + limit; simple DLQ
- [ ] Contract tests for both queue and store implementations
- [ ] Test: two events for same repo don't run in parallel
- [ ] Commit: `feat(infra): queue, concurrency and persistence`

---

### Phase 11 — Observability and security
- [ ] Structured logs with `runId`, `taskId`, `repo`, `stage` child loggers everywhere
- [ ] Centralized redaction — test no known token appears in logs
- [ ] Prometheus metrics at `/metrics`
- [ ] OpenTelemetry behind flag
- [ ] `SECURITY.md` with honest threat model
- [ ] Commit: `feat(observability): structured logging, metrics and security hardening`

---

### Phase 12 — Docker and deployment
- [ ] Multi-stage Dockerfile: deps → build → runtime
- [ ] Non-root user (`raccoon`), `tini` as PID 1, `HEALTHCHECK`
- [ ] `.dockerignore`
- [ ] `docker-compose.yml` (raccoon + redis + volumes)
- [ ] `docs/guides/deployment.md`
- [ ] GitHub Actions CI + release + GHCR publish
- [ ] `docker build` green, compose up, `/healthz` responds
- [ ] Commit: `feat(docker): production-ready container and deployment docs`

---

### Phase 13 — Extensibility and final docs
- [ ] Trello, Jira, ClickUp scaffolds (NotImplementedError, skipped contract tests, README per adapter)
- [ ] `docs/guides/adding-a-board-provider.md`
- [ ] `docs/architecture.md` with Mermaid diagrams
- [ ] `CLAUDE.md` (root) — for agents working on this repo
- [ ] `AGENTS.md` — tool-agnostic version
- [ ] `README.md` final with quickstart, matrix, FAQ, roadmap
- [ ] `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md` + issue templates
- [ ] Commit: `docs: architecture, guides and contributor onboarding`

---

### Phase 14 — Final verification
- [ ] Full gate: typecheck + lint + test --coverage + build
- [ ] docker build + compose up + /healthz + /readyz
- [ ] `pnpm raccoon doctor`
- [ ] Grep for secrets, `console.log`, unjustified `any`, pending `TODO(verify)`
- [ ] Final PLAN.md update: done / NotImplementedError / tech debt / next 5 steps
- [ ] Deliver final report

---

## Technical Debt Log

_(append as discovered)_

---

## ADR Index

- [0001 — Hexagonal Architecture](docs/adr/0001-hexagonal-architecture.md)

---

## Current Phase: 1 — Pure domain
