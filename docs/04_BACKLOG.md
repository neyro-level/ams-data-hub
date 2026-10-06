# Backlog — AMS Data Hub

**Статус:** Active
**Execution source:** `AMS-DATA-HUB-REMEDIATION-2026-10 v1 APPROVED`,
`../AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.md`,
его отдельный inventory и Task Manager. Этот файл — продуктовая сводка,
не второй task graph. `AMS-DATA-HUB-IMPLEMENTATION-2026-01 v4` завершён
и сохраняется как историческая программа.

## Выполнено

- DH-00–DH-09: все 82 managed nodes закрыты; зависимости сверены.
- Delivery — `MERGE_AFTER_GATE`; исторический DH-01 PR_ONLY включён в
  консолидацию DH-00. Финальный DH-09: PR #15, RISKY Gate #165 PASS,
  merge `dde4d7ff25f353b9a099962716b85e3206c1a306`.
- Non-production Timeweb S3 provider denial proof и cleanup — PASS.
- Независимый local-mode consumer drill — PASS; production не выпускался.
- XML-профили Yandex Realty, Domclick, Avito v3 и CIAN v2 доставлены PR #16
  как отдельное расширение после completion boundary v4.

## Расширения после v4

- `adh-newbuilding-import-foundation`: черновик дополнен транзакционным
  ручным применением, audit/revision, reviewed-diff gate и PostgreSQL
  isolation/rollback/upgrade tests. PR, exact-head RISKY Gate и merge evidence
  принадлежат Task Manager ledger, а не второму графу в документации.
- Канон и delivery pointers сверены с действующими runtime-контрактами;
  GitHub остаётся односторонним зеркалом SourceCraft `main`.

## Следующая граница

MP-00 фиксирует owner amendments и синхронизирует текущий канон. Checkpoint
implementation evidence находится в Beads; merge в `main` ещё требует отдельный
MP-00 exact-head Gate и delivery ledger. Legacy TOTP-код до MP-01 остаётся
неудалённым. Runtime Source/snapshot/operations composition не объявляется
завершённой по существованию модулей или закрытию исторического графа.

Активная доработка: MP-00–MP-10 нового remediation plan. Первая волна —
согласование канона с owner decisions и удаление текущего требования TOTP.
Далее — streaming intake, production composition, source worker/scheduler,
snapshot assembly, public contracts, verifier hardening, operations executors
и синтетическое end-to-end proof. Реализация runtime adapters и расписаний
входит в утверждённую доработку; их включение на production — нет.

Production feed credentials, миграция production и rollout — только отдельной
release/операционной командой владельца после readiness gate.
Синтетический contract PASS и закрытый graph не заменяют live proof.

## Delivery

Push и PR — zero-CI. Merge требует один manual exact-head RISKY Gate согласно
CRITICAL profile. Production требует отдельный exact-main SourceCraft release
с immutable registry digests, live proof и rollback contract.
