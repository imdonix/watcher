# Watcher API — monorepo production image
# Build from repo root:
#   docker build -f docker/api.Dockerfile -t watcher-api .
FROM oven/bun:1.2-debian
WORKDIR /app

# 1) Manifests only (better layer cache)
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
COPY apps/scraper/package.json ./apps/scraper/
COPY apps/web/package.json ./apps/web/
COPY docker/link-workspace-modules.sh ./docker/link-workspace-modules.sh
RUN chmod +x ./docker/link-workspace-modules.sh

RUN bun install --frozen-lockfile || bun install

# 2) Sources for packages this image needs
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# 3) Re-install after source copy, then force workspace → root node_modules links
#    (Bun resolves deps next to each package; plain hoisting is not enough)
RUN bun install --frozen-lockfile || bun install \
  && ./docker/link-workspace-modules.sh /app \
  && test -e /app/node_modules/hono \
  && test -e /app/node_modules/postgres \
  && test -e /app/node_modules/drizzle-orm \
  && test -e /app/apps/api/node_modules/hono \
  && test -e /app/packages/db/node_modules/postgres

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app
CMD ["bun", "apps/api/src/index.ts"]
