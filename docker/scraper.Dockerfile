# Watcher scraper — monorepo production image (Playwright/Chromium)
# Build from repo root:
#   docker build -f docker/scraper.Dockerfile -t watcher-scraper .
FROM oven/bun:1.2-debian
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libwayland-client0 fonts-liberation ca-certificates \
    || apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libwayland-client0 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
COPY apps/scraper ./apps/scraper

RUN bun install --frozen-lockfile || bun install \
  && ./docker/link-workspace-modules.sh /app \
  && test -e /app/node_modules/hono \
  && test -e /app/node_modules/playwright \
  && test -e /app/apps/scraper/node_modules/hono

# Browsers (after deps linked)
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN cd /app/apps/scraper \
  && bunx playwright install chromium \
  && bunx playwright install-deps chromium || true

ENV NODE_ENV=production
ENV HEADLESS=true
EXPOSE 3001
WORKDIR /app
CMD ["bun", "apps/scraper/src/index.ts"]
