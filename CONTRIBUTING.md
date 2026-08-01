# Contributing

## Setup

```bash
git clone https://github.com/gstcarv/raccoon.git
cd raccoon
pnpm install
```

## Development

```bash
pnpm dev           # start server with tsx watch
pnpm typecheck     # TypeScript check (no emit)
pnpm lint          # ESLint
pnpm test          # Vitest
pnpm build         # tsc + tsc-alias
```

All commands run via Turborepo — add `--filter raccoon-core` to target the core package only.

## Gate

Every PR must pass:

1. `pnpm typecheck`
2. `pnpm lint` (zero warnings)
3. `pnpm test` (all tests)
4. `pnpm build`

The CI workflow (`.github/workflows/ci.yml`) runs these on every push and PR.

## Code conventions

- **Hexagonal architecture**: domain code has zero I/O. All I/O goes through ports in `src/ports/`.
- **Strict TypeScript**: `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
- **ESM only**: `"type": "module"` — use `.js` extensions in imports.
- **No comments** unless the WHY is non-obvious. Never explain what the code does.
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

## Adding a new board provider

1. Create `src/adapters/board/<name>/index.ts` implementing `BoardProvider`.
2. Add a contract test in `test/contracts/board-provider.contract.ts`.
3. Register it in `server.ts`.

## Secrets

- Never commit secrets or tokens. Only `.env.example` goes in the repo.
- Use `pnpm raccoon doctor` to verify your local setup.
