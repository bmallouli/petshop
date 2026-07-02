# 🐾 Petshop

Small full-stack TypeScript app: a pet shop with a Fastify + SQLite API and a React/Vite UI.
This repo is the test-bed target for the Fleet agent pipeline — tickets come from Linear, PRs come from agents.

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

See `CLAUDE.md` for conventions and the full command reference.
