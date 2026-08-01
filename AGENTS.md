# AGENTS.md — Agent instructions for raccoon (tool-agnostic)

## Build and test

```bash
pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass before committing. Zero warnings on lint.

## Code conventions

- TypeScript strict mode, ESM (`import`/`export`), `.js` extensions in imports
- No `any` without explicit justification comment
- No `console.log` — use the logger
- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore:`, `docs:`, `test:`
- Co-author trailer on every commit:
  ```
  Co-authored-by: Raccoon Builder <builder@raccoon.dev>
  ```

## Architecture boundaries

- `src/domain/` — zero imports from outside domain/; no I/O
- `src/ports/` — interfaces only; no implementation
- `src/adapters/` — implements ports; may use external libs
- `src/application/` — depends on ports, never on adapters directly
- `src/composition/` — the ONLY place that wires adapters to ports

## When blocked

1. Write a file named `BLOCKED.md` in the root with the reason
2. Do NOT guess or invent API shapes — check `docs/research/` first
3. Mark uncertain code with `// TODO(verify):` and add to PLAN.md
