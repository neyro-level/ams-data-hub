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

## Текущая граница

MP-00–MP-09 доставлены. MP-09: PR #27 MERGED после exact-head RISKY Gate #340
на `75796b20407ea204372d698820b61364d2fe436a`, merge
`bc8e8c6d03183a591838fbd364e5cc5d43919589`. Gate: 91 unit и 39 native tests
в шести integration suites, current standalone build, 63 migrations и final test
DB reset — PASS. Дерево merge идентично gated candidate; canonical main и
публичное GitHub main-зеркало синхронизированы после merge.
Активен MP-10; Code, Security, Runtime, Portability, Operations и MP-10.7
regression guards доказаны. Локальный PG18 restore drill, raw retention,
freeze/reconcile/unfreeze, identity/publicUrlId и исторический non-production
S3 policy proof для MP-10.3 — PASS. Provider PostgreSQL backup на
`ams-data-hub-deploy` фактически отсутствует. Решением владельца от 2026-10-09
его настройка исключена, отсутствие принято как явное отклонение и больше не
блокирует main-delivery. Это не является backup evidence или production proof.
MP-10 доставлен PR #28 после одного exact-head SourceCraft RISKY Gate;
immutable candidate/Gate/merge evidence хранится в PlanDB и SourceCraft.
Частичный checkpoint `e7c6ea9` добавляет
AST source guards и обязательные self-tests; это не closure или readiness PASS.
Actual-diff runtime selection и structural composition removal guards
реализованы в checkpoint c91cfac: обязательные native suites вычисляются из Git,
не из caller hint; отсутствие bindings и попытка пропустить proof отклоняются.
Strict public-policy unit guards используют непустые 13 datasets, действительный
project-owned verifier и подписанные adversarial mutations: private/raw-Prisma
fields, media provenance, references, signature/revocation/replay, bytes/hash/count
и fixed gzip limit. Targeted 143/143 unit, architecture/lint/docs/secrets — PASS;
independent review без findings. Structural/unit checks не заменяют runtime proof.
Первый full native matrix на `181f902` — FAIL: 112/115 в 10 suites, final
test DB reset выполнен. Исправлены два подтверждённых fixture defects: own
retry job очищается только после LastGood/FAILED assertions, а multi-table
shutdown observation использует authorized RepeatableRead вместо torn RC cut.
Целевой прогон cron/source-worker → ACK rotation → shutdown/restart — 28/28
PASS (`29705`, 63 migrations, final reset); lint/types — PASS. Первый restart
timeout отдельно не доказан и не повторился; added own-scope status diagnostics
не меняют timeout или assertions. Повторный full mandatory runner на exact
`8ce049dcdd7cc8063b0aacc13e4ccab5e66e694a` (`11409`) — PASS: 143/143 unit,
fresh standalone build, 115/115 native в 10 suites, 63 migrations и final reset.
Независимый requirement-by-requirement review MP-10.7 — PASS без findings.
Этот checkpoint закрыл regression guards, но на тот момент не закрывал Code/
Security/Data Safety/Runtime/Portability/Operations gates, общий readiness
verdict или provider gate. Текущий статус указан в начале раздела.
Production по-прежнему не разрешён.

MP-10.3 scoped recovery checkpoint: reconcile и unfreeze используют общий
control lock и actual persisted UID/URL/sequence report, а не caller zeroes.
Узкая counts-only SQL capability принадлежит existing NOBYPASS worker с
FORCE RLS/row_security; web не получает SELECT на private capture/parts.
Current/run publishedAt и normal/rollback binding identity входят в проверки.
Units — 7/7; native consumer/recovery suite (`3901`) — 23/23, все 64 migrations
и final reset — PASS. Actual published snapshot + stage receipt проверены через
реальные recovery commands под NOBYPASS web; stale clean marker с допустимым
DeliveryRun timestamp mismatch запрещает reconcile/unfreeze без success audit.
Owner/grants/security-definer readback — PASS. Первый scoped run (`24219`) —
22/23 FAIL из-за запрещённой same-sequence current mutation в новой фикстуре;
guard сохранён и теперь явно проверяется. Types/scoped lint/RLS coverage/secrets/
diff — PASS; focused independent review без findings. Populated rollback,
непустой restore drill и raw-retention runtime ещё не доказаны; старый drill
с literal UID/sequence zeroes не принимается как текущий Data Safety Gate.
MP-10.3 остаётся RUNNING, без общего readiness или delivery PASS.

Следующий scoped restore checkpoint: старый drill с literal zeroes заменён
двухпроцессной проверкой с actual synthetic GOOD import/UID/published URL/
capture/sign/stage/publication и NOBYPASS web freeze. Реальный PG18 dump/restore
сохраняет ownership/grants; SHA-256 fingerprints 15 непустых таблиц совпадают.
Actual восстановленные reconcile/unfreeze и stale-marker denial без ложного
audit — PASS. `19161`: prepare 1/1, restore 1/1, все 64 migrations, удаление
dump/restore DB и final source reset — PASS; evidence `DATA_SAFETY_DRILL_V2`.
Это PostgreSQL-only proof с synthetic intake/S3 transports, не provider backup
configuration, S3 object restoration или raw-retention runtime. Raw retention
и остальные acceptance gates остаются в работе; production не затронут.

Финальный локальный Data Safety drill расширен до 22 непустых таблиц и сохраняет
raw journals, publicUrlId relink, rollback/current linkage, freeze/reconcile/
unfreeze; fingerprints до и после PG18 dump/restore совпадают, cleanup PASS.
Отдельный native raw-retention runtime proof также PASS. Эти результаты закрывают
локальную часть MP-10.3. Исходное `PostgreSQL backup configured` на provider/
server не выполнено и закрывается только owner amendment от 2026-10-09; риск
зафиксирован без ложного заявления о backup.

### История scoped checkpoints MP-08/MP-09

Ограничения и pending ниже относятся к моменту каждого checkpoint. Текущий
delivery status указан выше; доказательства failed run не удаляются.
MP-08.1–MP-08.10 закрыты implementation ledger:
все шесть concrete executors реализованы, зарегистрированы и проверены.
SourceCraft checkpoint `56284685c1be52b53539203f20d2635fef8057cf` доставлен
в рабочую ветку; весь MP-08 впоследствии доставлен PR #26 после Gate #325.
MP-09 Scenario A взят в работу: configured Vladis pipeline через реальный worker,
затем публичные commands подготовки agents/media/URL, durable build intent,
publication и consumer ACK. Implementation closure принадлежит Task Manager,
а этот результат не является production readiness;
явная подготовка публичными commands не выдаётся за автоматическую orchestration.
Первый native участок Scenario A — PASS: configured Source/SecretRef, real worker
и pg-boss, реальный Safe Intake с нижним synthetic DNS/HTTPS transport, raw bytes
и SHA-256, десять известных property variants, повторный GOOD и стабильные UID,
missing-grace с ACTIVE/counter, broken XML без изменения Last Good/identities.
63 migrations и final test DB reset — PASS. Маленькая fixture использует явную
project-owned policy, не изменение live Vladis calibration. Unknown category
в диагностическом прогоне корректно дал REJECTED из-за invalid record;
positive OTHER feed proof не заявлен. Extended native publication/portable files/ACK
прогон — PASS: публичные subscription/contact/URL commands, exact second GOOD
intent PROCESSED + JobRun SUCCESS + native queue completed, actual default worker,
подписанная publication, actual current и 13 artifact HTTP responses, portable
verification и authenticated ACK/replay с durable ACKNOWLEDGED. Первый extended
прогон выявил неверный CURATED input fixture; исправлен на реальный ALL_SHARED
command contract, без прямой вставки подписки. Architect completion-oracle finding
исправлен explicit own completion и persisted exact-intent assertions.
Decoded inventory exact UID cohort, десять property types, SALE/RENT и текущая
цена 1100 против historical grace price 1000 подтверждены повторным native PASS;
private apartment, script, source-code и query-token sentinels отсутствуют.
Расширенный native Scenario A — PASS: извлечение agent evidence из actual GOOD
raw records, matching/replay со стабильными UID, две office-phone collision
bindings и consent gate через действующие команды. Только подтверждённый агент
попадает в публичный dataset; неподтверждённый и office phone исключены.
Реальный media mirror через Safe Outbound сохраняет повторяющиеся изображения
на позициях 0/2 и producer order flag; broken image исключён с WARNING.
Приватный номер квартиры в combined address отсутствует, STREET geo отличается
от точных координат и воспроизводится повторной сборкой неизменённых фактов.
Отдельный configured source с unknown category получает REJECTED/invalidRecordCount=1,
без identities/Last Good/build intent и без изменения текущего manifest.
Native прогон — 1/1 PASS, 63 migrations и final test DB reset; full Next/browser
runtime и process restart не заявлены (restart proof принадлежит Scenario G).
Exact checkpoint, проверки и implementation ledger принадлежат Task Manager;
они не заменяют оставшиеся Scenario B–G и MP-09 delivery gate.
Scenario B–D native proof — PASS (3/3): configured Domclick/Avito v3/CIAN v2
через real worker/Safe Intake, raw bytes/SHA, format-specific normalized draft,
GOOD и публичные commands → actual snapshot assembly → strict public inventory DTO.
Чужой формат даёт FAILED без изменения Last Good, identities, records и build
intent. После этих assertions отменяется только собственный synthetic RETRY job,
чтобы следующий case не получил его с другим transport. Final native run:
`64239/67891d`, 63 migrations и test DB reset — PASS; architect review без findings.
Implementation closure B–D записано native PlanDB `done` после checkpoint
`fa0e78bfb3f8796d4a7a3c805ee613ec924fbdc3` в SourceCraft. 2026-10-08 владелец удалил Beads
в отдельном workflow, затем явно разрешил перенос graph в PlanDB. AMS Data Hub backup сохранён в
`C:/Users/User/Desktop/Data-skill/beads-uninstall-backup-20261008/payload/store-7`;
PlanDB `.plandb.db` теперь содержит весь исходный graph с notes/evidence/statuses
и зависимостями; migration verification — PASS. Mapping и границы находятся в
`PLANDB_MIGRATION_2026-10-08.md`. Старый v4 не переоткрывается.
Scenario E native proof — PASS (1/1): реальный registered disabled Source,
dry-run без записи, diff/review hash и explicit confirmation, отказ stale review,
transactional import с identity/price/audit/catalog revision, затем публичные
subscription/URL commands → capture → actual snapshot candidate assembly.
Development и price DTO получены из сохранённых фактов; приватная provenance
отсутствует. Native run `56361/f7b73c`, 63 migrations и final test DB reset — PASS;
test types `73222/1bd046` — PASS. Первый прогон выявил несовместимый fixture profile;
выбран действующий `default-v1`, registry и защитные правила не изменены.
Проверка ограничена candidate assembly без media: signed publication, web-role
NOBYPASS и process restart этим сценарием не заявлены. Следующие сценарии F–G;
общий MP-09 delivery gate и MP-10 ещё не завершены.
Scenario F native proof — PASS: три real configured Source в одном synthetic
project. A/B получают второй GOOD с ценами 2100/2200; C после первого GOOD
получает malformed XML → FAILED без GOOD sequence и без изменения Last Good,
identities, records, build intents или состояния A/B. Actual capture фиксирует
source/fact/approved head pins 2/2/1; candidate snapshot содержит три distinct UID
и цены 2100/2200/1000. Native `48666/6da3e0` — 4/4 PASS вместе с B–D,
63 migrations и final DB reset; independent architect review без findings.
Подменены только нижние DNS/HTTPS/S3 transports. Signed publication и HTTP
этим scoped proof не заявлены.
Scenario G full scoped native proof — PASS: actual worker process импортирует GOOD и
завершается; fresh pg-boss client читает тот же completed job. Actual Next
standalone проходит login/session/private Fleet HTTP, затем новый Next process
принимает прежний cookie с тем же session ID и показывает тот же project slug.
Source, identities, revisions и build intents сохраняются. Отложенный manual
request переживает web restart и завершается новым actual worker со стабильным
inventory UID и вторым GOOD. Actual publication сохраняет signed current и все
13 artifacts. Каждый fresh Next process читает current/files через actual HTTP,
проходит signature/schema/hash/privacy/integrity verification и повторяет ACK
идемпотентно. Delivery/current/credential version и timestamps остаются теми же,
в том числе после второго Source GOOD; child PID-scoped SDK evidence подтверждает
реальные чтения из synthetic lower transport. Native `6277/91ebbe` — 7/7 PASS,
включая шесть
shutdown/recovery regressions, 63 migrations и final DB reset. Current standalone
build `83913/74d61c` — PASS; CI policy regressions — 8/8 PASS. RISKY gate теперь
собирает standalone перед integration в том же exact-head cube, один раз.
Windows worker SIGTERM здесь вызывается registered handler через IPC; pg-boss
client/runtime restart не означает PostgreSQL server restart. HTTP-auth/Fleet
не выдаётся за browser E2E; child DB owner-login не выдаётся за queue ACL proof.
Completion audit выявил недостающее publication/ACK restart evidence и вернул
преждевременный `done` в RUNNING, сохранив partial results. Расширенный actual
proof теперь покрывает исходное acceptance; independent architect review без
открытых замечаний по G. `verify:quick` — PASS (`43380/0c7094`). Scoped completion
не заменяет MP-09 delivery gate/merge или оставшийся MP-10; production не разрешён.
Whole-MP09 review также исправил Scenario A fixture isolation: actual broken и
unsupported RETRY jobs отменяются только по собственным exact IDs после всех
retry/rejection/preservation assertions, до чужого transport/suite. Foreign jobs
не очищаются. Native `81765/4dfcc4` — 1/1 PASS, 63 migrations и final DB reset;
independent correction review без открытых замечаний.
MP-09 gate `337` на `9b0ddaa...` — FAIL: 91 unit PASS, build PASS,
38/39 native PASS, final DB reset; Linux fatal guardian-loss проверка получила
`SOURCE_EXECUTION_BUSY` при немедленной reacquisition после Node exit.
Test-only correction фиксирует original source-lock PID/database/scope до fatal
exit и ограниченно (5 s) наблюдает исчезновение именно этого lock; затем прежняя
реальная reacquisition обоих guards обязательна. Graceful checks не изменены,
дополнительных terminate/reset/BUSY retries нет. Native `6277/91ebbe`, test types
`93184/8451dd`, scoped lint `98743/de02d6` — PASS; independent review без findings.
Failed run сохранён. Следующий reviewed candidate прошёл Gate #340 и merged
через PR #27; точные SHA и итоговые проверки приведены в текущей границе выше.
MP-08.6: action state
Fleet получает bounded per-project историю REQUESTED/RUNNING/SUCCEEDED/FAILED,
а принятие запроса не выдаётся за завершение. Completed metadata проходит
общую strict result schema и scalar allowlist; raw result, hashes и private proof
в browser DTO не попадают. Реальный browser submit/reload — PASS;
responsive 375/768/1024/1440 px без horizontal overflow, screenshots проверены.
Production build и 20 scoped unit tests — PASS. Native staging suite — 92/92,
включая настоящий BUILD → Fleet result projection и privacy assertions.
Browser proof подтверждает REQUESTED, а не исполнение worker или публикацию.
Implementation closure и exact commit evidence принадлежат Task Manager.
MP-08.7 consumer HTTP delivery и authenticated ACK реализованы в рабочей ветке:
Bearer-only exact project scope, bounded immutable reads, fresh credential/trust
cuts, no-store responses и атомарный ACK через существующий service. Native
HTTP/read/ACK suite — 16/16 после final trust-cut и SUSPENDED regression; до них
совместно со staging regressions — 106/106,
62 forward migrations и final reset — PASS. Проверены SUSPENDED/frozen pull/ACK,
rotation/revocation, replay/conflict, late cancellation и private-write denial.
Поздний отзыв signing key после настоящей ACK записи откатывает весь DeliveryRun.
Все шесть rollback modes проверены настоящим consumer read после исполнения.
Automatic GOOD publication без standalone BUILD stage receipt остаётся approved
rollback source по exact root/binding/run pins; stage-only запрещён.
MP-08.7 закрыт implementation ledger, checkpoint `718d4af` в SourceCraft.
MP-08.10 дополнительно проверен без глобального freeze: actual Source execution,
новые capture/publication блокируются, committed current/run/objects неизменны;
прежний manifest и immutable geo artifact доступны. Это application admission
proof, не новый отдельный Source RLS audit. Native 16/16 и final reset — PASS.
Exact closure/commit MP-08.8/MP-08.10 принадлежат Task Manager ledger.
MP-08.9: публикация атомарно создаёт durable notification intent; существующий
combined worker opt-in отправляет только projectId/publishSequence вне TX.
HTTPS double-DNS/pinning, no redirects, bounded reply/cancellation, exact-scope
value-free endpoint refs; default disabled, missing config defers. Полный lease
fence до/после IO и SQL status guard не допускают stale write или downgrade ACK.
Webhook failure/retry/dead-letter не отменяют публикацию; delivery at-least-once,
polling fallback сохраняется. Native notifier/consumer + staging — 114/114,
63 forward migrations и final reset — PASS; PUBLISH/ROLLBACK проверяют intent.
Первый прогон 113/114 выявил неверное тестовое ожидание COMPLETED вместо
фактического PROCESSED; исправлено. Architect fixture-isolation замечание
исправлено own availability/synthetic clock без изменений чужих intents.
43 scoped unit tests, test types и verify:quick — PASS. Next production build
и worker build/module smoke — PASS. Финальный полный unit-suite: 986 PASS,
1 existing skip. До него stale canon guard требовал уже отсутствующий текст
«missing executors»; заменён актуальными runtime/readiness boundary assertions,
не weakening security. Внешний HTTP/SDK synthetic;
итоговое registered-worker/Next/browser end-to-end proof остаётся открытым.
MP-08 delivery: PR #26, первый exact-head RISKY Gate #322 на `77b2bc9` — FAIL:
233 scoped units PASS, 346/349 native PASS. Три сбоя общей outbox-reliability
suite вызваны unfiltered fixture claims, захватывавшими retained intents других
suites. Test-only fix использует стабильный unique per-key topic и own event ID;
реальные concurrency/stale lease/retry/dead-letter assertions сохранены, foreign
events не удаляются и не переносятся. Production claim implementation неизменна.
На новом exact-head `ad09ecab9ade1e4b0d1abcfb494a82fb92c9c27a` Gate #325
завершился SUCCESS: 233/233 units, 349/349 native, 63 migrations, final reset
и production build PASS. Independent full-range architect review — PASS.
PR #26 MERGED без force/rebase/squash; canonical main
`a71c3a01b062b314df392c2e305ddd7c9ec07a1e`, tree равен gated candidate.
Публичное GitHub main зеркало и локальный main приведены к тому же SHA;
старый локальный MP-08 branch удалён после проверки merge. Delivery ledger закрыт,
graph reconciliation CLEAN; production не затронут. Gate #322 сохранён как FAIL.
Исправление подтверждено локально: consumer/notifier + outbox-reliability на
одной native PostgreSQL базе — 31/31, 63 migrations и final reset PASS;
test types, scoped lint, docs/secrets/diff — PASS. Независимый review patch
без actionable findings. Build/worker production code и конфигурация не менялись.
Новый SUSPICIOUS_APPROVE переиспользует
реальное ingestion apply, без повторного intake и обхода SAFE predicate.
Source identity/lifecycle, GOOD/Last GOOD, snapshot intent, immutable manual
receipt и operational SUCCESS фиксируются атомарно под полным lease fence.
Snapshot читает отдельное durable manual proof; private review не входит в DTO.
Финальная совместная регрессия — 237/237 в десяти integration suites с 59
forward migrations и final reset. Дополнительная approval matrix — 20/20:
actual combined worker/replay, late rollback/cancel, takeover, concurrent replay,
scope/forgery denial, stale baseline/source/policy, REJECTED, новая identity и
missing GRACE. PostgreSQL worker NOBYPASSRLS; fixture/SDK synthetic.
Повторное scoped architect review — без actionable findings.
Production и live provider этим не заявлены; browser proof выше относится
только к action state и форме Fleet.

## История проверенных этапов

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
Task Manager; production не обновлялся. История раннего MP-08.1 checkpoint:
durable operational requests/outbox ещё не доказывали всех шесть исполнителей.
Foundation checkpoint на тот момент не закрывал task и не означал исполнение запросов.
Предыдущий verified checkpoint — fenced lifecycle и concrete SUSPICIOUS_REJECT:
review/audit/request success в одной транзакции, immutable replay и Last GOOD
unchanged. На том checkpoint rejection adapter подключён к общей очереди;
остальные пять оставались reserved. Terminal FAILED сверяется с DEAD_LETTER/latest FAILED
JobRun на старте и каждые 60 секунд; unresolved requests защищены от retention.
Непривязанные/некорректные terminal intents не блокируют общий worker и не
создают фиктивный FAILED. Native PostgreSQL/pg-boss — 48/48 PASS в пяти suites,
включая actual combined-worker startup/restart и qualified/cleared heartbeat;
28 scoped unit tests PASS. Этот checkpoint не закрывал полный MP-08.1 DoD;
task тогда оставался открытым. Текущий MP-08.1–MP-08.5 closure указан выше;
исторический checkpoint не заменяет его evidence.

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
35 scoped units, quick/types/lint/architecture PASS. Оставшиеся три
исполнителя и полный MP-08.1 DoD не завершены.

Следующий PUBLISH prerequisite — project-scoped bounded snapshot GET:
ключ проекта, лимит и pre-abort проверяются до adapter IO; старый adapter
без bounded capability не может вызвать fallback на unbounded GET.
Targeted storage matrix — 52/52 PASS в пяти suites с actual S3 adapter и
synthetic SDK transport, включая scope denial, size/hash rejection,
cancellation и reader cleanup. Это не registered PUBLISH executor:
выбор stage и atomic publication/request result ещё требуют реализации и
доказательств. Internal staged-artifact reader теперь использует exact canonical
binding, текущую public trust policy, bounded sequential GET и portable verifier
с тринадцатью actual strict public schemas, privacy и доступными public references.
Targeted unit matrix — 122/122 PASS в семи suites. Это read-only artifact seam,
не доказательство выбранного scoped stage, fresh captured admission, final lease
или atomic PUBLISH/result; полный executor остаётся незавершённым. Native
staging suite — 30/30 PASS: actual capture/binding/stage с agent/media читаются
после отключения временного signing key без новых PUT/HEAD/capture и без
current/DeliveryRun; последующая revocation отказывает после manifest GET.
SDK transport synthetic; это не registered PUBLISH/live provider/production proof.

Scoped selected-stage loader реализован отдельно: explicit buildInputId,
immutable header + completed receipt + binding, без latest fallback или новых
RLS grants. Private capture читается отдельно через bounded RepeatableRead;
metadata replay не требует capture/config/key/storage и не переписывает более
новый current. Native staging/delivery matrix — 35/35 PASS: foreign/missing scope,
wrong purpose, unbound/binding-only interruption и replay старого run при новом
current, freeze/SUSPENDED и недоступном private capture. Types/scoped lint и
architecture guards PASS. Runs в replay fixture созданы test-controlled путём;
это не полный operational PUBLISH. Pure captured-admission preparation добавлен:
exact manifest/source pins, inventory cohort/URL/agent attribution, canonical
multiset catalog/project checks и captured media slot/provenance anchors, без
GOOD/HEAD/sign/PUT. Actual Agent/media native proof дополнен отрицательными
metadata/project/media cases и допустимой omission без дополнительного IO.
Nonempty helper matrix — 13/13 PASS: authenticated captured inventory/catalog,
historical GOOD/producer OFF, relink, duplicate public price/event history,
cohort/URL/agent/catalog/contact mismatch, foreign receipt, manual photo priority
и ambiguous listing slot. Decoded-value attacks проверяют attribution, не подпись
изменённых values. Snapshot-owned final fresh admission/current trust теперь
реализованы ниже; остальные три operational executors ещё не завершены;
MP-08.1 остаётся открытым.

New PUBLISH request acceptance теперь сохраняет explicit buildInputId в
idempotency hash/audit/request и scoped completed-stage FK. Nullable legacy
запросы не переписаны; новые NULL targets отвергает SQL INSERT guard. Non-PUBLISH
hashes сохранены byte-compatible; IDs-only queue и grants не расширены.
Форма переиспользует существующие primitives и очищает target при смене проекта.
5 action units PASS; native request/fleet/staging matrix — 47/47 PASS с 54
forward migrations. Проверены exact replay, target conflict, foreign/missing/
unbound target и атомарный rollback audit/intent/request. Это acceptance proof,
не executor/result/production proof; browser/visual form proof ещё не выполнен.

Selected publication теперь предоставляет snapshot-owned finish closure:
bounded GET и captured admission вне финальной транзакции, затем exact publication
purpose, global→publication lock, committed replay, четыре fresh owner gates,
текущая public trust/sequence и atomic current/DeliveryRun. Private capture/anchors
не передаются Ops; signer, PUT и HEAD не вызываются. Native staging suite —
42/42 PASS, включая 10 новых final-cut scenarios: success/replay, trust revocation
после GET, project/source/catalog/media/freeze changes, wrong purpose, cancellation
и rollback после actual pointer/run writes. PostgreSQL worker — NOBYPASSRLS;
SDK transport synthetic. Это snapshot finish proof, не full operational PUBLISH:
full lease/request SUCCESS реализованы отдельным adapter ниже.

Concrete selected PUBLISH adapter теперь использует один Ops-owned RC final cut:
global/publication locks → complete latest event/job/request fence → fixed same-scope
actor-only bridge → snapshot-owned publication → actor restore → SUCCEEDED.
Forward SQL guard независимо сверяет full lease и exact selected stage/header/
binding/run. Current, DeliveryRun и SUCCESS откатываются вместе при late failure
или cancellation. Конфигурация и GET разрешаются лениво после committed replay;
исторические NULL requests, captures и grants не переписаны. В общей очереди
зарегистрированы rejection, BUILD и PUBLISH; остальные три executors остаются
открытыми, MP-08.1 не закрывается.
Final native request/rejection/staging matrix — 84/84 PASS с 55 migrations:
late SUCCESS failure/cancel откатывает все три состояния, takeover во время GET
отказывает старому worker, подмена каждого lease field отвергается до config/IO,
SQL не допускает success без exact run. Actual newer publication сохраняется при
older operational replay после freeze/SUSPENDED/trust rotation, без extra IO.
15 scoped units, production/test types, scoped lint, architecture 421/1415,
RLS coverage, docs/secrets/diff PASS. Архитектор — без actionable findings.
PUBLISH runtime capability теперь независима от BUILD/signing и выключена по
умолчанию. Переиспользован existing project registry, но для PUBLISH keyId/
privateKeyRef optional и signing secret не разрешается. Public-only resolver
проверяет exact scope, Ed25519 PUBLIC KEY, свежую policy/refs в final cut;
private PEM в public slot отвергается. Actual combined-worker/pg-boss matrix —
12/12 PASS (пять новых PUBLISH scenarios + семь BUILD/GOOD regressions): enabled,
disabled/reserved/no GET, invalid-before-startup, late-SUCCESS rollback recovery,
queue-ACK replay с freeze/SUSPENDED и unavailable refs. Один capture/stage,
14 staging PUT total, PUBLISH GET only, active/cleared own heartbeat. Это
runtime-function/synthetic SDK proof, не production/provider/OS-signal proof.
Найденный архитектором readiness gap исправлен: own heartbeat очищается до
storage/capability validation; invalid startup fixture предварительно создаёт
fresh own row и доказывает её удаление без queue startup. Final runtime/staging
matrix — 60/60 PASS (52,98s); 41 scoped units, types/lint и architecture422/1420
PASS. Local web-env CLI не является proof этого worker: стандартный вызов
упирается в server-only condition, direct conditional import — в неполный local
database environment. Local env/credentials не изменялись; web readiness не заявлена.

Rollback получил отдельный snapshot-owned internal admission prerequisite:
historical GOOD/fact attribution плюс действующие права, без exact current-head/
whole-cohort equality. New GOOD и cosmetic Agent/subscription versions допустимы;
current identity ACTIVE, consent epoch, фото, project contact, current selected
GOOD assignment к тому же человеку, catalog EXCLUDE/lifecycle и media rights
остаются обязательными. Agent contacts сравниваются по value-free SHA-256 pins
в SQL, без передачи живых PII. Два P2 архитектора (historical binding вместо
current fact assignment и восстановление удалённых контактов) исправлены.
Native matrix — 123/123 PASS, 4 suites, 55 migrations, 65,31s, final reset;
19 scoped units PASS. Actual capture/sign/stage + bounded GET attribution
с непустым Agent/media доказывает admission без extra IO/current/run writes.
Этот admission prerequisite дополнен durable rollback identity: immutable
request-owned reservation связывает approved delivery run с root capture,
общим project counter и DB timestamp; signed canonical binding и stage marker
защищены live full lease и exact-purpose RLS. Lease takeover сохраняет initial
history и не меняет sequence/signature identity. Forward migration не переписывает
старые capture; collision guards действуют в обе стороны. Native final matrix —
80/80 PASS, 2 suites, 56 migrations, 113,61s, final reset, включая наблюдаемое
pg_locks contention, stale lease, malformed canonical bytes, source/root/lease
forgery, scope NULL/empty denial, overflow и prior-rollback ancestry. Architecture
428/1447, RLS coverage 53 models, docs и secrets PASS. Это internal repository
proof, не зарегистрированный rollback executor. Для атомарного operational
current/run/result и runtime нужны отдельные adapter/result guard и capability.
Bounded reader теперь возвращает snapshot-private composition с исходными
authenticated compressed bytes без recompression/extra GET; обычный PUBLISH API
не раскрывает bodies. Native staging matrix — 58/58 PASS, 56 migrations, 47,97s,
final reset; 52 scoped units PASS. Byte identity, fourteen bounded GETs, stream
cleanup, revoked-key denial и private-field rejection проверены. Types/lint и
architecture 428/1448 PASS; scoped architect review без actionable findings.
Сам byte-reader не даёт архивное approval или operational rollback.
Следующий internal server seam проверяет committed run/stage/root capture до
config/GET и допускает retained exact-source PUBLIC Ed25519 key для чтения старого
approved artifact, включая revoked/noncurrent key; consumer/new-key trust не
ослаблен. Actual signer создаёт higher-sequence manifest, durable binding до IO,
manifest-only awaited PUT и staged marker после fresh full lease/permissions/trust.
Pending identity переживает key rotation/takeover без нового signing/sequence.
Snapshot-owned finish проверяет fresh rights/current trust и атомарно пишет
current/run; lost lease/stale sequence/revoked pending key fail closed. Committed
replay config-free, без rewind нового current; concurrent commit после initial
cut/во время PUT failure подтверждён повторным locked full-lease lookup.
Найденный архитектором P2 отсутствующего concurrent recovery исправлен; повторный
review без новых findings. Final native matrix — 86/86 PASS, 56 migrations,
73,39s, final reset, включая held-PUT cancellation/settlement. 65 scoped units,
prod/test types, lint, architecture430/1471, docs/secrets PASS. Request в этих
snapshot-owned fixtures остаётся RUNNING: operational SUCCESS в том же cut,
реальный adapter и combined-worker runtime ещё не реализованы.
Этот snapshot-owned checkpoint не включал operational SUCCESS/runtime.
Следующий checkpoint добавил concrete ROLLBACK adapter и dedicated SQL result
guard: current/run/SUCCESS атомарны, полный accepted event/job lease обязателен,
exact source/root/reservation/staged binding/run/result проверяются независимо.
Metadata-only committed replay не читает config/IO и не переписывает newer current.
Независимая default-false SNAPSHOT_ROLLBACK_ENABLED capability использует existing
combined worker, registry и refs; новые процессы/secrets/grants не создаются.
Native request/rejection/staging matrix — 128/128 PASS, 3 suites, 57 migrations,
87,66s, final reset: late SUCCESS failure/cancel, каждый forged lease field,
post-PUT takeover/SUSPENDED/revocation, SQL fabricated success denial, retry и
config-free replay. Actual combined-worker/pg-boss matrix — 17/17 PASS, 29,54s,
final reset: пять ROLLBACK scenarios + прежние BUILD/PUBLISH regressions, exact
own heartbeat active/cleared. Первый runtime прогон 16/17: replay fixture ошибочно
отзывала active signer без нового; исправлена fixture ротации без ослабления
startup guard. 29 scoped units PASS; types/lint, architecture432/1485, RLS53 PASS.
Final совместный native прогон всех четырёх suites — 145/145 PASS, 57 migrations,
110,81s, final reset. Read-only architect review без actionable findings;
production не активирован.
ACK_ROTATE добавлен как пятый concrete executor: explicit STAGE/PROMOTE и expected
credential version, snapshot-owned preparation, atomic credential/proof/SUCCESS,
full lease fence и config-free historical replay. SQL58 создаёт immutable private
receipt только из actual credential UPDATE; прямой fabricated SUCCESS/receipt
отклоняется. Default-false capability использует existing combined worker; реальных
secrets или production activation нет. Final native six-suite regression — 168/168
PASS, 58 migrations, 148,09s и final database reset: overlap/promote, stale/concurrent
CAS, late failure/cancel, takeover, scope, preparation races и actual pg-boss runtime.
Read-only architect re-review: race recovery закрыт, actionable findings нет.
Fleet native projection — 1/1 PASS с actual credential version и отсутствием hash
в DTO; 45 scoped units PASS, prod/test types и scoped lint PASS, architecture435/1502,
RLS54, docs/config/static UI и secret scan PASS. Fleet fixture обновлена под scrypt
и обязательные ACK phase/version; database guards не ослаблены.
MP-08.1 остаётся IN_PROGRESS: пять из шести executors; SUSPICIOUS_APPROVE,
HTTP/routes/ACK/lifecycle UI и MP-09/10 открыты. Browser/live UI proof не получен.

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

Approved remediation plan завершён: MP-00–MP-10 доставлены, составной graph
закрыт. Все acceptance gates и regression guards завершены с owner amendment
по отсутствующему server backup. Реализация runtime adapters и расписаний входит
в доставленный main; их включение на production — нет.

Production feed credentials, миграция production и rollout — только отдельной
release/операционной командой владельца после readiness gate.
Синтетический contract PASS и закрытый graph не заменяют live proof.

## Delivery

Push и PR — zero-CI. Merge требует один manual exact-head RISKY Gate согласно
CRITICAL profile. Production требует отдельный exact-main SourceCraft release
с immutable registry digests, live proof и rollback contract.
