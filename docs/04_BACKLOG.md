# Backlog — AMS Data Hub

**Статус:** Active
**Execution source:** `AMS-DATA-HUB-IMPLEMENTATION-2026-01 v1 APPROVED`, его
inventory и Beads graph. Этот файл — продуктовая сводка, не второй task graph.

## NOW

- W0: завершить канон, удалить template traces, сузить публичную поверхность и
  зафиксировать module boundaries.
- W1: доступ/тенанты/RLS и платформенные safety services.

## NEXT

- W2–W4: ingest, editable project state, snapshot delivery, quality/safety и
  exit portability по зависимостям утверждённого плана.
- W5: pilot-readiness evidence без production release.

## LATER

- Реальные производственные feed credentials, production migration и rollout —
  только отдельной явной release-командой владельца.
- `DH-10` не входит в completion boundary v1.

## Constraints

- Один независимый epic stream = отдельная ветка и SourceCraft PR.
- Delivery задач текущего плана — `PR_ONLY`; merge и production не разрешены.
- Точное состояние, зависимости, commits и proof принадлежат Beads ledger.
