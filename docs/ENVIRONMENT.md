# ENVIRONMENT

Реестр имён и ownership переменных AMS IMPULSE. Значения секретов в Git и документации запрещены.

## Sources and isolation

- local development: ignored `.env.local`, подготовленный по `.env.example`;
- canonical application secret source: Doppler project/config `ams-research/prd` до отдельного owner-approved переноса;
- production web, worker, migrator и backup: отдельные root-owned protected environment files, материализованные оператором из разрешённого secret source;
- release identity: root-owned generated `shared/release.env`;
- tests: explicit `TEST_DATABASE_*`; production credentials недоступны;
- SourceCraft inputs (`EXPECTED_COMMIT_SHA` и workflow values) принадлежат CI, а не application env.

Один credential не переиспользуется между runtime, migration, test и backup. Изменение runtime secret требует restart соответствующего process; изменение `NEXT_PUBLIC_*` требует rebuild/redeploy.

## Database

| Variable | Required | Environments / consumer | Secret | Owner / change effect |
|---|---|---|---|---|
| `APP_ENV` | DB runtime/commands | web, worker, admin scripts | no | explicit `development`, `test` or `production` target class |
| `DATABASE_URL` | alternative | web, worker, migrator | yes | protected env; restart, migrator uses separate credential |
| `DATABASE_HOST` | alternative set | web, worker, migrator | no | protected env; restart |
| `DATABASE_PORT` | optional | web, worker, migrator | no | protected env; restart |
| `DATABASE_USER` | alternative set | web, worker, migrator | no | role identity; restart |
| `DATABASE_PASSWORD` | alternative set | web, worker, migrator | yes | protected env; restart and rotate by boundary |
| `DATABASE_NAME` | alternative set | web, worker, migrator | no | explicit target; restart |
| `DATABASE_SSLMODE` | optional | web, worker, migrator | no | connection policy; restart |

Application runtime accepts one explicit URL or the complete component set. Prisma DB commands require an explicit `DATABASE_URL`; `prisma generate` is the only DB-independent Prisma command. Partial configuration and environment/identity mismatches fail closed. Diagnostics contain only environment, host, port, database and identity — never a full URL or password.

## Web and auth

| Variable | Required | Consumer | Secret | Owner / change effect |
|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | production web | web | yes | protected web env; restart invalidation policy per recovery runbook |
| `BETTER_AUTH_URL` | production web | web | no | canonical HTTPS origin; restart |
| `RELEASE_SHA` | release | web/worker | no | generated release env; redeploy |
| `NEXT_PUBLIC_LEADS_API_URL` | public lead form | build/browser | no | reviewed allowlisted origin; rebuild |
| `NEXT_PUBLIC_LEADS_PROJECT_ID` | public lead form | build/browser | no | public project identifier; rebuild |
| `NEXT_PUBLIC_LEADS_SITE_KEY` | public lead form | build/browser | no | public anti-abuse site key, not read credential; rebuild |
| `NODE_ENV` | runtime | web/worker | no | compose/runtime; redeploy |

E2E uses the explicit `APP_ENV=test` identity. Auth policy не имеет environment bypass для входа или authorization.

## Worker and providers

| Variable | Required | Consumer | Secret | Owner / change effect |
|---|---|---|---|---|
| `YANDEX_WEBMASTER_API_BASE_URL` | when enabled | worker | no | exact allowlisted HTTPS origin; restart |
| `YANDEX_WEBMASTER_OAUTH_TOKEN` | when enabled | worker | yes | protected worker env; restart/rotate |
| `YANDEX_WEBMASTER_TOKEN_STATUS` | when enabled | worker | no | must allow active use; restart |
| `YANDEX_METRICA_API_BASE_URL` | when enabled | worker | no | exact allowlisted HTTPS origin; restart |
| `YANDEX_METRICA_OAUTH_TOKEN` | when enabled | worker | yes | protected worker env; restart/rotate |
| `YANDEX_METRICA_TOKEN_STATUS` | when enabled | worker | no | must allow active use; restart |
| `TOPVISOR_USER_ID` | when enabled | worker | yes | protected worker env; restart/rotate |
| `TOPVISOR_API_KEY` | when enabled | worker | yes | protected worker env; restart/rotate |
| `TOPVISOR_API_BASE_URL` | optional | worker | no | defaults to official allowlisted API; restart |
| `OUTBOX_WORKER_ID` | optional | outbox daemon | no | stable runtime identity; restart |
| `OUTBOX_POLL_DELAY_MS` | optional | outbox daemon | no | polling interval; restart |
| `LOG_LEVEL` | optional | web/worker | no | structured logging threshold; restart |
| `PGBOSS_SCHEMA` | optional | migration command | no | queue schema name; migration scope only |

Site URLs are loaded server-side from PostgreSQL and passed to provider adapters; they are not long-lived production authority from browser env.

Provider credential presence не включает источник автоматически. Provider call разрешён только когда PostgreSQL `ProviderConnection.enabled=true`, а worker env после materialization/restart содержит соответствующие credential names. Для Topvisor проект и четыре search targets находятся либо создаются worker; keyword import и checker разрешены только после durable operation reservation и обязательного price-check. `seo-monitor-topvisor-checks.timer` запускает недельную проверку в понедельник до ежедневного сбора; успешная запись позиций завершает durable operation.

## Local and test database

| Variable | Required | Consumer | Secret | Owner |
|---|---|---|---|---|
| `LOCAL_POSTGRES_PORT` | local | Docker PostgreSQL | no | developer |
| `LOCAL_POSTGRES_USER` | local | Docker PostgreSQL | no | developer |
| `LOCAL_POSTGRES_PASSWORD` | local | Docker PostgreSQL | yes | ignored local env |
| `TEST_DATABASE_HOST/PORT/USER/PASSWORD/NAME/SSLMODE` | integration | test runner | mixed | isolated test environment |

`TEST_DATABASE_NAME` must end with `_test`; `TEST_DATABASE_USER` must identify a dedicated test role and differ from local/production identities. Development uses a `_dev` database and local/development identity; production rejects both suffixes and identities.

## Backup and restore

| Variable | Required | Consumer | Secret | Owner |
|---|---|---|---|---|
| `DB_NAME`, `BACKUP_ROOT`, `BACKUP_FILE` | operation-specific | backup/restore scripts | no | protected ops env |
| `KEEP_DAILY`, `KEEP_WEEKLY`, `KEEP_MONTHLY` | optional | backup | no | retention policy |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION` | production backup | backup | no | protected ops env |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | production backup | backup | yes | backup-only credential |
| `REQUIRE_OFFSITE` | production backup | backup | no | must be `true` for release backup |
| `POSTGRES_IMAGE` | restore smoke | restore | no | reviewed PostgreSQL 18 image |
| `MIN_PROJECT_COUNT`, `MIN_SITE_COUNT`, `MIN_REPORT_COUNT` | restore smoke | restore | no | sanity thresholds |

Backup variables never enter web/worker containers. Restore smoke targets only an ephemeral database.

## Verification

- `.env.example` contains names and safe placeholders/defaults only;
- application schemas validate DB/auth/public/release values;
- deploy validates separated protected env files before cutover;
- new variable requires updating this registry, `.env.example` when locally relevant, validation and the owning runbook.
