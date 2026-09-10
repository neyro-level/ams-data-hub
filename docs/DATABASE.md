# DATABASE

## Назначение

PostgreSQL — единственный runtime source of truth AMS IMPULSE. Prisma schema определяет tables, relations, indexes и enums; application работает через repository ports.

## Топология

Approved production contract:

- PostgreSQL `18.x` доступен production processes через Linux host networking;
- host-local deployment expects loopback/Unix-socket administration and no public `5432`;
- app, test, migration and backup credentials are separated;
- exact live host/database/version are confirmed only by read-only server proof before release.

Self-managed PostgreSQL 18 is an approved project exception under Core 3.4. Managed PostgreSQL is `NOT_APPLICABLE`; no migration plan is required.

Фактический host/port/database name берётся из protected environment, не из browser или checked-in config.

## Roles

### Runtime app role

Используется Next.js и worker. Имеет только connect/read/write runtime tables/sequences, без superuser и schema migration privileges.

### Migrator role

Используется `prisma migrate deploy` и schema rollout. Web/worker не получают эти credentials.

Local development, tests and production use distinct database identities. Test identity contains an explicit `test` marker and may connect only to a database ending in `_test`; development identity is local/dev-only and targets `_dev`. Production rejects either marker.

## Schema policy

- source of truth: `prisma/schema.prisma`;
- applied migration не редактируется;
- schema change требует новой migration;
- production: только `pnpm prisma:deploy`;
- Prisma migration/introspection commands require an explicit `DATABASE_URL`; only client generation is allowed without a target;
- `prisma db push` в production запрещён;
- destructive migration требует backup, compatibility plan и owner approval;
- relational columns используются для identity, access и queryable metrics; JSONB — только для validated complex snapshots/DTO.

Подробная модель: `docs/DATA_MODEL.md`.

## Connection lifecycle

- `src/platform/database/prisma/client.ts` создаёт один shared Prisma/pg context на process;
- worker advisory lock удерживает выделенное pg connection до завершения full sync;
- `/api/health/ready` выполняет реальный DB ping;
- отсутствие DB configuration приводит к явному unavailable/503, а не fallback на filesystem.

Prisma migrations own application schema history. pg-boss schema lifecycle is separate and runs only through the explicit migration entrypoint.

## Local and test PostgreSQL

- Windows-native PostgreSQL `18.6` service;
- bind: `127.0.0.1`, canonical host port `5435`;
- separate databases and roles: `seo_monitor_dev`/`seo_monitor_local`, `seo_monitor_test`/`seo_monitor_test`;
- credentials exist only in ignored `.env.local`;
- `dev:db:start` and `dev:db:status` verify connection identity; `dev:db:stop` leaves the shared Windows service running;
- Docker Desktop/Compose is not part of ordinary local development;
- integration runner rejects a database or identity without the test marker, then generates Prisma client, applies migrations, runs only synthetic test bootstrap and executes DB suites;
- SourceCraft `risky-check` поднимает isolated PostgreSQL для профильных DB/auth/tenant/worker checks перед merge.

Runbook: `docs/ops/LOCAL_DEVELOPMENT.md`.

## Backup contract

Каждый production backup:

1. создаёт `pg_dump` custom-format;
2. вычисляет checksum;
3. загружает dump/checksum в private offsite S3-compatible storage;
4. подтверждает remote object через HEAD;
5. только после успешного подтверждения применяет retention;
6. пишет safe operational status без credentials.

Retention baseline:

- 7 daily;
- 8 weekly;
- 6 monthly.

Backup на том же VPS без offsite copy не считается достаточным.

## Restore smoke

`ops/postgres/restore-smoke.sh`:

- создаёт временную restore database;
- восстанавливает последний custom-format dump;
- проверяет database identity, Prisma migrations и key row counts;
- требует ненулевые Project, Site и ReportSnapshot counts;
- удаляет временную БД в cleanup;
- никогда не восстанавливает поверх production.

## Data safety

- release rollback не откатывает DB schema/data;
- physical delete project/site/history — отдельная destructive operation;
- test/dev DB names должны явно относиться к безопасному environment;
- production deploy никогда не импортирует operator configuration;
- `seed:bootstrap` создаёт только отсутствующие default/reference records и не обновляет existing business data;
- `config:sync --source <private-path>` является dry-run, а запись требует отдельного `--apply`; отсутствующие tracked queries/sites отключаются, записи без безопасного disable остаются без физического удаления;
- backup/restore credentials хранятся в Doppler/protected server env.

## Операционный статус

Repository содержит schema, migrations, bootstrap, explicit config sync, backup и restore tooling. Live database version, backup object, restore result и deployed migration state подтверждаются только server-side operational proof; не выводятся из документа по предположению.
