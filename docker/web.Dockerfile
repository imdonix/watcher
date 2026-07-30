# Watcher web SPA — monorepo production image
# Build from repo root:
#   docker build -f docker/web.Dockerfile -t watcher-web .
FROM oven/bun:1.2-debian AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
COPY apps/scraper/package.json ./apps/scraper/
COPY apps/web/package.json ./apps/web/
COPY docker/link-workspace-modules.sh ./docker/link-workspace-modules.sh
RUN chmod +x ./docker/link-workspace-modules.sh

RUN bun install --frozen-lockfile || bun install

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN bun install --frozen-lockfile || bun install \
  && ./docker/link-workspace-modules.sh /app

WORKDIR /app/apps/web
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

FROM nginx:1.27-alpine
ENV API_UPSTREAM=api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
