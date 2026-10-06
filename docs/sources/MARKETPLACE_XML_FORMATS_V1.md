# Marketplace XML Formats v1

Status: IMPLEMENTED, BOOTSTRAP CALIBRATION

Owner approval: 2026-10-06, remediation MP-00.2. YRL/Vladis, Domclick XML,
Avito v3 and CIAN v2 are allowed production adapter/profile families.
Family approval does not imply enabled production execution or completed
calibration. Producer semantics belong to `SourceProfile`, format parsing to
`SourceAdapter`; project-specific branching inside parser core is forbidden.
The real SourceExecutionService, source worker and scheduler composition remain
MP-03/MP-04 work, not evidence supplied by this document.

## Решение

AMS Data Hub принимает четыре внешних профиля через отдельные форматные
контракты и приводит записи к одному `CanonicalFeedDraft`. Ключ объекта всегда
составной: `Source ID + external ID`. Одинаковый внешний ID в двух источниках не
склеивается автоматически.

| Профиль | Адаптер | Сигнатура | Внешний ID |
| --- | --- | --- | --- |
| `joywork-yandex-realty-v1` | `yrl-realty-2010@1.0.0` | `realty-feed`, namespace YRL 2010, `offer` | `offer@internal-id` |
| `joywork-domclick-v1` | `yrl-realty-2010@1.0.0` | `realty-feed`, namespace YRL 2010, `offer` | `offer@internal-id` |
| `joywork-avito-v3` | `avito-xml-v3@1.0.0` | `Ads formatVersion="3" target="Avito.ru"`, `Ad` | `Ad/Id` |
| `joywork-cian-v2` | `cian-xml-v2@1.0.0` | `Feed`, `Feed_Version=2`, `Object`; регистр тегов незначим | `Object/ExternalId` |

Домклик — отдельный профиль источника, но его проверенный живой endpoint
использует семейство YRL. Поэтому профиль повторно использует защищённый YRL
parser, а не копирует его. Это сохраняет отдельную provenance-метку
`DOMCLICK_YRL` и не создаёт два расходящихся XML-разборщика.

## Общий знаменатель

Адаптеры выдают одинаковые поля: `externalId`, `propertyType`,
`transactionType`, исходные category/operation, title, description, address,
price/currency, area, coordinates, phones, image URLs и raw field provenance.
Неизвестная категория или операция не угадывается: создаётся issue, а значение
остаётся `OTHER`/`UNKNOWN` до явного profile mapping. Некорректное число также
становится issue.

Контакты сохраняются только как значения конкретной записи. Общий телефон не
подставляется. Raw XML, endpoint и реальные контакты не входят в Git.

## Безопасность и эксплуатация

- DTD/XXE запрещены; XML malformed, неверный root/version и превышение лимитов
  завершают import ошибкой.
- Empty feed синтаксически допустим для проверки канала, но bootstrap profiles
  не разрешают destructive reconciliation/deactivation.
- Автоматическая загрузка и расписание не включены. Сначала нужны 2–3
  непустых тестовых прогона каждого профиля и подтверждение enum mappings.
- Локальный bounded audit запускается через `pnpm audit:marketplace-feeds`.
  URL передаются только process-local переменными `FEED_AUDIT_*_URL`; отчёт не
  печатает endpoint, объявления или PII. Сетевой доступ проходит через общий
  Safe Outbound с повторной DNS-проверкой, запретом приватных адресов, нулём
  redirect и лимитом 32 MiB.

## Основание форматов

- Yandex Realty: официальный YRL contract — UTF-8, `realty-feed`, `offer`,
  namespace `http://webmaster.yandex.ru/schemas/feed/realty/2010-06`.
- CIAN: официальная XML v2 документация — `Feed`, `Feed_Version`, `Object`,
  UTF-8 или Windows-1251, регистр тегов незначим.
- Avito v3: live root signature подтверждена; field mapping остаётся bootstrap
  до непустого образца и сверки со спецификацией кабинета партнёра.
- Домклик: live root/namespace подтверждают YRL-совместимую структуру. Детальные
  обязательные поля требуют непустого фида или документации партнёрского
  кабинета.

## Acceptance

Контрактные тесты покрывают valid, empty, malformed, DTD/XXE, неверную версию,
unknown enums, invalid number, duplicate external ID, одинаковый ID в разных
источниках и каноническое равенство полей четырёх профилей.
