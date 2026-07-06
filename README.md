# 🐾 Petshop

Small full-stack TypeScript app: a pet shop with a Fastify + SQLite API and a React/Vite UI.
This repo is the test-bed target for the Fleet agent pipeline — tickets come from Linear, PRs come from agents.

## Development quickstart

```bash
pnpm install    # install workspace dependencies
pnpm dev        # start the API (:4000) and web app (:5173) in dev mode
pnpm test       # run the unit tests
```

Run these from the repo root. See `CLAUDE.md` for the full command reference.

## Stack

- **API** (`apps/api`): Fastify 5, better-sqlite3, zod — port 4000
- **Web** (`apps/web`): React 19, Vite — port 5173, proxies `/api` to the API
- **Tests**: vitest (unit, both apps) + Playwright (e2e, chromium)

## Quick start

```bash
pnpm install
pnpm dev        # api on :4000, web on :5173
pnpm test       # unit tests
pnpm e2e        # end-to-end (starts both servers itself)
```

See `TESTING.md` for how to run the unit and e2e test suites (including the one-time Playwright browser install).
See `CLAUDE.md` for conventions and the full command reference.

## API endpoints

All routes are registered in `apps/api/src/app.ts`. Paths are served on the API port (4000); the web app reaches the `/api/*` routes through the Vite dev proxy.

### Health & metadata

- `GET /health` — liveness check; returns `{ status, petCount }`.
- `GET /version` — API version and process uptime in seconds.
- `GET /api/stats` — pet totals (total/adopted/available) plus a per-species breakdown.

### Pets

- `GET /api/pets` — list pets, optionally filtered by `species`, `status`, and name query `q` (on-hold pets hidden unless `status` is set).
- `GET /api/pets/adopted-recently` — pets adopted within the last month, most recently adopted first.
- `GET /api/pets/species` — distinct species across all pets, alphabetically sorted.
- `GET /api/pets/:id` — fetch a single pet by id.
- `POST /api/pets` — create a pet from `{ name, species, priceCents }`.
- `POST /api/pets/:id/adopt` — mark a pet as adopted.
- `POST /api/pets/:id/hold` — put an available pet on hold.
- `POST /api/pets/:id/release` — release an on-hold pet back to available.

### Visits

- `GET /api/pets/:id/visits` — list booked (upcoming) visits for a pet, cancellation codes omitted.
- `POST /api/pets/:id/visits` — book a visit from `{ visitorName, visitorEmail, startsAt }`.
- `POST /api/visits/:id/cancel` — cancel a visit with its `{ cancellationCode }`.

### Owner portal

Portal routes authenticate via the `x-owner-code` request header.

- `GET /api/portal/me` — the authenticated owner's `{ id, name }`.
- `GET /api/portal/pets` — pets belonging to the authenticated owner.
- `GET /api/portal/pets/:id/visits` — booked visits for one of the owner's pets, cancellation codes omitted.
