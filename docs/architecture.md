# Architecture

## Overview

Raccoon follows a hexagonal (ports & adapters) architecture. The domain has zero I/O; all external interactions are behind typed interfaces (ports) with concrete implementations (adapters) wired at startup.

## Package layout

```
raccoon/
├── packages/
│   └── core/                  # raccoon-core — the single deployable service
│       ├── src/
│       │   ├── domain/        # Pure domain: Run state machine, Task types, errors
│       │   ├── ports/         # TypeScript interfaces for all I/O
│       │   ├── adapters/      # Concrete implementations
│       │   │   ├── http/      # Express 5 API + webhook ingestion
│       │   │   ├── board/     # BoardProvider implementations
│       │   │   │   └── github-projects/
│       │   │   ├── vcs/       # VcsProvider implementations
│       │   │   │   └── github/
│       │   │   ├── agent/     # AgentRunner implementations
│       │   │   │   └── claude-code/
│       │   │   ├── workspaces/# WorkspaceManager (git worktrees)
│       │   │   ├── queue/     # JobQueue (in-memory, BullMQ)
│       │   │   └── store/     # RunStore (SQLite, in-memory)
│       │   ├── composition/   # Dependency injection / wiring
│       │   ├── pipeline/      # Task orchestration (10-stage run lifecycle)
│       │   ├── skills/        # Prompt templates + MCP materializer
│       │   ├── config/        # Env schema (Zod) + loader
│       │   └── shared/        # Logger, metrics, result type, IDs
│       ├── assets/prompts/    # Skill prompt templates (Markdown)
│       └── test/
│           ├── unit/
│           ├── integration/
│           ├── fakes/         # In-memory test doubles
│           └── contracts/     # Port contract tests
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Run state machine

```mermaid
stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> PREPARING
    QUEUED --> CANCELLED
    PREPARING --> IMPLEMENTING
    PREPARING --> FAILED
    IMPLEMENTING --> VERIFYING
    IMPLEMENTING --> FAILED
    VERIFYING --> PUBLISHING
    VERIFYING --> FAILED
    PUBLISHING --> IN_REVIEW
    PUBLISHING --> FAILED
    IN_REVIEW --> REVIEWING
    REVIEWING --> DONE
    REVIEWING --> FAILED
    FAILED --> RETRYING
    RETRYING --> PREPARING
    DONE --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

## Webhook flow

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant API as HTTP Layer
    participant Q as JobQueue
    participant P as Pipeline

    GH->>API: POST /webhooks/github-projects
    API->>API: Verify HMAC-SHA256
    API-->>GH: 202 Accepted
    API->>API: Claim delivery ID (idempotency)
    API->>Q: enqueue(BOARD_EVENT)
    Q->>P: processJob()
    P->>P: fetchTask → startRun → executeRun
    P->>P: prepareWorkspace
    P->>P: buildPrompt (skills)
    P->>P: claude -p (stream NDJSON)
    P->>P: commitAll + push
    P->>GH: openPullRequest
    P->>GH: moveTask(IN_REVIEW)
```

## Dependency injection

```mermaid
graph TD
    Config["loadConfig()"]
    Auth["GitHubAuth"]
    Board["GitHubProjectsBoardProvider"]
    VCS["GitHubVcsProvider"]
    Agent["ClaudeCodeRunner"]
    WS["GitWorkspaceManager"]
    Store["SqliteRunStore"]
    Queue["InMemoryQueue | BullMQQueue"]
    Container["buildContainer()"]
    App["createApp()"]
    Server["HTTP Server"]

    Config --> Auth
    Auth --> Board
    Auth --> WS
    Config --> Board
    Config --> VCS
    Config --> Agent
    Config --> WS
    Config --> Store
    Config --> Queue
    Board --> Container
    VCS --> Container
    Agent --> Container
    WS --> Container
    Store --> Container
    Queue --> Container
    Config --> Container
    Container --> App
    App --> Server
```
