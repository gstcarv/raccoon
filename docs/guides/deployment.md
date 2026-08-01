# Deployment Guide

## Prerequisites

- Docker + Docker Compose (or a container platform)
- A GitHub account with a repository
- Claude Code CLI auth token (from `claude setup-token`)
- A public URL for webhook delivery (ngrok works for local testing)

## Quick start with Docker Compose

```bash
cp packages/core/.env.example .env
# Edit .env — fill in GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN, CLAUDE_CODE_OAUTH_TOKEN

docker compose up -d
```

The service starts on port 3000.

## Configure GitHub webhook

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. Payload URL: `https://your-raccoon.example.com/webhooks/github-projects`
3. Content type: `application/json`
4. Secret: the value of `GITHUB_WEBHOOK_SECRET`
5. Events: select **Projects v2 item** (under "Individual events")

## Health endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /healthz` | Always 200 — liveness probe |
| `GET /readyz` | 200 when store is reachable — readiness probe |
| `GET /metrics` | Prometheus metrics |

## Environment variables

See `packages/core/.env.example` for the full reference.

Minimum required:

| Variable | Description |
|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | HMAC secret from GitHub webhook settings |
| `GITHUB_TOKEN` or GitHub App vars | GitHub API auth |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code CLI auth |

## Production recommendations

- Run behind a reverse proxy (nginx, Caddy) with TLS termination
- Set `REDIS_URL` to use BullMQ for persistent, restartable job queues
- Use a GitHub App (not a PAT) for token rotation and fine-grained permissions
- Set `RACCOON_MAX_CONCURRENT_RUNS` to match your available compute
- Mount `/app/data` as a persistent volume
- Never set `RACCOON_ALLOW_DANGEROUS_PERMISSIONS=true` outside an isolated container

## Running `raccoon doctor`

```bash
docker compose exec raccoon node packages/core/dist/cli.js doctor
```

Or locally:

```bash
pnpm raccoon doctor
```
