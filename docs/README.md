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
| Утверждённая программа реализации | `AMS Data Hub Master Plan v1.md` и `AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json` |

Утверждённый план остаётся на exact-пути, к которому привязаны inventory,
Beads и execution ledger. Он не заменяет продуктовый backlog.

## Самостоятельные расширения

| Файл | Роль |
| --- | --- |
| `00_CONSTITUTION.MD.md` | утверждённый архитектурный input v3.1.2 без смысловой переработки |
| `DATA_MODEL.md` | подробная карта schema и migration policy |
| `SECURITY.md` | trust boundaries, ПДн, auth, tenant isolation и secrets |
| `ENVIRONMENT.md` | реестр переменных окружения без значений |
| `OPERATIONS.md` | local runtime, deploy, rollback, backup/restore и incident recovery |
| `DELIVERY_STATE.yaml` | machine-readable pointers на фактические delivery и restore proofs |
| `DH-00_CANON_MAPPING.md` | доказательство нормализации и переноса legacy-документов |

[`docs/adr/README.md`](adr/README.md) фиксирует стабильные IDs и статус
труднообратимых решений. Каталог
[`docs/contracts/SNAPSHOT_V1.md`](contracts/SNAPSHOT_V1.md) фиксирует contract
эталонного snapshot-потребителя. Остальные contracts создаются только вместе
с реальным Exit Bundle. Mutable epic/PR/SHA evidence хранится в Beads ledger;
`DELIVERY_STATE.yaml` содержит только machine-readable proof pointers.
