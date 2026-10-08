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

MP-00–MP-08 доставлены. MP-08.1–MP-08.10 закрыты implementation ledger:
все шесть concrete executors реализованы, зарегистрированы и проверены.
SourceCraft checkpoint `56284685c1be52b53539203f20d2635fef8057cf` доставлен
в рабочую ветку; весь MP-08 впоследствии доставлен PR #26 после Gate #325.
MP-09 Scenario A взят в работу: configured Vladis pipeline через реальный worker,
затем публичные commands подготовки agents/media/URL, durable build intent,
publication и consumer ACK. Это ещё не PASS и не production readiness;
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
Agent/media/consent/collision и полный
Next/browser runtime proof остаются открытыми; Scenario A не закрыт.
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

Активная доработка: MP-08–MP-10 нового remediation plan;
MP-00–MP-07 закрыты. Далее — оставшееся operations HTTP/UI и синтетическое
end-to-end proof. Реализация runtime adapters и расписаний
входит в утверждённую доработку; их включение на production — нет.

Production feed credentials, миграция production и rollout — только отдельной
release/операционной командой владельца после readiness gate.
Синтетический contract PASS и закрытый graph не заменяют live proof.

## Delivery

Push и PR — zero-CI. Merge требует один manual exact-head RISKY Gate согласно
CRITICAL profile. Production требует отдельный exact-main SourceCraft release
с immutable registry digests, live proof и rollback contract.
