# Документы AMS Data Hub

## Канонические документы

| Вопрос | Source of Truth |
| --- | --- |
| Что и для кого строим | `01_PRD.md` |
| Экраны, маршруты и пользовательские сценарии | `02_PRODUCT_STRUCTURE.md` |
| Архитектура, модули, данные, безопасность и delivery profile | `03_ARCHITECTURE.md` и действующие ADR |
| Текущий продуктовый backlog | `04_BACKLOG.md` |
| Готовность к выпуску, handover и rollback | `05_RELEASE_CHECKLIST.md` |
| Визуальные правила публичной и приватной поверхности | `06_DESIGN_SYSTEM.md` |
| Активная программа доработок и production readiness | [`AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.md`](../AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.md) и `AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.inventory.json` |
| Завершённая программа реализации v4 | `AMS Data Hub Master Plan v1.md` и `AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json` |

Утверждённый план остаётся на exact-пути, к которому привязаны inventory,
Beads и execution ledger. Он не заменяет продуктовый backlog.
Exact v4 — неизменяемый approval artifact с исходным SHA-256; execution graph
завершён (82/82). Текущие статусы и дополнительные работы после v4 принадлежат
`04_BACKLOG.md`, `DELIVERY_STATE.yaml` и Task Manager, а не тексту approval handoff.

Новый approved remediation plan от 2026-10-06 — активный execution source.
Он не переоткрывает исторические задачи v4. MP-00 согласовал owner decisions;
MP-01 удалил текущий TOTP contour с password/session regressions и новой
forward migration. MP-02–MP-07 доставлены; delivery evidence хранится
в Task Manager. Operations и production readiness требуют
оставшихся MP-08–MP-10;
закрытый v4 не является доказательством этих результатов.
До отдельной release-команды владельца разрешены только доработки и
non-production проверки, не production rollout.

## Самостоятельные расширения

| Файл | Роль |
| --- | --- |
| `00_CONSTITUTION.MD.md` | архитектурный input v3.1.2 с явными owner amendments от 2026-10-06: текущая TOTP policy, feed families и manual newbuilding capability |
| `DATA_MODEL.md` | подробная карта schema и migration policy |
| `SECURITY.md` | trust boundaries, ПДн, auth, tenant isolation и secrets |
| `ENVIRONMENT.md` | реестр переменных окружения без значений |
| `OPERATIONS.md` | local runtime, deploy, rollback, backup/restore и incident recovery |
| `DELIVERY_STATE.yaml` | machine-readable pointers на фактические delivery и restore proofs |
| `AMS_DATA_HUB_REMEDIATION_ARCHITECT_HANDOFF_V1.md` | граф нового remediation plan, архитектурные зависимости, 30 DoD и границы доказательств |
| `DH-00_CANON_MAPPING.md` | доказательство нормализации и переноса legacy-документов |
| `research/VLADIS_VT24_CALIBRATION_2026-10-05.md` | обезличенное evidence трёх реальных тестовых прогонов профиля Vladis/VT24 и калиброванная safety policy |
| `research/NEWBUILDING_AGGREGATOR_PILOT_2026-10-05.md` | обезличенное evidence пилота пяти карточек новостроек, 25 media files и gap matrix shared-каталога |
| `research/TIMEWEB_S3_ISOLATION_PROOF_2026-10-05.md` | secret-free evidence реального non-production provider proof: A→B denied, B→B pass и полный cleanup |
| `sources/MARKETPLACE_XML_FORMATS_V1.md` | контракты Yandex Realty, Домклик, Avito v3 и CIAN v2, общий canonical draft и bootstrap safety |
| `research/JOYWORK_MARKETPLACE_FEEDS_2026-10-05.md` | обезличенное evidence структурной проверки четырёх тестовых XML-фидов |

[`docs/adr/README.md`](adr/README.md) фиксирует стабильные IDs и статус
труднообратимых решений. Каталог
[`docs/contracts/SNAPSHOT_V1.md`](contracts/SNAPSHOT_V1.md) фиксирует contract
эталонного snapshot-потребителя, а
[`PROJECT_EXIT_BUNDLE_V1.md`](contracts/PROJECT_EXIT_BUNDLE_V1.md) — typed
handoff contract. Exit Bundle exporter реализован в `operations-control`;
реальная передача остаётся отдельной owner/legal operation. Mutable epic/PR/SHA evidence хранится в Beads ledger;
`DELIVERY_STATE.yaml` содержит только machine-readable proof pointers.
