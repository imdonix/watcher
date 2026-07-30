# syntax=docker/dockerfile:1
# Watcher web SPA — monorepo production image
# Build from repo root:
#   docker build -f docker/web.Dockerfile -t watcher-web .

# ── manifests: every workspace package.json, nothing else ────────────────────
FROM oven/bun:1.2-debian AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN find packages apps -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null; \
    find packages apps -type f ! -name package.json -delete; \
    find packages apps -type d -empty -delete 2>/dev/null; \
    true

# ── build: need devDependencies (vite, typescript, …) ────────────────────────
FROM oven/bun:1.2-debian AS build
WORKDIR /app
COPY --from=manifests /app ./
RUN bun install --frozen-lockfile --filter @watcher/web --linker=hoisted

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

WORKDIR /app/apps/web
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

# ── runtime: static assets only ──────────────────────────────────────────────
FROM nginx:1.27-alpine
ENV API_UPSTREAM=api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
