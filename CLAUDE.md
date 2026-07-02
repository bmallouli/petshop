# Petshop — agent guide

Small full-stack TypeScript pet shop. pnpm workspace with two apps:

- `apps/api` — Fastify 5 + better-sqlite3. Routes in `src/app.ts`, DB schema/seed in `src/db.ts`. All request/response validation with zod at the route boundary.
- `apps/web` — React 19 + Vite. Single-page pet list in `src/App.tsx`; talks to the API via the Vite dev proxy (`/api/*` → `localhost:4000`).

## Commands (run from the repo root)

| What | Command |
|---|---|
| Install | `pnpm install` |
| Typecheck (lint) | `pnpm lint` |
| Unit tests | `pnpm test` |
| Build | `pnpm build` |
| E2E (starts both servers itself) | `pnpm e2e` |
| Run both apps for manual poking | `pnpm dev` (api :4000, web :5173) |

CI runs lint → test → build → e2e on every PR and must stay green.

## Conventions

- Conventional commit messages (`feat:`, `fix:`, `test:`, `chore:`).
- Every behavior change ships with a test in the same PR: API changes get a case in `apps/api/src/app.test.ts` (in-memory SQLite via `openDb(':memory:')`), UI changes get a case in `apps/web/src/App.test.tsx` or an e2e spec in `e2e/`.
- Money is stored as integer cents (`price_cents` / `priceCents`) — never floats.
- API errors are `{ "error": "<message>" }` with a meaningful HTTP status.
- Keep zod schemas next to the route that uses them; validate `req.query` and `req.body`, never trust raw input.
- No new dependencies without a good reason; prefer the standard library and what's already here.
