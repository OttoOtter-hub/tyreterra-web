# Deployment & Environments

## Environments

| Env | Selector | DB | Used for |
|---|---|---|---|
| **Production** (default) | nothing set / `APP_ENV` unset | Neon `main` branch | Live site at `84.247.189.142` |
| **Staging** | `APP_ENV=staging` | Neon `staging` branch (copy-on-write clone of `main`) | Safe iteration before merging risky changes (e.g. Distributor Orders module) |

Production stays the default in every script — you must explicitly opt into staging.

## Config files (`apps/api/`)

- `.env` — production credentials (gitignored, already exists, **unchanged**)
- `.env.staging` — staging credentials (gitignored, new). Uses a single `DATABASE_URL` instead of the discrete `DATABASE_HOST/PORT/USER/PASSWORD/NAME` vars — both forms are supported; `DATABASE_URL` takes priority when present.

`.gitignore` covers `.env`, `.env.local`, `.env.staging`, and `.env.*.local` — none of these are ever committed.

## Running against staging vs production

```bash
cd apps/api

# Production (default — no flag needed)
npm run start:dev
npm run migration:run

# Staging
npm run start:staging          # nest start with APP_ENV=staging
npm run migration:run:staging  # migrations against staging only
npm run migration:revert:staging
```

Internally this works by loading `.env.staging` instead of `.env` whenever `APP_ENV=staging` is set (`main.ts`, `app.module.ts`, and `src/config/data-source.ts` all branch on the same variable). No other code path changed.

## Migrations tracking

TypeORM's `migrations` table tracks which migration files have been applied per database. Production and staging each have their own `migrations` table — applying a migration on one **never** touches the other.

> Historical note: migrations 1–6 were originally applied to production via ad-hoc SQL scripts rather than `npm run migration:run`, so the `migrations` table didn't exist yet. Both production and the new staging branch had their tracking tables backfilled with records for migrations 1–6 to reflect actual schema state. From migration 7 onward, always use `npm run migration:run` / `npm run migration:run:staging` — don't hand-run SQL.

## Creating a new migration

```bash
cd apps/api
npm run migration:generate -- src/migrations/DescriptiveName
# review the generated file, then:
npm run migration:run             # apply to production
# or, to test first:
npm run migration:run:staging     # apply to staging only
```

Always test a new migration against staging before running it on production.

## Deploying the built app (manual — no CI/CD yet)

Production deploys are a manual build → scp → pm2 restart cycle (see chat history / future `DEPLOY.md` automation if added). This file only covers **environment selection**, not the deploy script itself.
