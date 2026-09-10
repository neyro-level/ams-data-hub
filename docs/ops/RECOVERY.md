# RECOVERY

## Scope

Два независимых контура:

1. code/runtime rollback — immutable release symlink + Nginx/systemd assets;
2. data recovery — PostgreSQL backup/restore.

Code rollback не откатывает schema/data. DB restore не является обычным способом отката релиза.

## Runtime rollback

Автоматический post-switch rollback выполняет `scripts/deploy-production.mjs` при ошибке после cutover:

- возвращает previous `current` symlink;
- восстанавливает previous Nginx/systemd topology;
- атомарно возвращает `shared/release.env` к SHA previous release;
- проверяет Nginx;
- перезапускает предыдущий web/worker runtime;
- не удаляет failed immutable release автоматически;
- не меняет PostgreSQL data.

Перед ручным rollback нужны exact current/previous SHA, release health DTO, service state и совместимость previous code с уже применённой schema.

## Database recovery

Production backup contract:

- custom-format `pg_dump`;
- checksum;
- private offsite copy;
- remote HEAD confirmation до retention;
- 7 daily / 8 weekly / 6 monthly;
- credentials outside Git/logs.

Restore procedure:

1. выбрать проверенный dump/checksum;
2. разрешить `latest.dump` в точный файл, подключить только этот файл read-only, дождаться завершения init-фазы временного PostgreSQL и восстановить dump во временную database;
3. проверить owner, migrations и key row counts;
4. проверить application compatibility;
5. только после отдельного owner decision планировать production restore;
6. сохранить incident evidence и rollback option.

`ops/postgres/restore-smoke.sh` никогда не должен восстанавливать поверх production.

## Failure classes

### Web release failure

Rollback code/assets; PostgreSQL не трогать.

### Migration failure до cutover

Deploy останавливается до symlink switch. Нельзя редактировать применённую migration; исправление — новая reviewed migration/compatibility plan.

### Worker partial provider failure

Не выполнять DB restore. Сохранить honest SourceRun/ReportSnapshot status, устранить provider access/quota issue и повторить sync.

### Worker unexpected failure

Проверить failed SyncRun/SourceRuns, safe logs и advisory lock release. Повторять только после root-cause correction.

### Outbox failure

- PENDING после retryable failure обрабатывается только после `availableAt`;
- PROCESSING со stale lease может быть reclaimed;
- DEAD_LETTER не повторяется автоматически;
- manual retry требует root-cause correction, new idempotent command и audit;
- rollback отключает несовместимый outbox timer и восстанавливает units previous release.

### Data corruption/loss

Остановить writes, сохранить текущее состояние, проверить offsite dump во временной DB и эскалировать owner decision. Не запускать destructive cleanup.

### Secret compromise

Следовать `TOKEN_ROTATION.md`; не публиковать secret/error bodies.

## Required proof

- exact code SHA and rollback SHA;
- DB migration state;
- health/auth/tenant smoke;
- live/ready DTO SHA совпадает с restored release env;
- worker status and timestamps;
- backup checksum/offsite confirmation;
- temporary restore row-count checks;
- incident timeline without secrets/PII.
