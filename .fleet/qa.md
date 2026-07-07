# Fleet playbook — QA

How to run and exercise this repository (read by Fleet's QA agent per
SPEC-SLICE23; this file lives on `main` — edits take effect after merge).

- pnpm workspace, Node 22. Dependencies are already installed in the runner.
- Regression first: `pnpm e2e` (Playwright — boots API + web itself via
  `playwright.config.ts` webServer). Chromium is baked into the runner
  image; if a browser is missing anyway, `npx playwright install chromium`
  and continue.
- Manual boot when a check needs a live server:
  - API: `nohup pnpm --filter @petshop/api start > /work/qa/api.log 2>&1 &`
    — Fastify on port **4000** (`PORT` overrides).
  - Web: `nohup pnpm --filter @petshop/web dev --host 0.0.0.0 > /work/qa/web.log 2>&1 &`
    — vite on **5173**, proxies `/api` and `/health` to the API. NO `--`
    before flags: pnpm hands vite a literal `--` and the flag is silently
    ignored.
  - Poll before use: `curl -sf localhost:4000/health`, `curl -sf localhost:5173`.
- Exercise the API with curl and the UI with Playwright specs under
  `/work/qa/`.
- This VM is small: never run two workspace-wide builds in parallel
  (`--workspace-concurrency=1` is the repo habit).
