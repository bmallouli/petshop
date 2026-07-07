# Testing

Petshop is verified in three layers, all run from the repository root after `pnpm install`:

- **Lint** — TypeScript typecheck across every workspace package.
- **Unit tests** — [vitest](https://vitest.dev), one suite per app (`apps/api`, `apps/web`).
- **End-to-end tests** — [Playwright](https://playwright.dev) (chromium), driving the real API + web servers. Specs live in `e2e/`.

CI runs `lint → test → build → e2e` on every PR and must stay green, so running these locally mirrors what CI checks.

## Lint

```bash
pnpm lint
```

This runs `pnpm -r lint`, which typechecks every workspace package (`apps/api` and `apps/web`) with `tsc`.

## Unit tests

```bash
pnpm test
```

This runs `pnpm -r test`, which invokes `vitest run` in every workspace package (`apps/api` and `apps/web`). The API suite uses an in-memory SQLite database (`openDb(':memory:')`); the web suite runs against jsdom.

To run a single app's suite:

```bash
pnpm --filter @petshop/api test
pnpm --filter @petshop/web test
```

## End-to-end tests

### One-time browser install

Playwright needs its browser binaries installed once before the e2e suite can run:

```bash
pnpm exec playwright install chromium
```

(The e2e suite only uses chromium. Drop the `chromium` argument to install every Playwright browser.)

### Run the suite

```bash
pnpm e2e
```

This runs `playwright test`. Playwright starts both servers itself — the API (`pnpm --filter @petshop/api start` on `:4000`, against a throwaway `data/e2e.db`) and the web dev server (`pnpm --filter @petshop/web dev` on `:5173`) — so you do **not** need `pnpm dev` running first. The specs live in `e2e/`.

## Running on small VMs

Workspace-wide builds must run with `--workspace-concurrency=1` on small VMs to avoid exhausting memory when compiling packages in parallel:

```bash
pnpm -r --workspace-concurrency=1 build
```

The same flag applies to the other recursive scripts (`pnpm -r --workspace-concurrency=1 lint` and `pnpm -r --workspace-concurrency=1 test`) when resources are tight.
