# syntax=docker/dockerfile:1
# Watcher scraper — monorepo production image (Playwright/Chromium)
# Build from repo root:
#   docker build -f docker/scraper.Dockerfile -t watcher-scraper .

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

# ── deps: only scraper workspace graph ───────────────────────────────────────
FROM oven/bun:1.2-debian AS deps
WORKDIR /app
COPY --from=manifests /app ./
# ignore-scripts: postinstall would pull browsers before OS libs are ready
RUN bun install --frozen-lockfile --filter @watcher/scraper --linker=hoisted --production --ignore-scripts

# ── runtime ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.2-debian
WORKDIR /app
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# System libs for Chromium (Debian package names vary slightly by release)
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

COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY apps/scraper ./apps/scraper

RUN test -e /app/node_modules/hono \
  && test -e /app/node_modules/playwright \
  && test -e /app/node_modules/@watcher/scraper \
  && test -e /app/node_modules/@watcher/shared

# Browsers after OS deps are present
RUN cd /app/apps/scraper \
  && bunx playwright install chromium \
  && bunx playwright install-deps chromium || true

EXPOSE 3001
CMD ["bun", "apps/scraper/src/index.ts"]
