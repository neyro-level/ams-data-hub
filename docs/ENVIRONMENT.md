# Environment

**Status:** Active extension. This file is the value-free variable registry
defined by `03_ARCHITECTURE.md`.

Use `.env.example` as the neutral template.

## Required

| Variable | Scope | Notes |
| --- | --- | --- |
| `APP_ENV` | server | `development`, `test` or `production` |
| `DATABASE_URL` or `DATABASE_*` | server | PostgreSQL connection |
| `BETTER_AUTH_SECRET` | server | secret, production-only value |
| `BETTER_AUTH_URL` | server/public origin | exact app URL |

## Optional

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CONTACT_API_URL` | browser | enables contact delivery |
| `NEXT_PUBLIC_CONTACT_PROJECT_ID` | browser | public routing identifier |
| `NEXT_PUBLIC_CONTACT_SITE_KEY` | browser | public site identifier |
| `OUTBOX_WORKER_ID` | worker | unique identity per running worker replica |
| `OUTBOX_POLL_DELAY_MS` | worker | idle poll delay; defaults to `1000` ms |
| `OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS` | worker | maximum graceful drain wait for the active handler; defaults to `30000` ms |
| `PGBOSS_SCHEMA` | worker | defaults to `pgboss` in scripts |
| `RELEASE_SHA` | server | exact deployed commit |
| `LOG_LEVEL` | server/worker | pino level |

Provider credentials are intentionally absent. Add product-specific credentials only in a derived product.

## Integration-test database

`pnpm test:integration` accepts only a native PostgreSQL 18 target whose
`APP_ENV=test`, host is literal loopback, database ends in `_test` and role is
different from `LOCAL_POSTGRES_USER`. The command resets only that guarded
database before and after the run; it never uses `DATABASE_URL` from a
development or production target.
