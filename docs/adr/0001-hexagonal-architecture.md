# ADR 0001 — Hexagonal Architecture (Ports & Adapters)

**Date:** 2024-01-01
**Status:** Accepted

## Context

raccoon needs to support multiple board providers (GitHub Projects, Trello, Jira, ClickUp),
multiple VCS providers, and potentially multiple agent runners. The core orchestration logic
must not depend on any specific provider implementation.

## Decision

Adopt Hexagonal Architecture (Ports & Adapters):

- **Domain** — pure TypeScript, zero I/O, zero framework imports. Entities, value objects, state machine, errors.
- **Ports** — TypeScript interfaces that the domain/application layer depends on. Live in `src/ports/`.
- **Adapters** — Concrete implementations of ports. Live in `src/adapters/`. Know about Express, GitHub, git, Claude Code.
- **Application** — Use cases and pipeline stages. Depend on ports, not adapters.
- **Composition root** — `src/composition/container.ts`. The only place that knows which adapter implements which port.

No DI framework. `buildContainer(config)` returns a plain object with all dependencies wired.

## Consequences

- Domain and application layers are fully testable with fakes (no HTTP, no disk, no subprocess).
- Adding a new board provider = implement `BoardProvider`, register in container. No other files change.
- Slightly more boilerplate at the boundary (interface definition + fake + real impl), but this is the explicit trade-off for testability.
