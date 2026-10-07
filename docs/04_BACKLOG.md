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

MP-00 доставлен PR #18 после exact-head RISKY Gate #185, merge
`23d1204fccb07afe25b8b8aa0c87ece0001e6b25`; GitHub mirror синхронизирован.
MP-01 доставлен PR #19 после exact-head Gate #198: текущий TOTP contour
удалён forward migration, auth regressions проверены. MP-02 доставлен PR #20
после exact-head Gate #207, merge `af0aa6092ae1ecc2a676840ae3ff2be615db3fc9`:
bounded streaming intake, private raw spool и large-feed synthetic proof.
MP-03 доставлен PR #21 после exact-head RISKY Gate #217, merge
`edbd8242c93aaea130570277f7719cf55f1e33cd`: concrete Source runtime,
atomic GOOD/Last Good и durable snapshot intent; GitHub mirror синхронизирован.
MP-06 доставлен PR #22 после exact-head RISKY Gate #226, merge
`185cf150cf093e6858b824629ddc6e0994e63240`: public HTML/media contracts,
scoped mirrored media и синтетическое producer-OFF proof; GitHub mirror совпадает.
MP-04 доставлен PR #23 после exact-head RISKY Gate #236, merge
`8dd7f7e6913e941dc3eee5ebff58f412d0dd8bcd`: concrete Source worker/scheduler,
manual dispatch, session fencing, shutdown и qualified readiness; Linux gate
подтвердил native cron и реальные OS SIGTERM. GitHub mirror совпадает.
MP-07 доставлен PR #24 после exact-head RISKY Gate #243, merge
`e5e3c960a1591c286156dab927f96cdbba70a2bf`: bounded snapshot verifier,
84 scoped unit tests и Linux build PASS; публичное GitHub mirror совпадает.
Текущий участок — MP-05 assembly. MP-05.1 остаётся IN_PROGRESS:
полный private DB capture command, immutable input persistence и allocator
прошли native NOBYPASS PostgreSQL proof: 18 sections, replay после изменения
живых фактов, concurrent same-key capture, rollback и 4100 объектов/8200 media
positions в неизменном 30-second worker limit. Закрытие задачи требует clean
pushed checkpoint и execution ledger; public projectors/build/sign/publication
ещё не завершены.
Runtime Source/snapshot/operations composition не объявляется
завершённой по существованию модулей или закрытию исторического графа.

Активная доработка: MP-05/MP-08–MP-10 нового remediation plan;
MP-00–MP-04, MP-06 и MP-07 закрыты.
Далее — snapshot public projectors, build/sign/publication orchestration,
operations executors
и синтетическое end-to-end proof. Реализация runtime adapters и расписаний
входит в утверждённую доработку; их включение на production — нет.

Production feed credentials, миграция production и rollout — только отдельной
release/операционной командой владельца после readiness gate.
Синтетический contract PASS и закрытый graph не заменяют live proof.

## Delivery

Push и PR — zero-CI. Merge требует один manual exact-head RISKY Gate согласно
CRITICAL profile. Production требует отдельный exact-main SourceCraft release
с immutable registry digests, live proof и rollback contract.
