# Watcher

Monorepo rewrite of the deal-watcher app. Scrapes **jofogas.hu**, **ingatlan.com**, and **hasznaltauto.hu**, stores new listings in Postgres, and notifies via the API logger (console).

## Architecture

| Package / app        | Stack                         | Role                                      |
|----------------------|-------------------------------|-------------------------------------------|
| `packages/shared`    | TypeScript                    | Engine metadata, types, ID hashing        |
| `packages/db`        | Drizzle ORM + Kit migrations  | Schema (`schema.ts`) + SQL under `drizzle/` |
| `apps/api`           | Bun + Hono + API token        | Auth, routines, items, scheduler, notify  |
| `apps/scraper`       | Bun + Playwright (Chromium)   | Headless scraping with anti-bot measures  |
| `apps/web`           | React + Vite + Tailwind/shadcn| SPA dashboard                             |

Legacy Node/Express/SQLite code lives in `legacy/` for reference.

## Quick start (Docker)

All runtime config is **embedded in `docker-compose.yml`** (no `.env` for Compose).

```bash
# optional: edit API_TOKEN and intervals in docker-compose.yml
docker compose up --build
```

- Web UI: http://localhost:8080  
- API: http://localhost:3000  
- Scraper: http://localhost:3001  
- **API token**: set `API_TOKEN` in compose, or leave empty — first boot generates one, stores it in `settings` (`api_token`), reuses it on restart. Always printed at end of API boot logs.

## Local development (Bun)

Config comes from process environment or built-in defaults in each app (same keys as Compose). No `.env` files in the repo.

```bash
# start only postgres from compose
docker compose up -d db

bun install

# optional: export API_TOKEN / DATABASE_URL / VAPID_* in your shell
# terminal 1 — scraper
cd apps/scraper && bunx playwright install chromium && bun run dev

# terminal 2 — API (runs Drizzle migrations on boot)
cd apps/api && bun run dev

# terminal 3 — web
cd apps/web && bun run dev
```

Web dev server: http://localhost:5173 (proxies `/api` → API).

## Features

- **Multi-page SPA**: Listings · Routines · Status
- **Routines** with engine-specific options (structured **ingatlan.com** path builder)
- **Status page**: service health, next scrape/notify times, run history
- **Persisted schedule** (`scheduler_state` table) — restarts do not reset scrape/notify timing
- **Scheduled scrapes**; **notify after every scrape** (success or failure)
- **PWA** + **Web Push**
- **Listing tracking**: permanent `listings` + `listing_sightings` (price/history) + `listing_events` (first_seen / price_change / missing / reappeared). Missing is only set after a **complete** routine scrape.
- **Postgres**: `search_routines`, `listings`, `listing_sightings`, `listing_events`, `scrape_runs`, `scrape_routine_results`, `settings`, …

## Scraper engines

### jofogas.hu
- `keywords`, `domain`, `minPrice` / `maxPrice`, company/post filters, page `depth`

### ingatlan.com
Builds `/lista/{segments}` (or legacy `/szukites/`) from form fields:
- listing type, property type, location, rooms, area, price in full Ft (e.g. 30000000 → 30-mFt), condition, extra filters
- optional advanced full path override
- live path preview in the UI

### hasznaltauto.hu
- `key` — segment from the results URL
- `keywords` — UI label
- `depth` — pages

## Configuration

| Context | Where to set values |
|---------|---------------------|
| Docker full stack | `docker-compose.yml` → each service `environment` |
| Local Bun dev | shell exports or app defaults in code |

Important keys (same names in both places):

| Variable | Description |
|----------|-------------|
| `API_TOKEN` | Optional fixed token (empty → generate once, persist in `settings`) |
| `DATABASE_URL` | Postgres connection string |
| `SCRAPER_URL` | API → scraper base URL |

| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push VAPID keys (keep stable) |
| `VAPID_SUBJECT` | e.g. `mailto:you@example.com` |
| `HEADLESS` | Playwright headless mode |

### Push notifications

1. Open the app (HTTPS or localhost), sign in with the API token  
2. Click **Enable push** and allow notifications  
3. Scheduled or manual **Notify** sends a Web Push to all subscribed browsers and logs deals  

Requires a **secure context** (HTTPS in production; `localhost` is fine for dev).

## API overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | — | `{ token }` validate API token |
| GET | `/auth/me` | Bearer | Confirm token |
| GET | `/engines` | — | Scraper engine schemas |
| GET/POST | `/routines`, `/routines/upload` | Bearer | List / replace routines |
| GET | `/items` | Bearer | Found deals |
| POST | `/scrap` | Bearer | Force scrape |
| POST | `/notify` | Bearer | Force notify (log + web push) |
| GET | `/status` | Bearer | Health, schedule, scrape run history |
| GET | `/push/vapid-public-key` | — | VAPID public key for PushManager |
| POST | `/push/subscribe` | Bearer | Register browser push subscription |
| POST | `/push/unsubscribe` | Bearer | Remove subscription |
| GET | `/health` | — | API + scraper status |

Protected routes accept `Authorization: Bearer <API_TOKEN>` or `X-API-Token: <API_TOKEN>`.

## Database migrations (Drizzle Kit)

Schema source of truth: `packages/db/src/schema.ts`  
SQL migrations: `packages/db/drizzle/` (committed)

```bash
# after editing schema.ts — preferred for commits / Docker
bun run db:generate -- --name describe_change
export DATABASE_URL=postgresql://watcher:watcher@localhost:5432/watcher
bun run db:migrate

# optional local shortcut: push schema.ts straight to DB (no migration file)
bun run db:push
```

| Command | What it does |
|---------|----------------|
| `db:generate` | Write SQL under `packages/db/drizzle/` from `schema.ts` |
| `db:migrate` | Apply pending migration files (API also does this on boot) |
| `db:push` | Sync `schema.ts` to the DB without a migration file (`--force`, no prompt; dev only) |
| `db:studio` | Open Drizzle Studio |

Prefer **generate + migrate** for anything shared/Docker. Use **push** only for throwaway local experimentation.

## Notes

- Listing IDs use the same `cyrb53` hash as the legacy app.
- Sites change markup often; scrapers live under `apps/scraper/src/engines/`.
- For production, either set `API_TOKEN` or rely on the first generated value in `settings` (check API logs once).
- Notify uses logger + web push.
