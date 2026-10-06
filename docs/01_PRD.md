# PRD — AMS Data Hub

**Статус:** Active
**Product:** product-owned AMS Data Hub, `DELIVERY_PROFILE = CRITICAL`.

## Проблема и назначение

AMS Data Hub управляет организациями и проектами, общим каталогом, источниками,
импортом, редакционным состоянием и доставкой публичных данных независимым
сайтам. Платформенные границы переиспользуются для CRM, аналитических кабинетов
и внутренних продуктов AMS. Клиентские бренды и credentials не встраиваются в core.

## Пользователь и ценность

- Platform Admin управляет доступом, каталогом, источниками и операциями.
- Пользователь организации работает только с разрешёнными проектами.
- Независимый сайт получает signed snapshot или Exit Bundle для `DATA_MODE=local`.

## Реализованная область

Identity/session, явный tenant principal, TOTP для Platform Admin, organizations,
memberships, projects, audit, idempotency, outbox и worker; общий каталог
`Region → City → District` и `Developer → Development → Building`; проектные
контакты, агенты и consent, editorial, URL lifecycle; registry источников,
XML-профили и safety/import contracts; signed snapshots, ACK, rollback,
media mirror, fleet operations, alerts и Exit Bundle.

Импорт новостроек использует typed staging, provenance, price observations,
rights-bearing media, dry-run и явное подтверждение просмотренного diff.
Это не разрешение на реальные импорт, расписание или production migration.

## Границы и выпуск

Public signup и billing не входят в текущий contract. Публичная поверхность:
вход, privacy policy и health endpoints; сайт закрыт от индексации.
Production identity: `https://data-hab.ams24.ru`.
Реализация v4 доставлена в SourceCraft `main`; фактический статус находится в
`04_BACKLOG.md`, Task Manager и `DELIVERY_STATE.yaml`.

Production release, реальные ПДн/фиды, provider credentials и deployment требуют
отдельной явной команды владельца и exact-main release proof.
