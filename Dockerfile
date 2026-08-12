# syntax=docker/dockerfile:1

# ── deps ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN corepack enable pnpm && HUSKY=0 pnpm install --frozen-lockfile --prod

# ── build ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json packages/core/tsconfig*.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/core/assets ./packages/core/assets
RUN corepack enable pnpm && pnpm install --frozen-lockfile
RUN pnpm build

# ── dev (hot-reload, all deps, source mounted via volume) ──────────────────────
FROM node:22-alpine AS dev
RUN apk add --no-cache tini git
WORKDIR /app
RUN corepack enable pnpm
# deps installed at build time; source is mounted at runtime
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json packages/core/tsconfig*.json ./packages/core/
RUN pnpm install --frozen-lockfile
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "core", "dev"]

# ── runtime ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini git && npm install -g @anthropic-ai/claude-code
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/assets ./packages/core/assets
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/core/dist/server.js"]
