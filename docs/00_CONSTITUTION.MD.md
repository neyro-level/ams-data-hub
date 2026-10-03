# AMS Data Hub — Final Target Architecture & Implementation Master Plan

**Версия:** 3.1.2 Final — Bastion Pilot Ready  
**Статус:** FINAL / READY FOR IMPLEMENTATION / BASTION PILOT READY  
**Заменяет:** AMS Data Hub Final Master Plan v3.1.1  
**Модель разработки:** solo owner + AI / Codex  
**Клиентский профиль по умолчанию:** AMS REALTY LITE  
**Подход:** docs-first · modular monolith · server-first · security-by-default · portability-by-design · minimum ceremony


**Pilot evidence date:** 2026-10-02  
**Pilot feed:** Vladis/Vt24 advert-feed for Bastion  
**SemVer rationale:** PATCH — architecture unchanged; Bastion pilot release gaps, lifecycle grace, delivery key management and document consistency corrected.  
---

# 0. EXECUTIVE DECISION

AMS Data Hub — внутренняя Data + Operations Platform AMS.

Hub:

- принимает и обрабатывает внешние XML/YRL-фиды;
- хранит project-specific factual data;
- хранит AMS Shared Catalog там, где AMS имеет право переиспользовать факты;
- позволяет AMS вручную создавать и обслуживать каталог города;
- хранит operational state динамических сущностей;
- формирует immutable project snapshots;
- передаёт snapshot клиентскому REALTY LITE сайту.

REALTY LITE:

- не имеет PostgreSQL;
- не имеет Payload;
- не имеет CMS;
- не имеет админки;
- не подключается напрямую к Hub PostgreSQL;
- не парсит XML;
- не зависит от доступности Hub во время обычного page rendering;
- хранит локальный last-good snapshot;
- владеет frontend, SEO-архитектурой, URL grammar, UI, статическими страницами и формами.

Главное архитектурное правило:

```text
Hub = data operations + persistent dynamic project state
Site = independent application + final SEO/rendering decisions
```

Hub не должен становиться runtime backend клиентского сайта.

## 0.1. Что изменилось в v3.1.0 после проверки реального Bastion feed

Версия 3.1.0 сохраняет архитектуру v3.0.0, но переводит XML-контур из абстрактного уровня в **реально проверяемый production pilot**.

Проверен живой feed Bastion:

```text
https://vladis.vt24.ru/advert-feed/<redacted>
```

На момент аудита 2026-10-02 подтверждено:

```text
format family: Yandex Realty Language / YRL
namespace: http://webmaster.yandex.ru/schemas/feed/realty/2010-06
source semantics: MIXED_REALTY
transaction types observed: SALE + RENT
entity categories observed: multiple residential inventory
agents embedded into offer data: YES
agent phones: YES
agent photos: PRESENT FOR PART OF AGENTS
object photos: YES
coordinates: YES
rich description: YES
category-specific attributes: YES
```

Текущий feed snapshot содержал примерно 949 offer-позиций, включая:

```text
SALE / APARTMENT      ~568
RENT / APARTMENT      ~3
SALE / HOUSE          ~241
SALE / LAND           ~108
SALE / HOUSE_PART     ~13
SALE / ROOM           ~13
SALE / COTTAGE        ~1
SALE / TOWNHOUSE      ~1
SALE / GARAGE_BOX     ~1
```

Эти количества **не являются контрактом** и не должны попадать в hardcoded business logic.

Они являются только evidence того, что Source должен поддерживать:

```text
one Source
→ many offers
→ many property categories
→ more than one transaction type
→ embedded agent references/data
→ sparse optional fields
```

Главное новое решение v3.1.0:

```text
BastionParser                         FORBIDDEN

YrlRealty2010Adapter                 REQUIRED
+
SourceProfile: vladis-vt24-v1        REQUIRED
+
project/source configuration         REQUIRED
```

Парсер понимает **формат**, а не клиента.

SourceProfile понимает особенности конкретного producer-а внутри известного формата.

Project config определяет business scope конкретного клиента.

## 0.2. Что исправлено в v3.1.2

v3.1.2 не меняет целевую архитектуру v3.1.1. PATCH закрывает последние gaps перед Bastion Pilot Gate:

```text
single source of truth for agency fallback contact: ProjectPublicContact in Hub project scope
inventory deactivation grace against one-run flapping
Bastion public location precision defaults + deterministic coordinate generalization
bootstrap SourceSafetyPolicy numeric defaults before run 2–3 calibration
Ed25519 keyId / trust set / planned rotation / compromise revocation procedure
SUSPENDED keeps read access to already-published artifacts
AgentPublicV1 vs protected consent handoff clarified
NO_ACTIVE_LISTINGS explicitly does not redirect Agent URL
Open Questions receive owner / deadline / status
2FA decision registered as post-pilot OQ
remaining duplicate headings removed
CHANGELOG updated
```

Hard decisions added by this PATCH:

```text
ProjectPublicContact owner = Hub / Project scope
ProjectPublicContact public projection = snapshot dataset project/contacts
one missing GOOD run != inventory INACTIVE
Bastion APARTMENT/ROOM public precision default = STREET
Bastion HOUSE/HOUSE_PART/LAND/COTTAGE/TOWNHOUSE/GARAGE_BOX default = STREET
DISTRICT is allowed only by explicit project override
coordinate generalization = deterministic per entity/policy version, never random jitter
snapshot manifest signature identifies keyId
revoked signing keyId is rejected even if cryptographic signature is otherwise valid
```

---

# 1. ГЛАВНАЯ БИЗНЕС-МОДЕЛЬ

Есть два основных источника данных.

## 1.1 AMS Shared Catalog

AMS вручную создаёт и обслуживает фактический каталог:

```text
Region
City
District
Developer
Development
Building
PriceObservation
Media
```

Пример:

```text
Ростов-на-Дону
    ↓
единый AMS factual catalog ЖК
    ↓
Project A
Project B
Project C
```

Один Development создаётся один раз.

Несколько клиентских проектов могут использовать один `developmentUid`.

У каждого проекта остаётся собственная:

```text
presentation
URL state
editorial
SEO
commercial layer
lead routing
```

---

## 1.2 Client XML Sources

Внешний автоматический ingestion V1:

```text
XML / YRL
```

Фид может содержать:

```text
объекты недвижимости
ЖК references
сотрудников / sales-agent
медиа
цены
availability
другие factual fields
```

Разные XML могут иметь совершенно разную структуру.

Поэтому:

```text
Source
→ SourceAdapter
→ normalize
→ validate
→ project factual state
```

Никакой универсальной XML-схемы не предполагается.

---

# 2. SCOPE ВЕРСИИ 1

Поддерживаются два способа ввода данных:

```text
1. ручное управление через Hub Admin
2. XML/YRL SourceAdapter
```

Не являются частью обязательного V1:

```text
REST API ingestion
CSV import
generic XLSX import
universal mapping DSL
visual parser builder
```

Архитектура SourceAdapter не должна препятствовать появлению API/CSV в будущем.

Но они не реализуются без реального business trigger.

XLSX также не является source of truth.

Если позже появится реальная необходимость в массовом заполнении каталога:

```text
XLSX
→ отдельный optional epic
→ dry-run
→ diff
→ explicit apply
```

---

# 3. ЧЕТЫРЕ КЛАССА ДАННЫХ

## 3.1 SHARED_FACT

Факты общего AMS Catalog.

Примеры:

```text
Region
City
District
Developer
Development
Building
construction facts
shared factual characteristics
shared price observations
shareable media
```

Hub является source of truth.

---

## 3.2 PROJECT_FACT

Данные конкретного клиента.

Примеры:

```text
resale listings
agency inventory
agency price
availability
house catalog
commercial objects
client feed IDs
client-specific media
```

PROJECT_FACT никогда автоматически не становится SHARED_FACT.

---

## 3.3 PROJECT_PRESENTATION_STATE

Project-specific persistent state динамических сущностей.

Хранится в Hub, потому что REALTY LITE не имеет БД.

Сюда относятся:

```text
Agent
entity operational/presentation editorial
project slug
URL Registry entries
redirect history
lifecycle/tombstones
manual visibility flags
project-specific presentation overrides
feed-governed media ordering state
consent/publication evidence
listingPresenceStatus
```

Media ordering rule:

```text
source allows reorder = true
→ project override MAY be allowed

source is-image-order-change-allowed = false
→ source order is authoritative for feed media
→ manual reorder of feed-origin images is disabled
```

Это **не shared data**.

Другой Project никогда его не получает.

---

## 3.4 SITE_CODE_CONFIG

Принадлежит репозиторию клиентского сайта.

```text
URL grammar
reserved namespaces
SEO architecture
SEO templates
canonical policy
indexability rules
Content Gate
filter indexation policy
sitemap rules
robots
structured-data rules
static pages
company content
legal pages
design
CTA system
forms
analytics
```

Hub не принимает окончательное SEO-решение.

---

# 4. SEO И URL — ФИНАЛЬНАЯ ГРАНИЦА

SEO принадлежит сайту.

Hub не решает:

```text
index / noindex
canonical strategy
sitemap inclusion rules
filter indexing
SEO templates
page intent
internal linking strategy
final Title / Description / H1 generation
```

Но Hub может хранить project-specific persistent URL state.

Разделение:

```text
SITE:
URL grammar
SEO policy
route semantics

HUB:
entity → assigned slug/path
redirect history
publicUrlId
lifecycle
tombstones
```

Hub URL Registry является persistence layer, а не владельцем URL-архитектуры.

Например:

```text
Site policy:
  /kvartiry/<slug>-<publicUrlId>

Hub state:
  entity X
  publicUrlId = a7f3k
  slug = 2k-ulitsa-lenina
  canonicalPath = /kvartiry/2k-ulitsa-lenina-a7f3k
```

После публикации public identity не переиспользуется.

---

# 5. SITE EDITORIAL

Разделить static editorial и dynamic entity editorial.

## Static editorial

Хранится в репозитории сайта:

```text
Главная
О компании
Услуги
Ипотека
Контакты
юридические документы
статьи
landing pages
```

## Dynamic entity editorial

Может храниться в project scope Hub:

```text
shortDescription
description
FAQ
presentation notes
media ordering
agent bio
```

Hub не должен хранить:

```text
глобальную SEO-стратегию проекта
правила indexability
canonical rules
sitemap policy
Content Gate rules
```

Final metadata всегда строит сайт.

---

# 6. PROJECT PORTABILITY — ОБЯЗАТЕЛЬНЫЙ ИНВАРИАНТ

AMS REALTY LITE не должен быть технически привязан к AMS Data Hub навсегда.

Нужно различать:

```text
runtime independence
и
vendor independence
```

## Runtime independence

При недоступности:

```text
Hub
S3
network
```

сайт продолжает работать на локальном last-good snapshot.

Это обязательное свойство обычной production эксплуатации.

---

## Vendor independence

Если клиент прекращает работу с AMS:

```text
сайт
+ код
+ content
+ current data
+ URLs
+ redirects
+ media
```

должны продолжать работать без AMS Data Hub.

Для этого вводится обязательный:

```text
ProjectExitBundleV1
```

---

# 7. PROJECT EXIT BUNDLE

Перед передачей проекта формируется self-contained export.

Минимум:

```text
exit/
  manifest.json

  data/
    geo.json
    developers.json
    developments.json
    buildings.json
    listings.json
    agents.json
    project-contacts.json
    editorial.json
    urls.json
    redirects.json
    lifecycle.json

  media/
    manifest.json

  contracts/
    snapshot schemas

  docs/
    HANDOFF.md
    DATA_SCHEMA.md
    OPERATIONS.md
```

Exit Bundle содержит всё публичное project state, необходимое сайту.

Agent boundary:

```text
public Exit Bundle
→ AgentPublicV1 only

never in public Exit Bundle datasets:
→ AgentExternalIdentity
→ phoneNorm / emailNorm identity helpers
→ AgentMatchReview / matching state
→ Hub audit internals
```

Consent/publication evidence не смешивается с публичным `AgentPublicV1`. Если агентство как оператор/контролёр персональных данных вправе и должно получить эти записи при handoff, они передаются **отдельным защищённым operational handoff**, с ограничением доступа и аудитом передачи.

Не содержит:

```text
AMS tenant internals
Hub audit internals
source credentials
foreign projects
raw feeds
private agent identity/matching data
consent evidence inside public datasets
AMS secrets
```

---

# 8. REALTY LITE EXIT MODE

REALTY LITE обязан поддерживать:

```text
DATA_MODE=hub
DATA_MODE=local
```

## hub

Обычная эксплуатация:

```text
Hub
→ signed snapshot
→ S3
→ Lite
```

## local

После handoff:

```text
local project dataset
→ Lite
```

Отключаются:

```text
Hub polling
Hub webhook
Hub ACK
AMS S3 credentials
```

Сайт продолжает:

```text
build
start
render
serve catalog
serve URLs
serve redirects
accept leads
```

без AMS Hub.

---

# 9. BUILD INDEPENDENCE

После handoff сайт должен собираться без доступа к приватной инфраструктуре AMS.

Следовательно, перед exit:

```text
private contracts dependency
```

не должна быть обязательной для будущей сборки клиента.

Допустимые способы:

```text
vendored immutable schemas
или
transferable package artifact
```

Конкретный механизм фиксируется ADR.

Обязательный proof:

```text
fresh machine
+ repository
+ exit bundle
+ no AMS credentials
→ pnpm install/build
→ production start
```

---

# 10. MEDIA INDEPENDENCE

Обычная эксплуатация:

```text
Hub media mirror
→ AMS S3
→ Lite
```

При handoff нельзя оставить production-сайт зависимым от AMS-owned media storage.

До exit:

```text
media
→ копируются в client-controlled storage
или
→ передаются вместе с project assets
```

После чего URL в Exit Bundle переписываются на новую media origin.

Обязательный proof:

```text
AMS media bucket unavailable
→ handed-off site renders all transferred media
```

---

# 11. ОГРАНИЧЕНИЕ EXIT CONTRACT

Exit Bundle гарантирует:

```text
работу сайта
текущие данные
URL history
redirects
media
current editorial
lead forms
```

Он не обязан автоматически обеспечивать дальнейшее обновление клиентского XML.

После ухода AMS:

```text
текущий сайт работает
```

но для будущего автоматического XML ingestion новый подрядчик должен:

```text
реализовать собственный importer
или
подключить другой data backend
```

Это не vendor lock-in сайта.

Это замена upstream data service.

---

# 12. CLIENT DB ISOLATION

Запрещено:

```text
Agency A site
Agency B site
Agency C site
→ shared client PostgreSQL
```

Правильно:

```text
AMS Hub
→ Snapshot A
→ Site A

AMS Hub
→ Snapshot B
→ Site B
```

Lite сайты вообще не имеют project DB.

FULL profile имеет отдельную DB на каждого клиента.

---

# 13. GLOBAL IDENTITY

Internal Hub database identity:

```text
id = cuid
```

Shared catalog identity:

```text
uid = immutable ULID
```

Для:

```text
Region
City
District
Developer
Development
Building
```

Project public identity:

```text
publicUrlId
```

Правила:

```text
не зависит от slug
не зависит от database sequence
не переиспользуется
переживает archive
переживает restore
переживает relink
```

---

# 14. SHARED CITY CATALOG

Основные сущности:

```text
Region
City
District
Developer
Development
Building
PriceObservation
SharedMediaAsset
FactProvenance
CatalogChangeSet
CatalogEntityVersion
```

Development относится к City.

Project подключается через:

```text
ProjectCatalogSubscription
```

Режимы:

```text
ALL_SHARED
CURATED
```

---

# 15. PROJECT SOURCES

```text
Organization
→ Project
→ 1..N Source
```

Каждый Source:

```text
independent
independent Last Good
independent ImportRun
independent safety policy
independent adapter
```

Source может иметь один или несколько dataset semantics:

```text
MIXED_REALTY
RESALE
NEW_BUILD
HOUSE
LAND
COMMERCIAL
AGENT
```

Один XML способен выдавать несколько entity types.

Для Bastion pilot один Source является именно:

```text
datasetType = MIXED_REALTY
transportType = HTTPS_XML
formatFamily = YRL_REALTY_2010
adapterKey = yrl-realty-2010
profileKey = vladis-vt24-v1
sharingPolicy = PROJECT_ONLY
```

Категории offer внутри одного Source не создают искусственно несколько Source.

Нельзя делать:

```text
Bastion Apartments Source
Bastion Houses Source
Bastion Land Source
```

если upstream фактически является одним XML и имеет единый lifecycle/fetch boundary.

Правильно:

```text
Bastion Mixed Realty Source
→ one fetch
→ one raw artifact
→ one source revision
→ many normalized entity categories
```

---

# 16. XML / YRL SOURCE ADAPTER

Базовый контракт разделяется на три уровня:

```text
SourceAdapter
→ SourceProfile
→ Project/Source Config
```

## 16.1. SourceAdapter

`SourceAdapter` понимает технический формат источника.

Для Bastion:

```text
YrlRealty2010Adapter
```

Он не знает бренд Bastion и не должен содержать `projectId` branching.

Концептуальный контракт:

```ts
interface SourceAdapter {
  descriptor: {
    key: string
    version: string
    formatFamily: SourceFormatFamily
    emits: readonly EntityType[]
    capabilities: readonly AdapterCapability[]
  }

  fetch(ctx: SourceFetchContext): Promise<RawArtifactRef>

  inspect(
    artifact: RawArtifactRef,
    ctx: SourceParseContext
  ): Promise<SourceArtifactInspection>

  parse(
    artifact: RawArtifactRef,
    ctx: SourceParseContext
  ): AsyncIterable<RawRecordEnvelope>

  normalize(
    record: RawRecordEnvelope,
    profile: SourceProfile,
    ctx: NormalizeContext
  ): NormalizedEntityEnvelope[]
}
```

`normalize()` может вернуть несколько envelopes из одного upstream offer, например:

```text
offer
→ InventoryEntity
→ AgentCandidate / AgentExternalIdentity evidence
→ Media references
→ Source evidence
```

Нельзя:

```text
ClientAParser
ClientBParser
BastionParser
```

если различие связано с producer profile или mapping, а не с реальным новым XML format.

---

## 16.2. SourceProfile

`SourceProfile` нужен для различий внутри одного известного формата.

Пример:

```text
adapterKey = yrl-realty-2010
profileKey = vladis-vt24-v1
```

Profile может определять:

```text
accepted namespaces
producer quirks
field aliases
category aliases
transaction aliases
unit aliases
known placeholder patterns
known sparse fields
suspiciousTextPatterns
sharedOfficePhone patterns/values
agent extraction strategy
media URL treatment
producer-specific validation warnings
producer-specific optional mapping
```

Для `vladis-vt24-v1` suspicious text создаёт `WARNING` и operational flag, но **не запускает AI auto-edit**.

Разрешён только детерминированный cleanup, явно описанный profile contract. Для подтверждённого префикса вида:

```text
Код объекта: <value>.
```

правило v1:

```text
extract → sourceObjectCode (internal)
remove exact recognized prefix from public description projection
preserve original raw value in source artifact/provenance
```

Profile **не имеет права**:

```text
обходить Safety Engine
обходить tenant scope
автоматически publish suspicious import
менять SEO policy сайта
создавать project-specific if/else в core adapter
редактировать factual/editorial text через AI
```

---

## 16.3. Project / Source Config

Конфигурация конкретного Source содержит минимум:

```text
projectId
sourceId
name
datasetType
transportType
endpointCredentialRef
adapterKey
adapterVersion
profileKey
profileVersion
sharingPolicy
schedulePolicy
safetyPolicyId
enabled
expectedNamespace?
expectedProducer?
notes?
```

Для Bastion pilot:

```text
name = Bastion / Vladis Mixed Realty
adapterKey = yrl-realty-2010
profileKey = vladis-vt24-v1
datasetType = MIXED_REALTY
sharingPolicy = PROJECT_ONLY
```

Feed endpoint является **secret configuration / capability secret**, если знание URL само даёт доступ к данным.

Следовательно:

```text
full feed URL
→ secret store / credentialsRef
→ resolved only server-side at fetch time
→ redacted in logs, UI history, docs and fixtures
```

Docs могут содержать только безопасный шаблон:

```text
https://vladis.vt24.ru/advert-feed/<redacted>
```

Feed endpoint никогда не является частью parser code.

---

## 16.4. YRL format family

Для первого production adapter поддерживается family:

```text
Yandex Realty Language
namespace:
http://webmaster.yandex.ru/schemas/feed/realty/2010-06
```

Adapter обязан корректно обрабатывать:

```text
realty-feed
generation-date
offer[]
```

и вложенные offer fields через namespace-aware streaming XML parser.

Запрещается DOM-load всего feed в память как единственная production strategy.

---

## 16.5. Bastion pilot — verified source behavior

Raw XML audit 2026-10-02 подтвердил, что один Source содержит несколько категорий и mixed producer vocabulary.

Observed mapping baseline:

```text
квартира      → APARTMENT
комната       → ROOM
house         → HOUSE
часть дома    → HOUSE_PART
lot           → LAND
дача          → COTTAGE
таунхаус      → TOWNHOUSE
гараж + box   → GARAGE_BOX
```

Также подтверждены дополнительные source fields, которые должны быть отражены в profile mapping table:

```text
deal-status
rooms-type
window-view
balcony
bathroom-unit
renovation
built-year
ceiling-height
heating-supply
room-furniture
parking-type
lot-type
video-review / online-show
disable-flat-plan-guess
is-image-order-change-allowed
location/apartment
```

Producer vocabulary может быть смешанным:

```text
type values → русские значения, например «продажа»
category values → русские и английские aliases, например «квартира» / "lot"
units → «кв. м», «сотка» и другие producer aliases
```

Важно:

- mapping строится по фактическим XML fields, а не по concatenated extracted text;
- raw tag names и attributes фиксируются fixture tests;
- неизвестная category/value создаёт issue/review и не silently coerced;
- optional field absence не превращается в false/0;
- никакие source literals конкретного города/региона не попадают в core adapter.

---

## 16.6. Transaction / deal mapping

Hub хранит transaction semantics отдельно от property type и отдельно от deal semantics.

Transaction минимум:

```text
SALE
RENT_LONG
RENT_SHORT
UNKNOWN
```

Deal semantics минимум:

```text
SECONDARY_SALE
PRIMARY_SALE
ASSIGNMENT
UNKNOWN
```

Для `vladis-vt24-v1` mapping учитывает:

```text
type
property-type
category
deal-status
price.period
```

`deal-status` не подменяет `transactionType`.

Пример:

```text
type = продажа
+
deal-status = primary-sale
→ transactionType = SALE
→ dealKind = PRIMARY_SALE
```

Признак новостройки/переуступки публикуется как factual data. URL/SEO-решение остаётся Site-owned.

---

## 16.7. Source identity для offer

Канонический primary source identity:

```text
(projectId, sourceId, externalOfferId)
```

Для проверенной Bastion XML-выборки:

```text
offer@internal-id = PRESENT / VERIFIED
```

Поэтому профиль v1 использует `offer@internal-id` как `externalOfferId` при валидном значении.

Отдельно требуется проверить на run 2–3:

```text
stability of the same internal-id across repeated source revisions
```

Нельзя использовать как primary identity:

```text
address
price
cadastral number
photo URL
description hash
agent phone
```

Они mutable или ненадёжны.

Если upstream identity отсутствует в будущем source/profile:

```text
→ import warning/error according to policy
→ explicit identity fallback ADR before production apply
```

Bastion pilot не вводит heuristic identity как silent default.

---

## 16.8. Cadastral numbers и placeholder values

В observed Bastion feed встречаются как похожие на реальные кадастровые номера, так и значения, похожие на placeholders/test values.

Следовательно:

```text
cadastralNumber != identity
```

Нужно хранить:

```text
cadastralNumberRaw?
cadastralNumberNormalized?
cadastralValidationStatus
```

Statuses:

```text
VALID_FORMAT
INVALID_FORMAT
PLACEHOLDER_SUSPECTED
ABSENT
```

Placeholder patterns задаются profile-level rules и могут создавать warning.

Автоматическая подмена/исправление кадастрового номера запрещена.

---

## 16.9. Raw hash vs normalized semantic hash

У feed может меняться `generation-date` даже при отсутствии meaningful inventory change.

Поэтому вводятся два разных hash:

```text
rawArtifactHash
normalizedContentHash
```

`rawArtifactHash`:

```text
SHA-256 exact fetched artifact bytes
```

`normalizedContentHash`:

```text
hash stable normalized source state
without volatile transport metadata
```

Назначение:

```text
rawArtifactHash
→ audit / artifact integrity

normalizedContentHash
→ semantic no-change detection
```

Нельзя пропускать validation только потому, что normalized hash совпал, если transport/security inspection не прошёл.

---

## 16.10. Sparse-field semantics

YRL feed содержит category-dependent и optional fields.

Отсутствие поля не равно `false` и не равно `0`.

Нужно различать:

```text
ABSENT
EXPLICIT_FALSE
EXPLICIT_ZERO
VALUE
INVALID
```

Особенно для:

```text
agent photo
rooms
floor
floorsTotal
livingArea
kitchenArea
lotArea
buildingYear
ceilingHeight
balcony/loggia
bathroom-unit
window-view
renovation
heating-supply
room-furniture
parking-type
lot-type
video-review/online-show
disable-flat-plan-guess
utilities
cadastralNumber
coordinates
rent period
```

В public DTO `null/undefined` policy фиксируется contract schema.

## 16.11. Units and time normalization

Profile alias table обязан нормализовать observed units, включая:

```text
кв. м → m²
сотка → 100 m²
```

Все timestamps в Hub domain state хранятся в UTC.

Source provenance дополнительно сохраняет:

```text
rawTimestamp
rawOffset
```

Это важно, потому что один feed может использовать разные offsets для `generation-date`, `creation-date` и `last-update-date`.

Нормализация timezone не меняет raw audit evidence.

---

# 17. XML IMPORT PIPELINE

```text
Source trigger
→ Safe Intake
→ XML artifact
→ SourceAdapter
→ streaming parse
→ validation
→ normalization
→ identity resolution
→ safety analysis
→ staging
→ MutationPlan
→ short DB apply
→ SourceRevision
→ GOOD
→ snapshot compose
```

Broken source никогда не заменяет Last Good.

---

# 18. SOURCE LAST GOOD

Last Good существует на уровне Source.

Пример ниже означает **три независимых upstream-фида**, а не искусственное дробление одного XML:

```text
Project A

Source 1: resale.xml       GOOD 134
Source 2: newbuild.xml     GOOD 52
Source 3: houses.xml       GOOD 88
```

Если upstream фактически является одним mixed XML, он остаётся одним Source согласно §15.

Ошибка одного Source не блокирует остальные.

Snapshot фиксирует точные SourceRevision inputs.

---

# 18A. CANONICAL PROJECT INVENTORY MODEL

Bastion pilot требует не хранить YRL shape напрямую как public/domain shape.

Внутренняя цепочка:

```text
Raw YRL Offer
→ Parsed YRL Record
→ Normalized Inventory Entity
→ Project factual state
→ Public Inventory DTO
```

## 18A.1. Base InventoryEntity

Минимальная модель:

```text
InventoryEntity

id
uid
organizationId
projectId

sourceId
externalId

propertyType
transactionType
dealKind?
status

sourceCreatedAt?
sourceUpdatedAt?
firstSeenAt
lastSeenAt

title?
descriptionHtmlSafe?
descriptionText?
sourceObjectCode?          // internal only

price?
currency?
rentPeriod?

address
geo
locationPrecision

agentUid?

facts
media[]
isImageOrderChangeAllowed?

sourceHash
normalizedHash

createdAt
updatedAt
```

`facts` является typed union по `propertyType`, а не бесконтрольным JSON dump.

## 18A.2. AddressValue / privacy boundary

Source может содержать точные непубличные части адреса, включая номер квартиры.

Canonical split:

```text
AddressValue

addressPublic
apartmentNumberPrivate?    // internal only
sourceAddressRaw?          // provenance/internal only
```

Hard privacy invariant:

```text
apartmentNumberPrivate
-X→ Public Inventory DTO
-X→ snapshot
-X→ ProjectExitBundle public dataset
-X→ analytics/logs
```

Public location precision является project publication policy:

```text
EXACT
STREET
DISTRICT
```

Правило:

```text
Hub stores necessary internal factual location
→ Snapshot Composer applies project-approved public precision
→ Lite may reduce precision further
→ Lite may never reconstruct/increase hidden precision
```

Для Bastion v1 до E32 утверждён безопасный baseline:

```text
APARTMENT     → STREET
ROOM          → STREET
HOUSE         → STREET
HOUSE_PART    → STREET
LAND          → STREET
COTTAGE       → STREET
TOWNHOUSE     → STREET
GARAGE_BOX    → STREET
```

Для HOUSE/HOUSE_PART/LAND/COTTAGE/TOWNHOUSE/GARAGE_BOX Project может явно понизить точность до `DISTRICT`. `EXACT` для Bastion не включается без отдельного owner decision и privacy review.

Если `STREET` или `DISTRICT`, public coordinates также должны быть generalized/omitted according to the same policy; недостаточно скрыть только строку квартиры.

Coordinate generalization MUST be deterministic for the same entity and policy version:

```text
same entity uid
+ same precision policy/version
→ same generalized public coordinates across snapshots
```

Allowed mechanisms:

```text
deterministic coordinate rounding / grid snap
or
stable street/district centroid derived from canonical geo data
```

Forbidden:

```text
random jitter on every snapshot/request
```

Random jitter is unsafe because repeated observations can be averaged to approximate the hidden exact point.

Mandatory test:

```text
same entity + same policy
→ snapshot N geoPublic == snapshot N+1 geoPublic
```

## 18A.3. Description normalization / safe HTML

Feed description может содержать CDATA/HTML.

Raw feed HTML никогда не является public-safe contract.

Pipeline:

```text
raw description
→ bounded parse
→ allowlist sanitizer
→ descriptionHtmlSafe
→ plain-text projection
→ descriptionText
```

Allowed baseline tags:

```text
p
br
ul
ol
li
strong
em
```

Removed baseline:

```text
script
style
iframe
object
all event attributes
all style attributes
all arbitrary attributes
links / href
unknown tags
```

Lite:

```text
-X→ raw feed HTML
```

If rendering HTML, Lite uses only `descriptionHtmlSafe` from the versioned public contract.

Deterministic source cleanup, such as exact extraction of `Код объекта: <value>.`, happens before public projection according to SourceProfile; original bytes remain in provenance/raw artifact.

## 18A.4. Canonical property types V1

```text
APARTMENT
ROOM
HOUSE
HOUSE_PART
LAND
COTTAGE
TOWNHOUSE
GARAGE_BOX
```

Architecture-ready enums:

```text
COMMERCIAL
NEW_BUILD_UNIT
OTHER
```

`OTHER` does not mean silent acceptance.

Unknown source category:

```text
→ ImportIssue
→ mapping review
→ explicit mapping addition
```

## 18A.5. ApartmentFacts

```text
rooms?
roomsType?
totalAreaM2?
livingAreaM2?
kitchenAreaM2?
floor?
floorsTotal?
ceilingHeightM?
buildingType?
buildingYear?
renovation?
bathroomType?
windowView?
balconyText?
balconies?
loggias?
heatingSupply?
roomFurniture?
parkingType?
isGroundFloor?
disableFlatPlanGuess?
videoReviewAvailable?
onlineShowAvailable?
```

## 18A.6. HouseFacts

```text
rooms?
roomsType?
totalAreaM2?
livingAreaM2?
kitchenAreaM2?
lotAreaM2?
floorsTotal?
ceilingHeightM?
buildingType?
buildingYear?
renovation?
landPurpose?
lotType?
heatingSupply?
utilities?
parkingType?
```

## 18A.7. LandFacts

```text
lotAreaM2?
landPurpose?
lotType?
cadastralNumberRaw?
cadastralNumberNormalized?
cadastralValidationStatus?
utilities?
```

## 18A.8. Room / House Part / Cottage / Townhouse / Garage

Каждый тип получает собственный typed facts contract.

Не допускается:

```text
facts: Record<string, any>
```

как долгосрочный domain contract.

Допустимо временное `sourceExtras` только если:

```text
private/internal only
bounded
schema-versioned
never serialized blindly to public snapshot
```

## 18A.9. Unit normalization

Hub приводит numeric facts к каноническим units:

```text
area → m²
lot area → m²
price → monetary amount + currency
coordinates → decimal degrees
height → meters
```

SourceProfile содержит alias table producer units, включая observed:

```text
кв. м → m²
сотка → 100 m²
```

Provenance сохраняет original value/unit.

## 18A.10. Phone normalization

Agent/work phone normalization uses a proven phone-number library/strategy with E.164 target where valid.

Bastion fixture set must include observed `+7 959 ...` numbers.

Policy:

```text
valid parse
→ phoneNorm

library rejects / number uncertain
→ raw phone preserved
→ WARNING
→ record/import does not fail only because normalization failed
```

No phone is silently dropped.

---

# 18B. BASTION DATA QUALITY POLICY

Real feed уже показывает, что production adapter должен быть tolerant к неполноте, но strict к identity/security.

## 18B.1. Severity model

```text
INFO
WARNING
ERROR
CRITICAL
```

### INFO

Не блокирует record/import.

### WARNING

Record может быть принят, issue фиксируется.

### ERROR

Конкретная record rejected/quarantined, если policy разрешает partial validity.

### CRITICAL

Import run не может стать GOOD.

---

## 18B.2. Critical examples

```text
malformed XML
DTD/entity expansion attempt
untrusted external entity
missing source identity on material share of records
namespace mismatch when strict profile requires namespace
truncated document
massive count drop above policy
project/source scope mismatch
unsafe media/source URL handling
```

---

## 18B.3. Warning examples

```text
agent photo missing
cadastral number absent
suspected cadastral placeholder
optional area absent
building year absent
unknown optional enum value
description empty
suspicious source text pattern detected
source object code prefix detected/extracted
coordinates absent but address present
media list empty
```

---

## 18B.4. Unknown enum handling

Unknown enum value:

```text
raw value preserved internally
→ ImportIssue
→ normalized enum = UNKNOWN only where contract allows
```

Нельзя silently map неизвестное значение к ближайшему известному.

---

## 18B.5. Fixture corpus

До production запуска Bastion нужно сохранить sanitized fixture corpus:

```text
fixtures/yrl/vladis-vt24/

apartment-sale.xml
apartment-rent.xml
house.xml
land.xml
room.xml
house-part.xml
cottage.xml
townhouse.xml
garage-box.xml
agent-with-photo.xml
agent-without-photo.xml
missing-optional-fields.xml
invalid-cadastral.xml
placeholder-cadastral.xml
malformed.xml
truncated.xml
```

Fixtures не должны содержать ненужные реальные private данные.

---

# 18C. BASTION AGENT EXTRACTION PROFILE

Raw audit confirms agent data is embedded inside offer context.

## 18C.1. Extraction

`vladis-vt24-v1` extracts:

```text
fullName?
workPhone?
photoUrl?
category?       // observed: agency
```

### VERIFIED in audited raw sample

```text
full name
phone
agent photo for part of agents
category=agency
dedicated agent external ID NOT observed
email NOT observed
```

Future source revisions may add fields; parser may capture them as evidence, but profile v1 must not make them required without fixture proof.

## 18C.2. Canonical matching for vladis-vt24-v1

Because no dedicated agent ID was found in the audited sample, baseline key is:

```text
phoneNorm within Project
```

But phone match is safe only if identity is unambiguous.

Collision rule:

```text
same phoneNorm
+ different normalized fullName
→ AgentMatchReview
→ no auto-merge
→ no duplicate auto-create from that ambiguous evidence
```

SourceProfile can mark a known number as:

```text
sharedOfficePhone = true
```

Then:

```text
phone matching disabled for identity
→ listing may fall back to agency contact
→ explicit/manual agent relation required
```

Name/photo alone are never auto-merge keys.

## 18C.3. Agent source evidence

```text
AgentSourceEvidence

projectId
sourceId
agentUid?
fullNameRaw?
phoneRaw?
phoneNorm?
photoSourceUrl?
categoryRaw?
firstSeenAt
lastSeenAt
sourceRevisionId
```

Optional future fields such as email/externalAgentId are schema-versioned and added only after actual producer evidence.

This evidence is not public DTO.

---

# 18D. MEDIA PROFILE FOR YRL / VLADIS

Feed содержит object images и часть agent photos через external HTTP(S) URLs.

## 18D.1. Media classification

```text
LISTING_IMAGE
AGENT_PHOTO
DEVELOPMENT_IMAGE
OTHER
```

## 18D.2. Mirroring

```text
source URL
→ Safe Outbound
→ status/content type/size validation
→ bytes hash
→ dedupe
→ S3
→ MediaAsset
→ public DTO URL
```

Query-string variation не является media identity.

Media identity после загрузки:

```text
sha256(bytes)
```

Source URL остаётся provenance.

## 18D.3. Source image-order contract

`is-image-order-change-allowed=false` is authoritative producer instruction for feed-origin images.

```text
false
→ preserve feed order
→ disable manual reordering of feed-origin images

true / absent where profile permits
→ project override may be allowed by explicit UI policy
```

Effective flag is stored on normalized inventory/public presentation state as required by contract.

Manual project-owned images may be managed separately, but must not silently reorder protected feed-origin sequence.

## 18D.4. Failure semantics

One unavailable image must not fail the entire Source.

```text
inventory import status
!=
media mirror status
```

Default Bastion V1:

```text
missing one or more media
→ WARNING
→ entity may remain publishable

zero usable media
→ policy-driven warning
```

Agent photo enters public snapshot only when agent publication authorization/consent gate passes.

---

# 18E. LISTING ↔ SHARED DEVELOPMENT LINK

Secondary/project inventory may reference a known shared Development, but this relation is never auto-promoted into Shared Catalog.

Tenant-owned relation:

```text
ListingDevelopmentLink / SourceCatalogMatch

projectId
inventoryUid
developmentUid?
candidateReason
candidateConfidence?
status = CANDIDATE | CONFIRMED | REJECTED
confirmedBy?
confirmedAt?
sourceRevisionId?
```

Candidate generation may use:

```text
address similarity
known development name/alias
source-provided development reference
```

But:

```text
candidate
-X→ automatic confirmed link
-X→ Shared Catalog mutation
```

Only explicit authorized confirmation may attach `developmentUid` to project inventory.

This relation is `TENANT_OWNED`.

---

# 19. AGENT — PROJECT DOMAIN

Agent никогда не является shared entity.

Scope:

```text
Organization
→ Project
→ Agent
```

Один агент одного агентства не становится глобальным AMS Agent.

---

# 20. INTERNAL AGENT MODEL

```text
Agent

id
uid                 ULID
organizationId
projectId

slug
role
origin

fullName
position?
bio?
specializations[]

photoMediaUid?

workPhone?
workEmail?
messengers?

showOnSite
sortOrder

status
listingPresenceStatus

consentConfirmedBy?
consentConfirmedAt?
consentBasis?
consentBatchId?

createdAt
updatedAt
```

Enums:

```text
role:
  AGENT
  LAWYER
  MORTGAGE_BROKER
  MANAGER
  OTHER

origin:
  FEED
  MANUAL

status:
  ACTIVE
  HIDDEN
  DEPARTED

listingPresenceStatus:
  HAS_ACTIVE_LISTINGS
  NO_ACTIVE_LISTINGS
  UNKNOWN
```

Employment/publication lifecycle and listing presence are separate dimensions.

---

# 21. AGENT EXTERNAL IDENTITIES

Отдельная таблица:

```text
AgentExternalIdentity

agentUid
projectId
sourceId

externalId?
phoneNorm?
emailNorm?

firstSeenAt
lastSeenAt
```

Один Agent может иметь несколько source identities.

---

# 22. AGENT MATCHING

Generic priority when a verified dedicated upstream ID exists:

```text
1. (sourceId, externalId)
2. normalized phone within Project, only if unambiguous
3. normalized email within Project, only if available and unambiguous
4. ambiguous → AgentMatchReview
```

For `vladis-vt24-v1` audited sample:

```text
dedicated external agent ID = not observed
email = not observed
baseline identity evidence = phoneNorm within Project
```

Collision guard:

```text
same phoneNorm + different normalized fullName
→ AgentMatchReview
→ no auto-merge
→ no auto-create duplicates from ambiguous evidence
```

Known shared office number:

```text
sharedOfficePhone = true
→ phoneNorm excluded from automatic identity matching
```

ФИО и photo URL сами по себе не являются безопасным auto-merge key.

Один человек из Source A + Source B может соответствовать одному Agent только внутри одного Project.

Никогда между разными Project.

---

# 23. AGENT FIELD OWNERSHIP

FEED_OWNED:

```text
fullName      только initial create
workPhone
workEmail
feed photo fallback
```

MANUAL_OWNED:

```text
role
position
bio
specializations
selected photo
showOnSite
sortOrder
slug
manual listing assignment
```

Правило:

```text
Feed
-X→ MANUAL_OWNED
```

`origin=MANUAL` никогда не изменяется фидом.

---

# 24. AGENT LIFECYCLE

YRL agent exists only inside offer context. Therefore disappearance from listings does **not** prove that the person left the agency.

Canonical rule:

```text
no current offer references Agent
→ listingPresenceStatus = NO_ACTIVE_LISTINGS
→ Agent.status remains unchanged
→ agent page may remain public according to project policy
```

Feed must never automatically set:

```text
status = DEPARTED
```

`DEPARTED` requires:

```text
explicit manual authorized action
or
future explicit reliable upstream employment signal defined by separate profile/ADR
```

Manual Agent also never changes employment status from XML disappearance.

If Agent is `NO_ACTIVE_LISTINGS`, UI must not fabricate active inventory; it can show profile/contact and an empty/alternative state.

---

# 25. AGENT SAFETY

Mass agent-state changes remain protected even though missing offers no longer imply departure.

Safety applies to bulk operations such as:

```text
manual/batch DEPARTED transitions
bulk consent/publication changes
large matching/relink operations
mass visibility changes
```

If impacted Agents:

```text
> AGENT_MAX_DEPART_PERCENT
```

default guard remains:

```text
30%
```

then:

```text
SUSPICIOUS
→ no automatic lifecycle mutation
→ owner alert/review
```

The 30% guard is a safety threshold, not employment inference logic.

---

# 26. AGENT MERGE / RELINK

Допускаются explicit operations:

```text
merge
relink
reject match
split incorrect match
```

Каждая операция:

```text
authorized
audited
versioned
```

---

# 27. AGENT ↔ INVENTORY

Inventory entity:

```text
agentUid?
```

При импорте XML:

```text
listing sales-agent
→ agent matching
→ agentUid
```

Если manual assignment существует:

```text
feed
-X→ manual agent assignment
```

---

# 28. AGENT PUBLICATION AUTHORIZATION / CONSENT

Agent data is project-specific personal data.

Before public agent block/photo publication, Hub must have recorded project authorization evidence according to the agency's lawful process.

V1 fields remain:

```text
consentConfirmedBy
consentConfirmedAt
consentBasis?
consentBatchId?
```

Hub Admin must support controlled bulk confirmation before first launch:

```text
Project
→ select Agents
→ record who confirmed
→ timestamp
→ basis/reference/note
→ audited batch event
```

Code does not decide whether a particular legal basis is sufficient; the agency/operator is responsible for the lawful basis and evidence.

Publication rule:

```text
Inventory listing publication
≠
Agent personal block publication
```

If listing is valid but agent publication authorization is missing:

```text
listing remains publishable
agentUid may remain internal relation
public listing DTO hides agent personal block/photo
Lite shows ProjectPublicContact fallback from snapshot `project/contacts`
```

Public Agent snapshot condition:

```text
status == ACTIVE
AND
showOnSite == true
AND
consentConfirmedAt != null
```

Agent photo from feed is also excluded from public artifact until this gate passes.

---

# 29. PUBLIC AGENT CONTRACT

Internal Agent model никогда не сериализуется напрямую.

Отдельный:

```text
AgentPublicV1
```

Минимум:

```text
uid
slug
role
fullName
position?
bio?
specializations[]
photo?
public work contacts only if explicitly allowed
```

Никогда не публикуются:

```text
AgentExternalIdentity
source IDs
phoneNorm
emailNorm
consent evidence
audit data
private contact fields
matching state
```

---

# 30. AGENT SNAPSHOT

Dataset:

```text
agents.<sha256>.json.gz
```

Listing содержит:

```text
agentUid?
```

Lite строит:

```text
/komanda/
/komanda/<slug>/
```

Agent page может показывать:

```text
AgentPageDTO
+
active listings for agentUid
```

Если agentUid отсутствует:

```text
показывается `ProjectPublicContact` из snapshot `project/contacts`
```

---

# 31. AGENT SEO

Hub не принимает SEO-решения Agent page.

Hub поставляет factual/public presentation data.

Сайт определяет:

```text
metadata
structured data
indexability
canonical
sitemap inclusion
```

Structured Data:

```text
Person
worksFor → Organization
```

только из фактических данных.

Departed agent URL:

```text
Hub lifecycle state
→ URL Registry redirect target
→ Lite executes 301
```

Default target:

```text
/komanda/
```

`listingPresenceStatus=NO_ACTIVE_LISTINGS` is **not** a departure signal and MUST NOT create a redirect. Agent page can remain `200`; its indexability/sitemap treatment is decided by Lite SEO policy and Content Gate.

---

# 32. AGENT MANUAL ENTRY

Канонический V1:

```text
Hub Admin
→ Agent form
```

Фото:

```text
upload
→ validate
→ sha256
→ dedupe
→ S3
```

Excel «Сотрудники» не входит в обязательный V1.

Он может быть добавлен позднее trigger-based epic.

---

# 32A. PROJECT PUBLIC CONTACT — AGENCY FALLBACK SOURCE OF TRUTH

`ProjectPublicContact` is the single owner of the general agency contact used when no public Agent relation is available.

Ownership:

```text
Hub / Project scope
```

Canonical model:

```text
ProjectPublicContact

projectId
phone
email?
addressPublic?
messengers?
hours?
updatedAt
```

Publication:

```text
Hub ProjectPublicContact
→ public projection
→ snapshot dataset project/contacts
→ Lite ProjectContactDTO
→ listing/agent fallback UI
```

Hard rule:

```text
project.config.ts -X→ duplicate agency fallback contact source of truth
```

Lite may define presentation labels/CTA behavior, but factual contact values come from snapshot in `DATA_MODE=hub` and from the exported local dataset in `DATA_MODE=local`.

If the contact is absent when a flow requires agent fallback:

```text
E32 = FAIL
```

The contact dataset contains only explicitly public business contact data and never agent identity helpers or consent evidence.

---

# 33. PROJECT EDITORIAL — SINGLE SOURCE OF TRUTH

Editorial ownership is split by content class, not duplicated.

Hub owns project-scoped dynamic presentation for operational entities:

```text
Inventory source description → normalized/sanitized Hub state
Agent bio/manual presentation → Hub project scope
short operational/presentation fields → Hub project scope
media selection/order where source contract allows it → Hub project scope
```

REALTY LITE repository owns long-form SEO/commercial content, including by default:

```text
static pages
journal/articles
long-form Development/ЖК SEO text
project commercial sections
```

Canonical Development rule:

```text
Shared Development facts → Hub
Project short factual/presentation overrides → Hub
Long-form SEO Development content → Site repository
```

Recommended path:

```text
content/developments/<developmentUid>.md
```

There must not be two simultaneous authoritative long-form texts for the same Development.

If a future Project intentionally chooses Hub-managed long-form Development editorial, that requires an explicit project ADR and disables the repository source for that content class. One content class → one owner.

Hub never owns site-wide SEO strategy, Content Gate, canonical policy or metadata templates.

---

# 34. PROJECT URL REGISTRY

Hub хранит project-specific persistent URL state:

```text
ProjectUrlEntry

projectId
entityType
entityUid
publicUrlId

slug
canonicalPath

createdAt
publishedAt?
retiredAt?
```

И:

```text
ProjectRedirect

projectId
fromPath
toPath
code = 301
createdAt
reason
```

Slug после первой публикации по умолчанию locked.

Изменение:

```text
old path
→ ProjectRedirect
→ new canonical path
```

---

# 35. URL POLICY OWNERSHIP

Hub хранит state.

Но policy принадлежит сайту.

В `PROJECT.md` фиксируются:

```text
URL grammar
reserved namespaces
entity path patterns
indexation policy
```

Hub не имеет права самостоятельно менять grammar.

Любое изменение URL policy:

```text
RISKY
→ owner decision
→ migration plan
→ redirect proof
```

---

# 36. LIFECYCLE

Hub отвечает за factual lifecycle сущностей:

```text
ACTIVE
INACTIVE
ARCHIVED
DEPARTED
```

Project-specific presentation lifecycle может включать:

```text
VISIBLE
ARCHIVED_VISIBLE
REDIRECTED
GONE
```

Hub передаёт решение в snapshot.

Lite исполняет:

```text
ACTIVE
→ normal render

ARCHIVED_VISIBLE
→ 200 + site-defined noindex treatment

REDIRECTED
→ 301

GONE
→ 410
```

Final HTTP/SEO policy определяется стандартом Lite.

---

# 37. SNAPSHOT

Snapshot — immutable project artifact.

Hub snapshot includes only public/project-consumable data after privacy/publication projection.

Canonical datasets:

```text
geo
developers
developments
buildings
prices
media
inventory
agents
project/contacts
editorial
urls
redirects
lifecycle
```

Inventory is a single normalized dataset with typed fields:

```text
propertyType
transactionType
dealKind?
facts
```

Do not split one project contract into parallel `resale/newbuild/houses/land/commercial` dataset families unless a measured size/transport trigger later justifies physical sharding. Logical domain taxonomy stays unified.

Hard exclusions from public snapshot:

```text
apartmentNumberPrivate
raw feed HTML
feed endpoint / credential refs
raw agent matching evidence
private phone/email normalization helpers
consent evidence
raw ImportIssue payloads
source secrets
```

---

# 38. SNAPSHOT MANIFEST

```text
schemaMajor
schemaMinor

projectId
publishSequence

generatedAt
publishedAt

catalogRevision
sourceRevisions[]

files[]

keyId
signature
```

Каждый file:

```text
kind
key
sha256
bytes
count
```

---

# 39. SNAPSHOT SECURITY

Manifest is signed with:

```text
Ed25519
```

Manifest identifies the signing key:

```text
keyId
signature
```

Private signing keys:

```text
secret store / HSM-capable secret boundary where available
-X→ repository
-X→ committed env files
-X→ client site
```

Lite stores a trust set of public verification keys, normally:

```text
current key
next key during planned overlap window
revokedKeyIds denylist/state
```

Lite verifies:

```text
keyId is trusted and not revoked
signature
projectId
schemaMajor
publishSequence
sha256
bytes
Zod
referential integrity
safety gates
```

## 39.1. Planned signing-key rotation

```text
1. generate next Ed25519 keypair
2. private next key enters secret store only
3. distribute next public key/keyId to Lite trust set
4. overlap window: current + next public keys trusted
5. begin signing new higher publishSequence with next keyId
6. prove all active Lite clients accepted next key
7. retire old keyId from active trust after overlap/runbook gate
```

Rotation does not require snapshot schema-major change.

## 39.2. Compromise / emergency revocation

```text
1. revoke compromised keyId in Hub/Lite trust policy
2. stop signing with compromised private key
3. activate emergency/current safe signing key
4. republish current approved content as NEW higher publishSequence
5. sign with safe keyId
6. notify/poll clients
7. Lite rejects any future snapshot using revoked keyId
```

A revoked-key snapshot never replaces last-good, even if its cryptographic signature validates against the old public key material.

Mandatory tests:

```text
trusted current keyId → accept if all other gates pass
trusted next keyId during overlap → accept if all other gates pass
unknown keyId → reject, last-good untouched
revoked keyId → reject, last-good untouched
rotation to next key + higher publishSequence → accept
emergency republish + higher publishSequence → accept
```

Composer-side privacy tests are mandatory before signing:

```text
no apartmentNumberPrivate
no raw feed HTML
no source endpoint/credential
no private agent evidence
no consent evidence
```

Bad snapshot never becomes empty/current site state.

---

# 40. SNAPSHOT DELIVERY

```text
Hub
→ immutable files
→ private/project S3 prefix
→ current manifest
→ webhook trigger

Lite
→ authenticated pull
→ verify
→ atomic local apply
→ authenticated ACK
```

Webhook carries no dataset.

Polling is fallback.

## 40.1. Per-project storage isolation

Each Project receives read-only access only to its own snapshot prefix/artifacts.

```text
Project A credentials
→ read Project A prefix
-X→ read Project B prefix
```

Implementation may use per-project credentials, scoped signed access or equivalent object-storage IAM, but isolation must be enforceable by storage policy, not only application convention.

Mandatory integration test:

```text
credentials A → Project B artifact = 403 / access denied
```

## 40.2. ACK authentication

ACK endpoint uses per-project authentication material:

```text
project-scoped token/key
rotation supported
server-side secret only
replay protection / idempotency
projectId + publishSequence validation
```

ACK token is never bundled into public client JavaScript and is rotatable without changing snapshot schema.

---

# 41. LIGHT LOCAL STATE

```text
/data/snapshots/
```

содержит last-good.

Hub outage:

```text
не влияет на page rendering
```

S3 outage:

```text
не влияет на уже применённый snapshot
```

---

# 42. ROLLBACK

`publishSequence` только увеличивается.

Rollback:

```text
old content
→ new snapshot
→ higher publishSequence
```

Сайт не принимает уменьшение sequence.

---

# 43. REALTY LITE RESPONSIBILITY

Lite владеет:

```text
Next.js runtime
UI
project config
URL grammar
SEO strategy
metadata resolver
canonical rules
sitemap
robots
structured data
static content
forms
lead delivery
analytics
local last-good
```

Lite не владеет:

```text
XML ingestion
shared catalog
project factual inventory
source identity
source revisions
agent matching
persistent dynamic URL Registry
factual lifecycle
```

---

# 44. LEADS

Lead handling is not part of Data Hub.

Used abstraction:

```text
LeadSink
```

Modes:

```text
direct
dual
hub
```

Data Hub does not become Lead Hub.

`LeadSubmissionV1.context` supports:

```text
entityRef?
agentUid?
```

## 44.1. Personal-data deployment boundary

Lead forms process personal data, therefore the concrete production deployment must be designed for applicable personal-data law and the client/operator's policies.

For Russian citizens' personal data collected through the Internet, the architecture must support database localization requirements applicable under Federal Law No. 152-FZ, including the current Article 18(5) rule for covered collection/storage operations.

Technical baseline:

```text
server-side validation
minimum necessary fields
purpose-bound retention policy
explicit deletion/TTL procedure
access control
secret isolation
TLS in transit
protected storage / encryption where selected by threat model and infrastructure policy
PII-redacted logs/analytics
processor/operator contractual responsibilities documented
```

Do not claim that a generic fixed TTL or blanket encryption setting by itself equals legal compliance. Exact retention term, legal basis, notification/consent model and security measures are project/legal requirements.

Lite Standard remains the runtime source for form/LeadSink behavior.

---

# 45. CLIENT EXIT AND LEADS

После handoff:

```text
LEADS_MODE=direct
```

должен работать без AMS Lead Hub.

Все AMS-specific lead endpoints могут быть отключены.

---

# 46. MEDIA

Hub mirror:

```text
source URL
→ Safe Outbound
→ validation
→ sha256
→ dedupe
→ S3
```

Media обязательно имеет rights metadata.

Hotlink не используется как production strategy.

---

# 47. DATA RIGHTS / EXIT DATA BOUNDARY

Each factual source:

```text
PROJECT_ONLY
or
AMS_SHARED
```

Client XML default:

```text
PROJECT_ONLY
```

Never:

```text
Client A XML
→ automatic Shared Catalog
→ Client B
```

Shared promotion requires explicit Platform Admin operation and documented rights basis.

## 47.1. Exit data classes

Subject to the governing commercial/legal agreement and applicable rights, technical export is designed as follows:

```text
PROJECT_FACT
→ export to client

project Agents/public presentation state
→ export to authorized client

project Editorial
→ export to client

project URL Registry / redirects / lifecycle
→ export to client

AMS_SHARED factual catalog used by the Project
→ frozen project-consumable copy as of exit date
→ no future AMS updates after exit
```

Shared catalog export is a frozen dependency copy, not transfer of AMS platform ownership. Legal license/usage terms belong in the commercial/legal agreement, not this technical master plan.

Consent/publication evidence is sensitive operational data. Where the client/agency is entitled and needs it as the personal-data operator/controller, secure handoff can include the relevant project evidence; it is never placed in public snapshot.

---

# 48. SECURITY

Mandatory:

```text
tenant isolation
RLS
Safe Outbound
private-address protection
redirect re-check
timeouts
response limits
XML DTD disabled
external entities disabled
streaming parse
DTO whitelist
secret isolation
audit
```

Agent identity/consent data and raw source artifacts are sensitive project data and never enter public artifacts.

## 48.1. Raw source artifact retention

`source-artifacts/` can contain names, phones, exact addresses and other source personal data.

Access:

```text
Platform Admin / explicitly authorized operations only
-X→ normal Project user download by default
-X→ public snapshot
-X→ fixtures
```

V1 retention policy is configurable and documented per deployment.

Operational default unless legal/business requirements require otherwise:

```text
retain last 3 GOOD raw artifacts
and
retain raw artifacts up to 30 days
whichever is needed for incident/debug proof within configured policy
```

Longer retention requires explicit documented purpose.

Deletion/retention job itself is audited.

Docs/fixtures contain only sanitized minimal samples and never capability-secret feed URLs.

---

# 49. ASYNC

Единая Hub async architecture:

```text
transactional outbox
→ pg-boss
→ worker
```

Не добавлять без ADR:

```text
Redis queue
BullMQ
RabbitMQ
Kafka
```

---

# 49A. TECHNOLOGY STACK / VERSION GOVERNANCE

This master plan defines architecture, not pinned dependency versions.

Canonical version sources:

```text
Hub exact package versions → Hub starter package.json + lockfile
Lite exact package versions → AMS REALTY LITE Standard/starter package.json + lockfile
PostgreSQL/runtime image versions → deployment manifests / infrastructure source of truth
```

Expected Hub technology families may include the derived starter baseline such as:

```text
Next.js / React
TypeScript
Prisma
PostgreSQL
Better Auth
pg-boss
Node.js
pnpm
S3-compatible object storage
```

Exact versions are verified in E00 against official release/security notes before implementation freeze.

Policy:

```text
no version invented in this document
lockfile = exact application dependency truth
security patch releases → prioritized upgrade after compatibility proof
major upgrades → explicit ADR / migration proof
```

---

# 50. HUB MODULES

```text
src/modules/

identity-access
project-registry
platform-operations
platform-admin

catalog
catalog-history
project-catalog
project-catalog-links

agents

source-registry
ingestion

project-editorial
project-contacts
project-urls
lifecycle

snapshots
deliveries
media
```

Platform:

```text
database
authorization
commands
jobs
storage
safe-outbound
observability
```

Contracts:

```text
@ams/data-contracts
@ams/realty-contracts
```

---

# 51. RLS CLASSIFICATION

Четыре класса:

```text
IDENTITY_PLATFORM
TENANT_OWNED
PLATFORM_RUNTIME
PLATFORM_SHARED_CATALOG
```

Agent и связанные сущности:

```text
TENANT_OWNED
```

Включая:

```text
Agent
AgentExternalIdentity
AgentMatchReview
AgentMergeEvent
```

Project Editorial:

```text
TENANT_OWNED
```

ProjectPublicContact:

```text
TENANT_OWNED
```

Project URL Registry:

```text
TENANT_OWNED
```

ListingDevelopmentLink / SourceCatalogMatch:

```text
TENANT_OWNED
```

---

# 52. DATA SAFETY GATE

До реальной production data:

```text
PostgreSQL backup configured
S3 retention configured
restore drill passed
CatalogExport verified
project identity reconcile verified
publicUrlId reservations verified
job freeze/unfreeze tested
raw artifact retention configured
per-project snapshot storage isolation tested
ACK token rotation tested
snapshot signing key rotation/revocation runbook + tests exist
runbook written
```

---

# 53. NEW PORTABILITY GATE

До первого коммерческого REALTY LITE клиента должен быть доказан:

```text
ProjectExitBundleV1
```

Proof:

```text
1. export Project
2. copy repository
3. empty machine / clean container
4. no Hub credentials
5. no AMS S3 credentials
6. DATA_MODE=local
7. build
8. start
9. catalog works
10. entity URLs work
11. redirects work
12. agent pages work
13. media work from transferred storage
14. lead direct mode works
```

Без PASS:

```text
REALTY LITE NOT READY FOR COMMERCIAL HANDOFF
```

---

# 54. RELEASE ROADMAP — v3.1.2

Architecture order remains foundation-first, but Bastion may use a fast path because its pilot is secondary/mixed inventory and does not require the shared new-build catalog as a blocker.

## R0 — Foundation

```text
E00 Derived starter normalization
E01 Tenancy / RLS / permissions
E02 Storage / Safe Outbound / secrets
E03 Contracts / identity
E04 Data Safety Gate
E05 Portability / Exit Contract foundation
E06 Shared Geo
```

## R1A — Bastion fast path: Lite delivery foundation

Required before R2/R2.1:

```text
E10 Project Editorial
E11 Project URL Registry + Lifecycle
E12 Snapshot Composer
E13 Delivery / ACK
E15 REALTY LITE integration proof
E16 Exit Bundle proof
```

`E14 Operations UI` may run in parallel and must be complete by Bastion production gate E32/E31.

## R1B — Shared Development Catalog

Not a blocker for first Bastion secondary pilot:

```text
E07 Developer / Development / Building
E08 History / provenance / prices / shared media
E09 Project Catalog Subscription
```

These may run in parallel with Bastion or immediately after pilot proof, before a client/project that depends on shared ЖК catalog.

## R2 — XML/YRL ingestion foundation

```text
E17 Source Registry v1
E18 Adapter Registry + SourceProfile
E19 YRL 2010 Parser Foundation
E20 Canonical Inventory Domain
E21 Inventory Identity + Lifecycle
E22 Agent Domain
E23 Agent Extraction + Matching
E24 Data Quality + Safety Rules
E25 Media Intake + Mirror
```

## R2.1 — Bastion production pilot

```text
E26 Vladis/Vt24 SourceProfile
E27 Bastion Feed Fixture Corpus
E28 Bastion End-to-End Import
E29 Bastion Snapshot Contract
E30 Bastion REALTY LITE Consumer Proof
E31 Bastion Operations + Alerting
E32 Bastion Pilot Release Gate
```

## R2.2 — Second feed proof

```text
E33 Second Real Feed Audit
E34 Adapter Reuse / New Adapter Decision
E35 Cross-Feed Contract Compatibility
E36 Multi-Source Project Composition Proof
```

## R3 — Trigger-based extensions

```text
E40 Optional XLSX bulk tools
E41 Optional API SourceAdapter
E42 Optional CSV SourceAdapter
E43 Client Hub access
E44 Advanced media GC
```

## R4 — FULL

```text
E50 PayloadDestination
E51 FULL override ownership
E52 LIGHT → FULL proof
```

---

# 54A. DETAILED EPICS E00–E16 — FOUNDATION + LITE CONTOUR

Этот блок является обязательным backlog до Bastion XML pilot. Он нужен, чтобы XML-контур не строился на недоказанном tenancy/storage/snapshot фундаменте.

## EPIC E00 — DERIVED STARTER NORMALIZATION

### Goal

Превратить существующий AMS Application Starter в понятную исходную точку Hub без greenfield-переписывания.

### Tasks

```text
audит package.json / lockfile / Node / pnpm
аудит Prisma schema и migrations
аудит Better Auth
аудит repository/application boundaries
аудит Dockerfile / compose
аудит SourceCraft CI
аудит tests / guards
аудит logging / health / readiness
удаление demo/product-specific leftovers
переименование product identity в AMS Data Hub
фиксирование canonical env surface
фиксирование module boundaries
фиксирование exact-version source of truth: package.json/lockfile/deployment manifests
```

Docs:

```text
docs/PROJECT.md или существующий canonical equivalent
docs/ARCHITECTURE.md
docs/DELIVERY_STATE.md
docs/SECURITY.md
docs/OPERATIONS.md
```

Если Starter уже использует другие source-of-truth документы, новые дубликаты не создаются — существующие документы синхронизируются.

### Acceptance

```text
starter builds cleanly
starter tests pass
no unrelated demo domain remains
source-of-truth docs describe actual code
```

---

## EPIC E01 — TENANCY / RLS / PERMISSIONS

### Goal

Доказать project isolation до появления production feed data.

### Tasks

```text
Organization model
Project model
Membership / roles
server-side project scope resolver
RLS classification
RLS policies for tenant-owned tables
Platform Admin bypass path
explicit audited cross-project operations
repository guards
authorization helpers
```

Minimum roles:

```text
PLATFORM_ADMIN
PROJECT_OPERATOR
READ_ONLY where actually needed
```

Tests:

```text
Project A reads A → allowed
Project A reads B → blocked
Project A mutates B → blocked
foreign relation insert → rejected
Platform Admin cross-project action → explicit + audited
```

### Acceptance

```text
No project-scoped repository can return foreign project rows in integration tests.
```

---

## EPIC E02 — STORAGE / SAFE OUTBOUND / SECRETS

### Goal

Создать единый безопасный слой внешних загрузок и object storage.

### Tasks

```text
S3 client abstraction
private per-project buckets/prefix strategy
project-scoped read-only snapshot access credentials/policy
immutable artifact naming
Safe Outbound HTTP client
protocol allowlist
private/localhost IP blocking
DNS/rebinding re-check where applicable
redirect target re-check
timeouts
max response bytes
content-type inspection
secret references
secret redaction in logs
credential rotation strategy
capability-secret feed endpoint references
raw source artifact retention/deletion policy
ACK project-token storage/rotation
```

Buckets/prefixes minimum:

```text
source-artifacts/
snapshots/
manifests/
media/
exports/
```

Tests:

```text
127.0.0.1 blocked
RFC1918/private target blocked
redirect to private target blocked
oversized response blocked
timeout finite
secret absent from logs
Project A credentials cannot read Project B snapshot prefix
expired raw artifacts are deleted according to policy
```

### Acceptance

```text
All future feed/media fetches go through the same Safe Outbound boundary.
```

---

## EPIC E03 — CONTRACTS / IDENTITY

### Goal

Зафиксировать stable internal/public identity и versioned contracts до бизнес-данных.

### Tasks

```text
internal cuid/ULID strategy
shared catalog uid strategy
publicUrlId strategy
publicUrlId reservation rules
contract package boundaries
schemaMajor / schemaMinor rules
Zod schemas
DTO whitelist pattern
canonical serialization helpers
```

Packages:

```text
@ams/data-contracts
@ams/realty-contracts
```

Required decisions:

```text
major incompatible
minor backward-compatible
public identity never reused
raw Prisma rows never public DTO
```

### Acceptance

```text
contract versioning tests exist
published public IDs cannot be reused
```

---

## EPIC E04 — DATA SAFETY GATE

### Goal

Не допустить production data до доказанного backup/restore contour.

### Tasks

```text
Managed PostgreSQL backup configured
S3 retention/versioning policy
restore runbook
restore drill
jobs freeze/unfreeze mechanism
identity reconcile after restore
CatalogExport proof
publicUrlId reservation reconcile
post-restore integrity checks
```

Evidence artifact:

```text
docs/runbooks/RESTORE.md
```

### Acceptance

```text
backup exists
restore drill passes
published identity reconcile passes
mutating jobs remain frozen until reconcile PASS
```

---

## EPIC E05 — PORTABILITY / EXIT CONTRACT FOUNDATION

### Goal

Заложить vendor independence до первого клиента, а не после него.

### Tasks

```text
ProjectExitBundleV1 schema skeleton
DATA_MODE=hub | local contract
transferable/vendored schema decision
handoff env contract
media transfer abstraction
no-Hub runtime assumptions documented
lead direct-mode contract documented
```

### Acceptance

```text
Lite architecture has a defined local-data execution path before commercial launch.
```

---

## EPIC E06 — SHARED GEO

### Goal

Создать минимальную shared factual geography model.

### Tasks

```text
Region
City
District
immutable uid
normalized names
aliases where needed
manual admin CRUD
provenance
soft lifecycle where applicable
```

### Acceptance

```text
One City can be referenced by multiple Projects without duplicating project editorial/SEO state.
```

---

## EPIC E07 — DEVELOPER / DEVELOPMENT / BUILDING

### Goal

Создать manual-first AMS Shared Catalog новостроек.

### Tasks

```text
Developer schema
Development schema
Building schema
city relations
aliases
status/lifecycle
manual Admin forms
shared media relation
source provenance
merge/relink commands
```

Guard:

```text
client XML data never auto-promotes to shared catalog
```

### Acceptance

```text
One Development can be subscribed by multiple Projects via same developmentUid.
```

---

## EPIC E08 — HISTORY / PROVENANCE / PRICES / SHARED MEDIA

### Goal

Сделать shared factual data объяснимыми и версионируемыми.

### Tasks

```text
FactProvenance
PriceObservation
CatalogChangeSet
CatalogEntityVersion
SharedMediaAsset
rights metadata
manual change audit
```

### Acceptance

```text
For material shared facts owner can see where value came from and when it changed.
```

---

## EPIC E09 — PROJECT CATALOG SUBSCRIPTION

### Goal

Подключать shared city catalog к Project без копирования global entities.

### Tasks

```text
ProjectCatalogSubscription
ALL_SHARED
CURATED
include/exclude selection
subscription audit
snapshot selection logic
```

### Acceptance

```text
Project A and B can consume same Development while retaining independent project presentation and URL state.
```

---

## EPIC E10 — PROJECT EDITORIAL

### Goal

Хранить dynamic entity editorial в project scope без превращения Hub в CMS всего сайта.

### Tasks

```text
EntityEditorial schema
shortDescription
operational presentation fields
agent bio support
media ordering relation subject to source order policy
long-form Development SEO content explicitly excluded by default and owned by Lite repository
project isolation
public mapper
```

Forbidden:

```text
global SEO strategy
site-wide Title templates
Content Gate policy
static About/Contacts pages
```

### Acceptance

```text
Editorial of Project A is never visible to Project B.
```

---

## EPIC E11 — PROJECT URL REGISTRY + LIFECYCLE

### Goal

Хранить persistent dynamic URL state, не забирая URL policy у сайта.

### Tasks

```text
ProjectUrlEntry
ProjectRedirect
publicUrlId binding
slug assignment state
slug lock after publish
redirect history
tombstones
lifecycle state
manual relink/retire operations
```

Tests:

```text
slug change creates 301 history
publicUrlId stable
retired identity not reused
foreign project URL mutation blocked
```

### Acceptance

```text
Hub stores state; Site still owns grammar/policy.
```

---

## EPIC E12 — SNAPSHOT COMPOSER

### Goal

Собирать immutable project-consumable artifact из shared + project state.

### Tasks

```text
Snapshot
SnapshotInput
SnapshotArtifact
manifest schema
publishSequence
schemaMajor/schemaMinor
dataset writers
stable serialization
sha256
Ed25519 signing
manifest keyId
signing-key secret-store boundary
public-key rotation/revocation support
referential integrity validation
privacy projection / forbidden-field scan
public location precision projection
```

Datasets baseline:

```text
geo
developers
developments
buildings
prices
media
inventory
agents
project/contacts
editorial
urls
redirects
lifecycle
```

### Acceptance

```text
Same approved inputs produce deterministic content hashes where deterministic fields apply.
```

---

## EPIC E13 — DELIVERY / ACK

### Goal

Доставлять snapshot без превращения webhook в data transport.

### Tasks

```text
immutable S3 artifacts
current manifest
webhook notification
poll fallback
client download
client verification
atomic apply
ACK endpoint with per-project auth + rotation
per-project storage read isolation proof
DeliveryRun state machine
stale detection
SUSPENDED read-access semantics for already-published artifacts
```

States:

```text
PENDING
NOTIFIED
DOWNLOADED
APPLIED
ACKNOWLEDGED
FAILED
STALE
```

### Acceptance

```text
Delivery OK only after client ACK of applied sequence.
```

---

## EPIC E14 — OPERATIONS UI

### Goal

Дать владельцу Hub operational visibility без SSH.

### Tasks

```text
fleet dashboard
project page
source health placeholder
snapshot state
delivery state
failed jobs
suspicious state
manual actions
history/audit links
```

Actions baseline:

```text
Build Snapshot
Publish Snapshot
View Delivery
Republish rollback content as new sequence
View Audit
```

### Acceptance

```text
Current project/snapshot/delivery state is visible from UI.
```

---

## EPIC E15 — REALTY LITE INTEGRATION PROOF

### Goal

Доказать Light contour до XML complexity.

### Tasks

```text
snapshot downloader
public key verification
manifest verification
schemaMajor verification
sha256 verification
Zod validation
referential integrity
persistent local directory
atomic activation
last-good retention
repository layer over snapshot
DATA_MODE=hub
```

Failure tests:

```text
Hub offline → pages render
S3 offline after apply → pages render
invalid snapshot → old snapshot stays active
replayed lower sequence → rejected
```

### Acceptance

```text
Lite rendering never requires live Hub DB/API request per page.
```

---

## EPIC E16 — EXIT BUNDLE PROOF

### Goal

Доказать реальную возможность ухода клиента до коммерческого масштабирования.

### Tasks

```text
ProjectExitBundleV1 full schema
export command
snapshot → local dataset conversion
media manifest export
client media migration mechanism
contracts vending/transfer
DATA_MODE=local
disable Hub sync
disable ACK/webhook
handoff env template
HANDOFF.md
DATA_SCHEMA.md
OPERATIONS.md
clean-build proof
no-AMS-runtime proof
```

Proof:

```text
fresh machine/container
+ repository
+ exit bundle
+ no Hub credentials
+ no AMS S3 credentials
→ install
→ build
→ start
→ catalog works
→ URLs/redirects work
→ media work
→ leads direct mode works
```

### Acceptance

```text
Client site works after complete disconnection from AMS Hub and AMS S3.
```

---

# 55. EPIC E17 — SOURCE REGISTRY V1

## Goal

Сделать Source самостоятельной operational boundary.

## Tasks

```text
Source schema
SourceCredentialRef relation
endpointCredentialRef for capability-secret feed URL
SourceSafetyPolicy relation
adapterKey / adapterVersion
profileKey / profileVersion
datasetType = MIXED_REALTY support
transportType = HTTPS_XML
sharingPolicy
schedulePolicy
enabled state
lastAttemptAt
lastSuccessAt
lastGoodRevisionId
expectedNamespace?
expectedProducer?
```

Admin/UI:

```text
Create Source
Edit Source config
Enable / Disable
Run manually
View last attempt
View last GOOD
View issues
View adapter/profile version
```

## Tests

```text
Source A cannot mutate Source B
Source A cannot mutate another Project
Disabled Source cannot auto-run
Manual authorized run works
Feed endpoint does not leak to logs/docs/UI history
Project A delivery credentials cannot read Project B artifacts
```

## Acceptance

```text
Bastion feed registered entirely by config.
No Bastion-specific code required in Source Registry.
```

---

# 56. EPIC E18 — ADAPTER REGISTRY + SOURCE PROFILE

## Goal

Разделить format parser и producer-specific mapping.

## Tasks

```text
AdapterDescriptor schema
Adapter registry
Profile registry
capability declarations
version compatibility check
profile → adapter compatibility check
unknown adapter fail-fast
unknown profile fail-fast
admin visibility
```

Required adapter:

```text
yrl-realty-2010
```

Required profile:

```text
vladis-vt24-v1
```

## Guard

Запрещён код:

```ts
if (projectId === 'bastion') {}
```

или:

```ts
if (clientSlug === 'bastion') {}
```

в parser/normalization core.

## Acceptance

```text
Same YRL adapter can be reused with another profile.
Profile can evolve independently with explicit version.
```

---

# 57. EPIC E19 — YRL 2010 PARSER FOUNDATION

## Goal

Сделать production-safe streaming parser YRL family.

## Tasks

```text
namespace-aware XML parsing
DTD disabled
external entities disabled
streaming offer iteration
bounded text accumulation
max artifact size
max offer count safety
max field length policies
UTF-8 handling
CDATA handling
XML entity decoding
raw attribute capture
source line/context where feasible
```

Parse:

```text
realty-feed
generation-date
offer[]
```

Offer parser должен сохранять:

```text
raw source identity
transaction fields
property fields
location fields
price fields
areas
building facts
lot facts
description
pictures
sales-agent subtree
location/apartment as private-only parsed field
is-image-order-change-allowed
all known typed fields
bounded sourceExtras for unmapped known-safe data
```

## Security tests

```text
XXE fixture blocked
billion laughs blocked
oversized text blocked
truncated XML → FAILED
invalid nesting → FAILED
redirect to private network → blocked before parse
```

## Acceptance

```text
Full Bastion feed parses in streaming mode without DOM loading whole document.
```

---

# 58. EPIC E20 — CANONICAL INVENTORY DOMAIN

## Goal

Привести разные offer categories к stable AMS domain model с privacy/sanitization boundary до public snapshot.

## Tasks

```text
InventoryEntity schema
InventorySourceIdentity
transaction enum
dealKind enum
property type enum
AddressValue
addressPublic
apartmentNumberPrivate internal-only
public location precision policy
GeoPoint
MoneyValue
MediaRef
description sanitizer
descriptionHtmlSafe
descriptionText
sourceObjectCode internal extraction
isImageOrderChangeAllowed
ApartmentFacts
RoomFacts
HouseFacts
HousePartFacts
LandFacts
CottageFacts
TownhouseFacts
GarageBoxFacts
```

Support Bastion observed categories:

```text
APARTMENT
ROOM
HOUSE
HOUSE_PART
LAND
COTTAGE
TOWNHOUSE
GARAGE_BOX
```

Observed producer fields mapped in profile/domain where applicable:

```text
deal-status
rooms-type
window-view
balcony
bathroom-unit
renovation
built-year
ceiling-height
heating-supply
room-furniture
parking-type
lot-type
video-review/online-show
disable-flat-plan-guess
```

## Description sanitizer

```text
allow: p br ul ol li strong em
remove: scripts, styles, links, attributes, unknown unsafe tags
raw HTML never public
```

## Unit/time normalization

```text
кв. м → m²
сотка → 100 m²
all domain timestamps → UTC
raw source offset → provenance
```

## Tests

```text
raw fixture → typed entity → Zod/domain PASS
location/apartment never appears in public DTO
XSS description sanitized
raw HTML absent from snapshot contract
recognized source object code extracted deterministically
unknown category → issue, no silent coercion
is-image-order-change-allowed=false preserves source media order
```

## Acceptance

```text
Public/client code no longer depends on raw YRL structure and cannot receive private apartment number/raw HTML.
```

---

# 59. EPIC E21 — INVENTORY IDENTITY + LIFECYCLE

## Goal

Обеспечить стабильность объекта между импортами.

## Tasks

```text
(projectId, sourceId, externalId) unique identity
uid generation
firstSeenAt
lastSeenAt
sourceCreatedAt?
sourceUpdatedAt?
ACTIVE / INACTIVE lifecycle
missing-good-run grace state
inactiveAfterMissingGoodRuns
inactiveAfterMissingHours
reactivation
lifecycle event audit
source hash
normalized hash
```

Inventory deactivation MUST NOT occur after one missing GOOD run.

Bastion bootstrap default:

```text
inactiveAfterMissingGoodRuns = 2
inactiveAfterMissingHours = 24
```

Eligibility for automatic transition to `INACTIVE` requires both configured grace gates to be satisfied when both are enabled:

```text
missingGoodRuns >= inactiveAfterMissingGoodRuns
AND
missingDuration >= inactiveAfterMissingHours
```

During grace:

```text
entity.status remains ACTIVE
public URL/uid remains unchanged
no lifecycle retirement/redirect event emitted
operations state may mark MISSING_GRACE internally
```

Run-1 baseline and suspicious source states never trigger destructive deactivation.

## Hash tasks

```text
rawArtifactHash
normalizedContentHash
record normalizedHash
stable canonical serialization
volatile-field exclusion policy
```

## Cadastral quality

```text
raw cadastral number
normalization
format validation
placeholder detection warning
never use as primary identity
```

## Tests

```text
same external id next run → same uid
price change → same uid updated
address correction → same uid updated
cadastral change → same uid updated + audit
missing in 1 complete GOOD run → remains ACTIVE / MISSING_GRACE, no lifecycle event
returns on next GOOD run within grace → same uid + same URL + ACTIVE, no deactivate/reactivate event
missing across configured run + time grace → inactive candidate
return after actual INACTIVE → reactivated
```

## Acceptance

```text
Feed edits do not create duplicate public entities.
```

---

# 60. EPIC E22 — AGENT DOMAIN

## Goal

Реализовать project-scoped Agent как отдельный domain.

## Tasks

```text
Agent schema
AgentExternalIdentity
AgentSourceEvidence
AgentMatchReview
AgentMergeEvent
field ownership
consent evidence + audited bulk confirmation
listingPresenceStatus
manual form
media relation
showOnSite
sortOrder
status
project isolation
public DTO mapper
```

## Acceptance

```text
Agent never leaks between Projects.
```

---

# 61. EPIC E23 — AGENT EXTRACTION + MATCHING

## Goal

Извлекать сотрудников из YRL offer, связывать inventory и не делать ложных выводов об увольнении.

## Tasks

```text
sales-agent subtree extraction
fullName extraction
phone extraction + E.164 normalization
photo URL extraction
category extraction
source evidence upsert
vladis phoneNorm baseline matching
sharedOfficePhone support
same-phone/different-name ambiguity detection
AgentMatchReview
listing.agentUid binding
manual assignment protection
listingPresenceStatus update
NO automatic DEPARTED from disappearance
```

Verified for `vladis-vt24-v1` audited sample:

```text
dedicated external agent ID not observed
email not observed
canonical baseline identity evidence = phoneNorm inside Project
```

Matching:

```text
1. dedicated upstream agent ID only for future profiles where verified
2. unambiguous phoneNorm within Project
3. email only where actually present/verified
4. ambiguous → review
```

Collision:

```text
same phoneNorm + different normalized fullName
→ review
→ no auto-merge
→ no auto-create duplicates from ambiguous evidence
```

Phone normalization:

```text
+7 959 fixture included
invalid/unsupported normalization
→ raw phone kept
→ WARNING
→ record not dropped solely for this reason
```

Lifecycle:

```text
no offers reference agent
→ NO_ACTIVE_LISTINGS
-X→ DEPARTED
```

## Tests

```text
same phone + same normalized name across many offers → one Agent
same phone + two different names → AgentMatchReview
shared office phone → no automatic identity match
same phone different Projects → different Agents
agent photo change → same Agent
missing photo does not hide Agent
manual fields survive import
manual Agent survives disappearance
listing binds agentUid when match safe
no listings → NO_ACTIVE_LISTINGS, status unchanged
```

## Acceptance

```text
Bastion listings resolve agents without shared-phone collisions or false departure transitions.
```

---

# 62. EPIC E24 — DATA QUALITY + SAFETY RULES

## Goal

Отделить плохую record от опасного Source-wide update.

## Tasks

```text
ImportIssue schema
severity model
record-level issue aggregation
source-level issue aggregation
critical issue classification
warning classification
invalid ratio
count delta
unknown category count
missing identity count
placeholder cadastral warning
sparse-field metrics
suspiciousTextPatterns metrics/flags
shared phone ambiguity metrics
private-field leak checks
```

Bastion initial safety policy MUST be calibrated from several real runs, not invented once.

Initial fields:

```text
minRecordCount
maxRecordCount
maxDropPercent
maxGrowthPercent
maxInvalidPercent
allowEmpty = false
deactivationEnabled
requireManualApprovalAboveDrop
inactiveAfterMissingGoodRuns
inactiveAfterMissingHours
sourceOverdueAfterHours
ackStaleAfterHours
```

## Bootstrap defaults before calibration

Before the first Bastion apply the policy cannot be empty. Conservative bootstrap values:

```text
allowEmpty = false
maxDropPercent = 20
requireManualApprovalAboveDrop = true
deactivationEnabled = false on baseline run
inactiveAfterMissingGoodRuns = 2
inactiveAfterMissingHours = 24
sourceOverdueAfterHours = 24
ackStaleAfterHours = 24
```

Fields such as `minRecordCount`, `maxRecordCount`, `maxGrowthPercent` and `maxInvalidPercent` MUST receive explicit project values from the dry-run/baseline evidence before automatic enforcement is enabled; they are not guessed in the standard.

After run 2–3, thresholds are reviewed against observed variance and changed only as an audited policy update.

## Baseline process

```text
Run 1 → observe only / no mass deactivation
Run 2 → compare
Run 3 → compare
Calibrate normal variance
Then enable automatic lifecycle deactivation
```

## Acceptance

```text
Truncated/empty/suspicious feed cannot wipe Bastion inventory.
```

---

# 63. EPIC E25 — MEDIA INTAKE + MIRROR

## Goal

Зеркалировать object images и agent photos безопасно и независимо от producer CDN.

## Tasks

```text
MediaSource
MediaAsset
LISTING_IMAGE
AGENT_PHOTO
Safe Outbound fetch
MIME validation
size validation
image decode validation
sha256 bytes
dedupe
S3 storage
source provenance
rights metadata
retry policy
failure metrics
```

Do not use source URL string as final media identity.

## Tests

```text
same bytes / different query string → one asset
404 image → warning not full import failure
HTML instead of image → rejected
oversized image → rejected
private-network redirect → rejected
agent photo updated → new media asset, same Agent
```

## Acceptance

```text
Snapshot does not depend on Vladis image host as required runtime origin.
```

---

# 64. EPIC E26 — VLADIS / VT24 SOURCE PROFILE

## Goal

Зафиксировать producer-specific rules Bastion pilot без загрязнения YRL adapter.

## Tasks

```text
profile descriptor vladis-vt24-v1
expected namespace
known category aliases
known transaction semantics
known deal-status semantics
unit aliases: кв. м / сотка
known media URL patterns
known agent photo pattern
known optional fields
known placeholder cadastral patterns
suspiciousTextPatterns
sourceObjectCode prefix extraction rule
sharedOfficePhone support
known producer quirks
full field mapping table
profile tests
```

Create doc:

```text
docs/sources/YRL_VLADIS_VT24_V1.md
```

Document contains:

```text
source URL pattern only, secret redacted
format family
namespace
offer identity field = offer@internal-id
identity stability status = requires run 2–3 proof
observed categories
observed type/category/deal-status values
agent fields
agent external ID = not observed in audited sample
agent email = not observed in audited sample
media fields
is-image-order-change-allowed behavior
private location/apartment handling
known sparse fields
known suspicious text patterns
sourceObjectCode cleanup rule
mapping table
unit alias table
timezone normalization rule
Bastion public location precision policy
coordinate generalization algorithm/version
SourceSafetyPolicy bootstrap values
fixture references
version history
```

## Acceptance

```text
All Bastion-specific knowledge is visible in one versioned profile/doc boundary without exposing secret feed URL.
```

---

# 65. EPIC E27 — BASTION FIXTURE CORPUS

## Goal

Сделать real-feed behavior воспроизводимым в tests.

## Tasks

Собрать sanitized fixtures для:

```text
sale apartment
rent apartment
house
land
room
house part
cottage
townhouse
garage/box
agent with photo
agent without photo
cadastral valid
cadastral absent
cadastral placeholder/suspicious
missing optional fields
multiple pictures
single picture
no picture if present in real data
CDATA description with allowed HTML
XSS/script/attribute description
suspicious AI-like text description
source object code prefix
location with apartment number
image-order-change-allowed=false
shared office phone with two names
+7 959 phone
one-run missing inventory + return
stable generalized coordinates across two snapshots
unicode/emoji description
```

Negative fixtures:

```text
truncated XML
malformed XML
XXE
oversized description
invalid numeric field
unknown category
missing external offer identity
```

## Privacy

Fixtures должны быть минимизированы и sanitized.

Не копировать весь production feed в repository.

## Acceptance

```text
Every supported normalized path has a deterministic fixture test.
```

---

# 66. EPIC E28 — BASTION END-TO-END IMPORT

## Goal

Провести первый полный pilot import до GOOD SourceRevision.

## Tasks

```text
register Bastion Project
register Bastion Source
configure adapter/profile
safe fetch
artifact inspection
stream parse
normalize all supported categories
agent extraction
identity resolution
quality analysis
staging
MutationPlan
dry-run report
owner review
apply
SourceRevision GOOD
```

## Dry Run report MUST show

```text
total offers
valid offers
invalid offers
warnings
counts by property type
counts by transaction type
new / updated / unchanged
candidate inactive
agents detected
agents matched
ambiguous agents
media references
cadastral warnings
unknown enum/category values
suspicious text warnings
shared-phone ambiguities
private apartment field count internal-only
image-order restriction count
```

## First production safety rule

Первый pilot apply не должен выполнять destructive mass deactivation на основании одного baseline run.

## Acceptance

```text
Real Bastion feed becomes reproducible GOOD revision in Hub.
```

---

# 67. EPIC E29 — BASTION SNAPSHOT CONTRACT

## Goal

Сформировать normalized public datasets без YRL leakage, private address leakage or raw HTML.

Datasets:

```text
inventory
agents
media
urls
redirects
lifecycle
manifest
```

Inventory DTO minimum:

```text
uid
publicUrlId
propertyType
transactionType
dealKind?
price
currency
addressPublic
geoPublic?
locationPrecision
facts
agentUid?
media[]
descriptionHtmlSafe?
descriptionText?
status
```

Never include:

```text
apartmentNumberPrivate
sourceAddressRaw
raw feed HTML
sourceObjectCode unless explicitly approved public later
sourceId
raw external ids unless explicitly public contract requires
feed endpoint / credentials refs
raw agent matching data
private source metadata
normalized phone identity helpers
consent evidence
raw import issues
```

Project contact publication rule:

```text
ProjectPublicContact
→ snapshot project/contacts
→ exactly one project fallback contact source of truth
```

Agent relation publication rule:

```text
agent consent/publication gate PASS
→ public agent relation allowed

otherwise
→ listing remains public
→ personal agent block/photo omitted
→ agency fallback contact
```

## Contract tests

```text
Zod schema
referential integrity
all public agentUid resolve or are null
ProjectPublicContact resolves for required fallback flows
all media refs resolve
no private fields
no apartment number field/value
no raw HTML
no feed URL/capability secret
safe description HTML only
public coordinates obey locationPrecision
stable ordering where required
sha256 manifest verification
```

## Acceptance

```text
Bastion Lite can render catalog without knowing YRL and without receiving private apartment number/raw feed HTML/feed endpoint.
```

---

# 68. EPIC E30 — BASTION REALTY LITE CONSUMER PROOF

## Goal

Доказать реальную полезность Hub на клиентском сайте.

## Tasks

```text
DATA_MODE=hub
snapshot downloader
signature validation
schema validation
atomic local apply
last-good retention
inventory repository adapter
agent repository adapter
media rendering
category routing integration
ProjectPublicContact repository/DTO from snapshot project/contacts for fallback
public location precision rendering
safe description HTML/text rendering only
```

Pages/flows to verify:

```text
apartment listing
house listing
land listing
room listing
house-part listing
rent apartment
agent page
agent inventory filter
image gallery
```

SEO stays Site-owned.

## Failure tests

```text
Hub unavailable → site works
S3 unavailable after local apply → site works
bad snapshot → old snapshot remains
new unknown schemaMajor → reject, keep old
agent absent/unpublished → ProjectPublicContact fallback
private apartment number absent from local snapshot
raw HTML absent from rendering path
```

## Acceptance

```text
Bastion production rendering is independent from live XML and live Hub requests.
```

---

# 69. EPIC E31 — BASTION OPERATIONS + ALERTING

## Goal

Управлять pilot без SSH.

Dashboard:

```text
source health
last fetch
last GOOD
current offer count
counts by category
agent count
unknown/invalid count
media failures
suspicious text count
agent shared-phone ambiguities
consent readiness
snapshot sequence
client ACK
```

Alerts:

```text
source overdue
fetch failed
parse failed
suspicious count drop
invalid ratio exceeded
unknown category detected
mass agent disappearance
snapshot failed
client ACK stale
media failure spike
suspicious text pattern detected
shared office phone ambiguity detected
consent not ready before production launch
```

## Acceptance

```text
Owner understands Bastion data state from Hub UI + alerts.
```

---

# 70. EPIC E32 — BASTION PILOT RELEASE GATE

Pilot is production-ready only after all required proofs pass.

## Data proof

```text
full feed fetched via secret endpoint ref
all supported categories parsed
no unknown material category remains
GOOD revision produced
offer@internal-id present and used
run 2–3 prove identity stability or stop/review
changed offer updates same entity
one-run missing object remains ACTIVE within grace
one-run missing + return preserves uid/URL/status and emits no lifecycle event
configured deactivation grace tested
removed offer lifecycle tested safely after grace
reactivation tested
```

## Privacy / content proof

```text
location/apartment parsed internal-only
snapshot contains no apartment number
raw feed HTML never public
XSS fixture sanitized
suspicious text produces warning/Operations flag
recognized source object code handled deterministically
Bastion precision policy per propertyType approved
public location precision enforced
coordinate generalization is deterministic across consecutive snapshots
```

## Agent proof

```text
agent extraction works
no dedicated agent ID assumed for vladis-vt24-v1
phoneNorm matching deterministic when unambiguous
same phone + different names → review
shared office phone does not auto-merge
no listings → NO_ACTIVE_LISTINGS, not DEPARTED
manual field ownership works
private fields absent from snapshot
consent/publication evidence collected before launch
unapproved agent block/photo hidden while listing uses ProjectPublicContact fallback
ProjectPublicContact present in snapshot project/contacts
```

## Media proof

```text
is-image-order-change-allowed=false preserves feed order
manual protected reorder disabled
individual media failure does not fail whole import
```

## Safety proof

```text
truncated feed cannot wipe data
empty feed cannot wipe data
mass drop creates SUSPICIOUS
XXE blocked
private network outbound blocked
raw artifact retention configured
SourceSafetyPolicy values filled
bootstrap maxDropPercent = 20 and manual approval above drop enabled
sourceOverdueAfterHours = 24
ackStaleAfterHours = 24
inventory missing-run/time grace configured
```

## Delivery isolation proof

```text
Project A read credentials cannot read Project B prefix
ACK requires project-scoped auth
ACK token rotation tested
feed endpoint absent from logs/docs/public artifacts
```

## Snapshot proof

```text
signed immutable artifact
Lite validates
Lite atomic apply
ACK received
bad snapshot rejected
manifest keyId validated
snapshot signed by revoked keyId rejected; last-good untouched
planned current→next key overlap/rotation tested
```

## Runtime independence proof

```text
Hub OFF
S3 OFF after apply
→ Bastion Lite still renders current catalog
```

## Portability proof

```text
Exit Bundle generated
DATA_MODE=local
no AMS Hub credentials
no AMS S3 runtime dependency
site starts and renders
```

## Final gate

```text
ALL REQUIRED PROOFS PASS
→ BASTION PILOT PRODUCTION READY
```

---

# 71. EPIC E33 — SECOND REAL FEED AUDIT

После Bastion пользователь предоставляет второй реальный feed.

Задача не «подогнать Hub», а классифицировать отличие.

Decision tree:

```text
same YRL family
+ same semantics
→ reuse adapter
→ maybe reuse profile

same YRL family
+ producer quirks differ
→ reuse adapter
→ new SourceProfile

materially different XML format
→ new reusable SourceAdapter

same project has both feeds
→ two independent Sources
→ independent Last Good revisions
→ one Project Snapshot composition
```

## Acceptance

```text
No client-specific branches added to core.
```

---

# 72. EPIC E34 — ADAPTER REUSE / NEW ADAPTER DECISION

Required ADR-like result for second feed:

```text
FORMAT_SAME_PROFILE_SAME
FORMAT_SAME_PROFILE_NEW
FORMAT_NEW_ADAPTER_REQUIRED
```

Decision evidence:

```text
root/namespace
identity model
record boundary
category semantics
agent model
media model
lifecycle semantics
transaction semantics
```

---

# 73. EPIC E35 — CROSS-FEED CONTRACT COMPATIBILITY

Regardless of upstream format:

```text
APARTMENT from Feed A
APARTMENT from Feed B
```

должны приходить к совместимому normalized/public DTO.

Tests:

```text
same frontend repository contract
same URL policy integration
same SEO layer expectations
same media contract
same AgentPublicV1
```

---

# 74. EPIC E36 — MULTI-SOURCE PROJECT COMPOSITION PROOF

Если Bastion или будущий Project получит второй feed:

```text
Source A GOOD revision 10
Source B GOOD revision 4
Source C SUSPICIOUS revision 8
```

Snapshot composition должен использовать policy-approved inputs:

```text
A=10
B=4
C=previous GOOD 7
```

Tasks:

```text
SnapshotInput provenance
required/optional Source policy
per-source freshness
composition conflict rules
entity namespace collision rules
agent cross-source matching inside Project
```

Acceptance:

```text
One broken Source does not erase independent GOOD data.
```

---

# 75. PROJECT SERVICE LIFECYCLE / SUSPENSION

Commercial pricing belongs outside this technical master plan.

Technical project service states include:

```text
ACTIVE
SUSPENDED
TERMINATING / EXIT_PREP where operationally needed
CLOSED after retention/exit obligations are complete
```

`SUSPENDED` may be used for non-payment or administrative suspension.

Hard rule:

```text
SUSPENDED
→ stop scheduled ingestion
→ stop new snapshot publication/delivery
→ retain current project data according to retention policy
→ keep READ access to already-published current manifest/artifacts for that Project
→ do not delete/revoke the last published artifact solely because of suspension
→ do not delete current last-good
→ client site keeps rendering its already applied last-good snapshot
→ clean rebuild/restart may re-fetch the already-published authorized snapshot
→ Lite treats "no new snapshot" as normal stale-but-valid state, not a user-facing error
```

Breaking the client website or deleting its current dataset as a pressure mechanism is forbidden.

Resume:

```text
SUSPENDED → ACTIVE
→ normal ingestion resumes
→ next successful publish uses higher publishSequence
```

Post-termination Hub retention period is an Open Question until commercial/legal policy is approved.

---

# 76. WHAT NOT TO BUILD

```text
microservices
Kafka
RabbitMQ
Redis queue
Kubernetes

central client CMS
central SEO engine
central page builder

shared client PostgreSQL
Payload multi-tenancy

universal parser DSL
visual XML mapper

mandatory XLSX
API ingestion without trigger

AI auto-merge Agents
AI auto-edit factual data

Lead Hub inside Data Hub
```

---

# 77. ACCEPTANCE — BUSINESS ARCHITECTURE

Архитектура считается доказанной, если:

```text
1. Один город ведётся AMS один раз.

2. Несколько независимых агентств получают
   shared factual catalog.

3. Их project data полностью изолированы.

4. XML клиента импортируется только в его Project.

5. Один Project поддерживает несколько XML Sources.

6. Broken XML не уничтожает Last Good.

7. Agents импортируются и корректно matching между
   источниками одного Project.

8. Agent никогда не shared между агентствами.

9. REALTY LITE не имеет БД/CMS/Admin.

10. Lite не обращается к Hub на каждый page request.

11. Hub outage не ломает Lite.

12. S3 outage не ломает уже применённый Lite.

13. SEO architecture принадлежит сайту.

14. URL grammar принадлежит сайту.

15. Hub хранит persistent project URL state.

16. Snapshot содержит всё необходимое для rendering.

17. Final public DTO не содержит private data.

18. Client может уйти из AMS.

19. После handoff сайт запускается без AMS Hub.

20. После handoff сайт не требует AMS S3.

21. После handoff сайт может принимать лиды напрямую.

22. Для продолжения автоматического XML updating
    новый подрядчик может заменить upstream ingestion,
    не переписывая frontend.

23. SUSPENDED не ломает уже работающий Lite last-good и не отзывает read-доступ к уже опубликованному current manifest/artifacts.

24. Feed capability secret не попадает в docs/logs/public artifacts.

25. Project delivery credentials физически изолируют snapshots разных Projects.
```

---

# 77A. ACCEPTANCE — BASTION PILOT SPECIFIC

Bastion считается доказанным первым production Source, если:

```text
1. Source зарегистрирован configuration-only; endpoint secret referenced, not embedded.
2. Parser = reusable YrlRealty2010Adapter.
3. Bastion-specific behavior = vladis-vt24-v1 SourceProfile.
4. One Source correctly emits multiple property types.
5. SALE/RENT and dealKind semantics are separate.
6. APARTMENT/HOUSE/LAND/ROOM/HOUSE_PART/COTTAGE/TOWNHOUSE/GARAGE_BOX normalize.
7. Unknown future category is not silently coerced.
8. offer@internal-id is used as externalOfferId; stability is proved on repeated runs.
9. Cadastral number is never primary identity.
10. Suspected cadastral placeholders create quality issue.
11. rawArtifactHash and normalizedContentHash are separate.
12. Volatile generation metadata does not create false meaningful update.
13. Apartment number is internal-only and absent from public snapshot/Exit public data.
14. Feed description is sanitized; raw HTML/XSS never reaches Lite.
15. Suspicious source text creates warning without AI auto-edit.
16. sourceObjectCode prefix is handled deterministically and retained internally/provenance.
17. Agent is extracted from offer.
18. Dedicated agent external ID is not assumed for vladis-vt24-v1.
19. phoneNorm matches only when unambiguous.
20. Same phone with different names creates AgentMatchReview.
21. Shared office phone can be excluded from identity matching.
22. No active listings sets NO_ACTIVE_LISTINGS and never auto-DEPARTED.
23. Agent photo is not identity and is not public without authorization gate.
24. Listing remains public without agent authorization, with agency contact fallback.
25. Consent/publication evidence is ready before production launch.
26. is-image-order-change-allowed=false preserves source image order.
27. Unit aliases and timestamps normalize deterministically with provenance.
28. Media mirror single failures do not fail entire import.
29. Bad/truncated feed never replaces Last Good.
30. First baseline import performs no destructive mass deactivation.
31. Dry Run shows diff and privacy/quality warnings before first apply.
32. Snapshot uses unified inventory dataset and contains no raw YRL structure.
33. Snapshot contains no feed endpoint/capability secret.
34. Project A delivery credentials cannot read Project B snapshot prefix.
35. ACK is project-authenticated and rotatable.
36. Lite works on local last-good during Hub outage.
37. Operations UI shows source health, suspicious text and matching/consent issues.
38. Exit Bundle contains transferable project state according to exit rights boundary.
39. DATA_MODE=local works without AMS Hub/S3 runtime dependencies.
40. Full AMS disconnection does not break handed-off site.
```

---

# 77B. VERIFIED / HYPOTHESIS / REQUIRES CHECK

## VERIFIED IN 2026-10-02 RAW AUDIT / DOCUMENT EVIDENCE

```text
YRL namespace family
mixed residential categories
sale + rent presence
offer@internal-id present
location/apartment present
CDATA description can contain HTML
object photos
is-image-order-change-allowed=false observed
agent full names
agent phones
agent photos for part of agents
agent category=agency
dedicated agent external ID not observed in audited sample
agent email not observed in audited sample
coordinates
price/currency
rich descriptions
category-specific sparse fields
mixed RU/EN producer vocabulary
additional fields listed in §16.5
multiple timestamp offsets observed
```

## IMPLEMENTATION DECISIONS

```text
YrlRealty2010Adapter as reusable adapter
vladis-vt24-v1 as profile
canonical typed InventoryEntity
semantic normalized hash
private/public address split
safe description sanitizer + text projection
phoneNorm baseline matching with ambiguity/shared-office guards
listingPresenceStatus separated from employment status
unified inventory snapshot dataset
site-owned long-form Development SEO content by default
per-project delivery storage credentials + ACK auth
```

## REQUIRES CHECK DURING E28 RUN 2–3 / IMPLEMENTATION

```text
stability of offer@internal-id across repeated feed revisions
full coverage of exact category/property-type/deal-status combinations
full coverage of optional tags in future source revisions
actual list of shared office phones if any
suspiciousTextPatterns false-positive calibration
sourceObjectCode prefix coverage
safety thresholds after several real runs
post-termination Hub retention period
```

Do not hardcode future producer assumptions beyond verified profile fixtures.

---

# 78. FINAL ARCHITECTURE

```text
                    AMS DATA HUB

        ┌───────────────────────────────────┐
        │                                   │
        │        SHARED CITY CATALOG        │
        │                                   │
        │ Region / City / District          │
        │ Developer / Development           │
        │ Building / Prices / Media         │
        │                                   │
        └─────────────────┬─────────────────┘
                          │
                     subscriptions
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼

          Project A    Project B    Project C
             │
             │
             ├── XML Source 1
             ├── XML Source 2
             ├── Agents
             ├── Project Facts
             ├── Editorial
             ├── URL Registry
             └── Lifecycle
                    │
                    ▼
             Snapshot Composer
                    │
                    ▼
          signed immutable snapshot
                    │
                    ▼
                  S3
                    │
                    ▼
             REALTY LITE SITE

      ┌─────────────────────────────────┐
      │ Next.js                         │
      │ no DB                           │
      │ no CMS                          │
      │ no Admin                        │
      │ local last-good snapshot        │
      │ SEO + rendering                 │
      │ static content                  │
      │ LeadSink                        │
      └─────────────────────────────────┘

                    │
              client leaves
                    │
                    ▼

           ProjectExitBundleV1
                    +
             client media copy
                    +
              DATA_MODE=local
                    │
                    ▼
          independent client site
```

---

# 79. FINAL OWNERSHIP FORMULA

```text
SHARED FACTS
→ Hub

CLIENT XML FACTS
→ Hub / Project scope

AGENTS
→ Hub / Project scope

DYNAMIC ENTITY EDITORIAL
→ Hub / Project scope

PERSISTENT ENTITY URL STATE
→ Hub / Project scope

URL GRAMMAR
→ Site

SEO STRATEGY
→ Site

INDEXABILITY
→ Site

CANONICAL / SITEMAP / ROBOTS
→ Site

STATIC CONTENT
→ Site repository

UI
→ Site repository

LEADS
→ Site LeadSink / future Lead Hub

CLIENT EXIT COPY
→ must work without Hub
```

---

# 80. FINAL DECISION

AMS Data Hub не является обязательным runtime backend сайта.

Он является:

```text
data ingestion
+
shared factual catalog
+
project data operations
+
persistent dynamic state
+
snapshot producer
```

REALTY LITE является самостоятельным клиентским приложением.

Нормальная работа:

```text
Hub
→ signed snapshot
→ Lite local last-good
```

При прекращении сотрудничества:

```text
Hub
→ final Exit Bundle
→ DATA_MODE=local
→ independent site
```

Это обеспечивает одновременно:

```text
централизованную работу AMS
минимальную инфраструктуру клиента
устойчивость к сбоям Hub
отсутствие общей клиентской БД
изоляцию клиентов
SEO ownership сайта
и реальную возможность handoff.
```

---

# 81. IMPLEMENTATION START

Start with foundation:

```text
E00 Starter normalization
→ E01 Tenancy / RLS
→ E02 Storage / Safe Outbound / Secrets
→ E03 Contracts / Identity
→ E04 Data Safety Gate
→ E05 Portability Foundation
→ E06 Shared Geo
```

For Bastion fast path, then prove Lite delivery contour without waiting for shared Development catalog:

```text
E10 Project Editorial
→ E11 URL Registry + Lifecycle
→ E12 Snapshot Composer
→ E13 Delivery / ACK
→ E15 REALTY LITE proof
→ E16 Exit Bundle proof
```

Then immediately:

```text
E17 Source Registry
→ E18 Adapter/Profile Registry
→ E19 YRL Parser
→ E20 Canonical Inventory + privacy/sanitization
→ E21 Identity/Lifecycle
→ E22 Agent Domain
→ E23 Agent Extraction/Matching
→ E24 Data Quality/Safety
→ E25 Media
→ E26 Vladis Profile
→ E27 Fixtures
→ E28 Bastion End-to-End
→ E29 Snapshot
→ E30 Bastion Lite Proof
→ E31 Operations
→ E32 Pilot Release Gate
```

Shared Development Catalog work:

```text
E07 → E08 → E09
```

runs in parallel or immediately after Bastion unless another active project requires it earlier.

After PASS Bastion:

```text
E33 second feed audit
→ E34 reuse/new-adapter decision
→ E35 normalized contract compatibility
→ E36 multi-source composition proof
```

---

# 82. CHANGELOG — v3.1.2

```text
PATCH / no architecture change

Bastion release blockers:
- ProjectPublicContact is the single Hub-owned agency fallback source
- snapshot project/contacts dataset added
- one missing GOOD run no longer deactivates inventory
- default inventory grace = 2 missing GOOD runs + 24 hours
- Bastion location precision policy fixed before E32
- public coordinate generalization deterministic per entity/policy
- bootstrap safety thresholds filled before calibration

Snapshot security:
- manifest keyId added
- Lite trust set supports current + next public keys
- planned overlap rotation defined
- emergency key revocation/republish defined
- revoked keyId snapshot rejected with last-good preserved
- private signing key restricted to secret store

Service lifecycle:
- SUSPENDED retains read access to already-published project artifacts
- no-new-snapshot state is non-error for public Lite UX

Agent/exit consistency:
- public Exit Bundle exports AgentPublicV1 only
- consent evidence moves only through separate protected operational handoff
- NO_ACTIVE_LISTINGS never redirects Agent page

Document quality:
- duplicate #17 and #54A headings removed
- Open Questions converted to owner/deadline/status register
- OQ-09 added for Hub Admin 2FA post-pilot decision
```

---

# 83. OPEN QUESTIONS / DECISION REGISTER

| ID | Question / decision | Owner | Close by | Status in v3.1.2 |
|---|---|---|---|---|
| OQ-01 | Post-termination Hub retention period for Project data/raw artifacts beyond active policy. | AMS owner + legal/commercial | Before first commercial contract | OPEN |
| OQ-02 | Exact commercial/legal license language for frozen AMS_SHARED copy in Exit Bundle. | AMS owner + legal/commercial | Before first commercial contract | OPEN |
| OQ-03 | Bastion public location precision by inventory class. | AMS owner / project architect | Before E32 | **CLOSED in v3.1.2:** APARTMENT/ROOM=STREET; other current Bastion classes=STREET by default, DISTRICT only explicit override; EXACT off without separate decision. |
| OQ-04 | Actual shared office phone list/patterns for Bastion after operations review. | AMS owner / Bastion operator | Before E32 | OPEN |
| OQ-05 | Suspicious text pattern set and false-positive thresholds after fixture/live calibration. | AMS owner / data operations | After run 2–3 calibration | OPEN |
| OQ-06 | Whether a future producer field provides reliable explicit employee-departure signal. | Data architecture | Before enabling any automatic departure rule | OPEN; no auto-DEPARTED meanwhile |
| OQ-07 | Whether a future project needs Hub-managed long-form Development editorial; default remains Lite repository. | Project architect | On first real trigger | OPEN / trigger-based |
| OQ-08 | Exact lead-form retention period and legal basis per client/operator policy. | Client/operator + AMS legal/security | Before lead forms go live | OPEN |
| OQ-09 | Require 2FA for Hub Admin. Pilot baseline does not add it automatically; reassess after pilot as owner decision. | AMS owner / security | Post-pilot review, before broader commercial scale | DEFERRED |

Open questions do not weaken current hard invariants. A question marked OPEN cannot bypass the release gate when its `Close by` milestone has arrived. Any answer that changes contracts requires an explicit versioned decision/ADR.

---

**Architecture status:** FINAL / READY FOR CODEX / BASTION PILOT READY  
**Primary client profile:** REALTY LITE  
**Hub runtime dependency:** FORBIDDEN  
**External automated ingestion V1:** XML / YRL ONLY  
**Canonical pilot adapter:** `yrl-realty-2010`  
**Canonical pilot profile:** `vladis-vt24-v1`  
**Canonical pilot project:** BASTION  
**Mixed-category Source:** REQUIRED  
**Shared catalog:** MANUAL-FIRST  
**Agent scope:** PROJECT ONLY  
**Client database:** NONE FOR LITE  
**SEO ownership:** SITE  
**URL grammar ownership:** SITE  
**Persistent dynamic URL state:** HUB PROJECT SCOPE  
**Snapshot:** SIGNED / IMMUTABLE / LAST-GOOD / PRIVACY-PROJECTED / KEY-ID ROTATABLE  
**Client exit:** ProjectExitBundleV1 REQUIRED  
**Media exit:** CLIENT-CONTROLLED COPY REQUIRED  
**XLSX:** OPTIONAL / TRIGGER-BASED  
**Payload:** FULL CLIENT ONLY  
**Feed endpoint:** SECRET CONFIG / CREDENTIAL REF ONLY  
**Agent listing absence:** NO_ACTIVE_LISTINGS, NEVER AUTO-DEPARTED  
**Agency fallback:** ProjectPublicContact / HUB PROJECT SCOPE / SNAPSHOT project/contacts  
**Inventory dataset:** UNIFIED / MISSING-GRACE PROTECTED  
**SourceCraft:** canonical Git / CI contour
