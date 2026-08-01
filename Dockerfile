# syntax=docker/dockerfile:1

# ── deps ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod

# ── build ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json packages/core/tsconfig*.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/core/assets ./packages/core/assets
RUN corepack enable pnpm && pnpm install --frozen-lockfile
RUN pnpm build

# ── runtime ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini git
WORKDIR /app

# Non-root user
RUN addgroup -S raccoon && adduser -S raccoon -G raccoon

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/assets ./packages/core/assets
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/

RUN mkdir -p /app/data && chown -R raccoon:raccoon /app/data
USER raccoon

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/core/dist/server.js"]
