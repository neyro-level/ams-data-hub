# Environment

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
| `OUTBOX_WORKER_ID` | worker | defaults to `ams-start-outbox` |
| `PGBOSS_SCHEMA` | worker | defaults to `pgboss` in scripts |
| `RELEASE_SHA` | server | exact deployed commit |
| `LOG_LEVEL` | server/worker | pino level |

Provider credentials are intentionally absent. Add product-specific credentials only in a derived product.
