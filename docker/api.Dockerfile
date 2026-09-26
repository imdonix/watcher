# syntax=docker/dockerfile:1
# Watcher API — monorepo production image
# Build from repo root:
#   docker build -f docker/api.Dockerfile -t watcher-api .

# ── manifests: every workspace package.json, nothing else ────────────────────
# Auto-discovers packages/* and apps/* so we never list each manifest by hand.
# BuildKit content-hashes this stage → bun install stays cached until deps change.
FROM oven/bun:1.4.2-debian AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN find packages apps -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null; \
    find packages apps -type f ! -name package.json -delete; \
    find packages apps -type d -empty -delete 2>/dev/null; \
    true

# ── deps: install only this app's workspace graph ────────────────────────────
FROM oven/bun:1.4.2-debian AS deps
WORKDIR /app
COPY --from=manifests /app ./
# --filter: skip web/scraper trees
# --linker=hoisted: root node_modules (no per-package link script)
# --production: runtime image does not need typescript / @types
RUN bun install --frozen-lockfile --filter @watcher/api --linker=hoisted --production

# ── runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.2-debian
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Sanity: filtered install + hoisted linker put runtime deps at the root
RUN test -e /app/node_modules/hono \
  && test -e /app/node_modules/postgres \
  && test -e /app/node_modules/drizzle-orm \
  && test -e /app/node_modules/@watcher/api \
  && test -e /app/node_modules/@watcher/db \
  && test -e /app/node_modules/@watcher/shared

EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]
