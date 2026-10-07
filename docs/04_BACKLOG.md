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
MP-05 доставлен PR #25 после exact-head RISKY Gate #287, merge
`cfd06997693f0c5bb55ef6b285c6a4136013d18a`: 290 units, 166 native cases,
Linux build PASS. Локальный main и публичное GitHub mirror совпадают.
MP-05.1–MP-05.11 закрыты implementation ledger. MP-05.11 имеет concrete thirteen-dataset compose/sign,
immutable binding, повторное Source/Project/Catalog/Media admission после PUT,
atomic current/DeliveryRun и optional executor существующего Source worker.
Targeted proof: 78 unit tests, 22 native publication/delivery cases, 3 full
runtime-function cases с настоящим local pg-boss, enabled/disabled/config rejection
и observed/cleared own-owner heartbeat. Closure и delivery ledger принадлежат
Task Manager; production не обновлялся. Текущий участок — MP-08.1:
durable operational requests/outbox и шесть реальных исполнителей.
Foundation checkpoint не закрывает этот task и не означает исполнение запросов.
Предыдущий verified checkpoint — fenced lifecycle и concrete SUSPICIOUS_REJECT:
review/audit/request success в одной транзакции, immutable replay и Last GOOD
unchanged. На том checkpoint rejection adapter подключён к общей очереди;
остальные пять оставались reserved. Terminal FAILED сверяется с DEAD_LETTER/latest FAILED
JobRun на старте и каждые 60 секунд; unresolved requests защищены от retention.
Непривязанные/некорректные terminal intents не блокируют общий worker и не
создают фиктивный FAILED. Native PostgreSQL/pg-boss — 48/48 PASS в пяти suites,
включая actual combined-worker startup/restart и qualified/cleared heartbeat;
28 scoped unit tests PASS. Этот checkpoint не закрывал полный MP-08.1 DoD;
task остаётся открытым.

Текущий delta BUILD отделяет completed staging от publication:
immutable scoped stage receipt появляется только после settled artifact/manifest
PUT и повторного четырёхстороннего admission. Replay не требует ключа или IO,
а failed/cancelled staging не создаёт current/DeliveryRun. Concrete BUILD adapter
теперь привязывает capture к requestId, использует полный lease fence до IO и
перед success и проверяет полный request hash в SQL. Он регистрируется в той же
общей очереди при существующем SNAPSHOT_BUILD_ENABLED=true. Native runtime
proof нового operational topic выполнен: actual combined worker/pg-boss,
enabled completion, disabled reserved/no IO, invalid config before startup и
recovery после stage/result crash с expired lease, freeze/SUSPENDED и
недоступными key/storage refs. Наблюдались active/cleared own heartbeat,
один capture/stage и 14 PUT total; BUILD не создал current/DeliveryRun.
Вместе с тремя GOOD-topic regressions isolated runtime matrix — 7/7 PASS.
Это runtime-function/synthetic SDK proof, не live provider/OS signal/production.
Concrete adapter
прошёл native normal/crash/takeover/wrong-minor сценарии в PostgreSQL: 70/70
в пяти suites вместе с существующими lifecycle/rejection/delivery/runtime
regressions; новый runtime proof описан отдельно выше.
35 scoped units, quick/types/lint/architecture PASS. Оставшиеся четыре
исполнителя и полный MP-08.1 DoD не завершены.

Ниже — исторические checkpoints MP-05 с ограничениями на момент их получения;
их прежние pending формулировки не описывают текущий контур выше.
MP-05.1 закрыт implementation ledger
на pushed checkpoint `a074033`; MP-05.2 — projector DoD подтверждён,
фактический implementation/delivery статус принадлежит Task Manager:
полный private DB capture command, immutable input persistence и allocator
прошли native NOBYPASS PostgreSQL proof: 18 sections, replay после изменения
живых фактов, concurrent same-key capture, rollback и 4100 объектов/8200 media
positions в неизменном 30-second worker limit. Clean pushed checkpoint и strict
execution ledger подтверждены; public projectors/build/sign/publication
ещё не завершены.
Checkpoint `000329f` добавляет шесть project-state projectors к пяти catalog
projectors: всего 11/13. Native PostgreSQL suite — 17/17 PASS, replay всех
одиннадцати проекций после live mutations проверен. Generated stored sizes
устраняют повторный JSON sizing на commit без удаления двух constraint triggers;
4100/8200 capture — 25,4 секунды при прежнем лимите 30 секунд. Проверены forgery,
late gap/overflow и rollback; types/lint/architecture, 38 targeted unit tests,
docs/secrets — PASS. Интеграция GOOD inventory resolver, captured-media verification и
общий 13-dataset build остаются работой MP-05.2, не объявляются завершёнными.
Server-only ingestion resolver реализован отдельно: exact scoped GOOD pins,
повторный normalized hash, captured profile без live registry/LastGood, SQL
byte guard и marker-only malformed refusal. Native suite — 18/18 PASS, включая
исторический grace, replay, scope/pin/hash rejection и профиль вне live registry.
Его результат — внутренние кандидаты, не public DTO: location policy и полная
inventory/media assembly ещё требуют реализации.
Адресная граница GOOD resolver теперь исключает raw address/private apartment
из результата и выдаёт только проверенный unit-redacted addressPublic либо
отказ при неоднозначности. Native 18/18 и 63 targeted unit tests — PASS,
включая Unicode, составные и слитные private marker regressions; 150 комбинаций
проверены. Следующий candidate projector преобразует verified GOOD facts в
InventoryEntity/public DTO: exact identity/profile pins, variant sparse facts,
captured unit/period policy, STREET coordinates, persistent URL и media references,
safe-HTML source-code cleanup. Серверная candidate assembly теперь связывает
persisted receipt, captured profiles/URLs, HEAD вне DB и GOOD pages ≤200 с
реальными 13 projectors; strict reference/privacy и aggregate 32 MiB canonical
array budget включают brackets/commas. Captured selection применяет ALL_SHARED
по subscribed cities либо CURATED по explicit INCLUDE; EXCLUDE сильнее confirmed
listing links. ACTIVE/unmerged parent и building filters управляют catalog,
prices, shared media до HEAD и editorial. Inventory и persistent URL history
сохраняются; live subscription query и переписывание receipt/hash отсутствуют.
MP-05.3 scoped native proof от 2026-10-07: 21/21 в двух suites, targeted units
41/41, verify:quick — PASS; capture 4100/8200 — 16,245 секунды при лимите 30.
Доказан replay после live edits и непустая URL history; HEAD synthetic, не live
provider proof. Это implementation checkpoint, не завершение MP-05 delivery.
MP-05.4 implementation закрыт на `44150a4`: ACTIVE inventory preflight проверяет unique captured Source и
exact approved head ID/sequence, допускает исторический GOOD и producer-OFF.
Apply safety predicate подключён к capture head и исторических ACTIVE facts:
точный scoped GOOD baseline, immutable policy/analysis/counts и private hashes.
SQL byte guard ограничивает policy/analysis до 4096 bytes каждый до передачи;
preflight сверяет provenance, public DTO proof не содержит. Старые receipts без
proof требуют нового capture, без live enrichment или переписывания hash.
Первый MP-05.4 checkpoint от 2026-10-07: native 44/44 в трёх suites подтверждают
actual two-source runtime → persisted capture → assembly, source-scoped UID,
broken-run preservation, historical grace и replay под NOBYPASS. Units 26/26,
quick/types/lint/docs/secrets — PASS. В том checkpoint capture approval proof
ещё отсутствовал; его последующий delta проверяется отдельно. Эти проверки не
доказывают live provider или production delivery.
Capture approval checkpoint от 2026-10-07: native 46/46 в трёх suites — PASS,
включая forged/oversized approval denial до receipt save и исторический baseline
proof. Capture 4100/8200 — 12,498 секунды при неизменном лимите 30; targeted
units 14/14, verify:quick, docs/secrets/diff — PASS. MP-05 epic delivery ещё открыт.
MP-05.5 implementation proof: reuse explicit PublicInventoryDTO mapper, strict
public/facts schemas и приватный captured GOOD resolver. Targeted units — 31/31
PASS (все 11 property variants); actual four-profile Source → GOOD → capture →
13-dataset assembler, private sentinels, finite coarsened geo и immutable replay —
native 27/27 PASS. Quick/types/lint/architecture/docs/secrets/diff — PASS.
Exact pushed closure ledger принадлежит Task Manager. Это не speculative full
producer-fact mapping, agent gate или epic delivery.
MP-05.6 implementation proof: durable scoped GOOD/hash → Agent assignment и captured
publication gate реализованы; отсутствие consent/showOnSite/ACTIVE сохраняет
listing и project contacts без personal block. Reconcile заменяет полный набор
одной revision, не incremental pages; ambiguous/unresolved claim vetoes binding.
Final native — 52/52 PASS в четырёх suites: assigned photo/HEAD omission,
foreign scope, forged pin, unresolved claim/retry, actual REJECTED denial,
historical grace и freeze. Capture 4100/8200 — 27,548 секунды при лимите 30;
units 25/25, verify:quick (388 modules/1193 dependencies), final fixture types/lint
и docs/secrets/diff — PASS. Exact pushed closure ledger хранится в Task Manager.
Automatic ingestion matching,
mandatory contact flag и fresh publication admission этим checkpoint не заявлены.
MP-05.7 implementation proof: listing fallback requirement вычисляется из captured
ACTIVE inventory без eligible Agent relation; exact scoped project/contacts
обязателен до HEAD. Shared guard повторяется в composer, а candidate возвращает
вычисленный flag. Empty/all-bound flows остаются optional. Unit/composer/project
state — 29/29 PASS; final native — 50/50 в двух suites, включая required missing/
foreign denial до HEAD, actual all-bound optional composition и immutable replay.
Первая capacity-попытка превысила 30s; forward binding-reader correction сохранил
точные scope/hash/latest GOOD/RLS условия. Повторный capture4100/8200 — 25,605s,
project-state phase — 41ms; лимит 30s не изменён. Full quick + final delta types/
lint/architecture, docs/secrets/diff — PASS. Exact pushed closure ledger — Beads.
MP-05.8 implementation proof: actual NOBYPASS URL commands → captured input →
public projectors → thirteen-dataset composer сохраняют reservation/publicUrlId
при rename/relink, canonical paths, 301 redirects, GONE/tombstones и независимые
reservations. Source pipeline доказывает actual INACTIVATED/REACTIVATED events,
включая history без ACTIVE inventory; old receipt replay неизменен. URL-policy и
consumer SEO fields не публикуются; assembler отвергает SEO overrides. Native
baseline — 31/31 в трёх suites; final URL fixture после последнего assertion —
1/1; project-state/composer units — 24/24; full verify:quick и final fixture
types/lint — PASS. Consumer HTTP/SEO и signed publication этим не заявлены.
MP-05.9 implementation proof: native first-counter INSERT ON CONFLICT устраняет
Prisma empty-update upsert race; actual adapter-pg 40001 envelope повторяет весь
RR capture, без blanket P2002 retry. Детерминированные concurrent cuts дают
1/2 и доказанный retry; replay/same-key не расходуют лишний sequence. Проверены
actual-command rollback, независимые project counters, manifest/delivery floor
и INT_MAX fail-closed. Final native — 24/24 в двух suites, capture4100/8200 —
14,233s при неизменных 30s; units — 15/15; full quick + final delta types/lint,
docs/secrets/diff — PASS. Exact checkpoint/closure ledger — Beads. Global
safety lock по-прежнему сериализует проекты; signed publication ещё не завершена.
MP-05.10 implementation proof: server-owned receipt lookup → thirteen-dataset
assembler → composer privacy/reference guards → SecretRef Ed25519 → trusted
signature verification. Headers/source revisions derived from immutable cut;
caller overrides denied. Native signing/URL — 2/2; final complete capture —
22/22, including actual GOOD → signed portable-verifier roundtrip, corrupt-file
rejection and immutable signed replay. Consumer fixture uses generic JSON plus
exact reference-checked public graph, not universal consumer policy. Units —
35/35; full quick — PASS (390/1206), final fixture types/lint — PASS. Capacity
4100/8200 — 15,751s при прежних 30s. Exact checkpoint/closure ledger — Beads.
generatedAt/publishedAt = capturedAt; DeliveryRun.createdAt is staleness clock.
Durable identity binding, fresh admission, uploads/current/outbox — MP-05.11.
Полнота source facts и весь build/sign/publication executor ещё остаются в работе;
unitless heights — INVALID, unselected facts — ABSENT, без guessed defaults.
Native 18/18 подтверждает captured GOOD → public inventory и неизменный replay
после Source disable/profile change; targeted units — 31/31. Актуальный capacity
proof MP-05.7 выше сохраняет лимит 30 секунд для capture4100/8200.
Медиа-контур теперь включает receipt-only pin/consent/assignment admission,
server-owned project-bound HEAD вне DB, build-local cache и strict opaque
owner/position attachments с взаимными references. Missing/invalid mirrors
дают конечные diagnostics; producer URL fallback отсутствует. Manual agent
assignment приоритетен, shared observation не выдаётся за GOOD provenance.
Native media/capture regression — 19/19 в двух suites: actual captured inventory/
agent/shared → HEAD вне DB → public attachments и неизменный replay после live
asset-key/consent edits. Existing real S3 adapter с synthetic SDK transport
подтверждает hash/bytes и producer-off media read. Capture 4100/8200 — 13,9 секунды
при прежнем лимите 30. Общий 13-dataset build и live provider proof этим не доказаны.
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
