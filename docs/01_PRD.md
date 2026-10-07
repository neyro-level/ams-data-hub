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

## Реализованный фундамент и активная доработка

Identity/session, явный tenant principal, organizations,
memberships, projects, audit, idempotency, outbox и worker; общий каталог
`Region → City → District` и `Developer → Development → Building`; проектные
контакты, агенты и consent, editorial, URL lifecycle; registry источников,
XML-профили и safety/import contracts; snapshot composer/signing/storage,
ACK/rollback contracts, media mirror, fleet requests, alerts и Exit Bundle.
Это реализованные границы и компоненты, не доказательство готовности полного
operational pipeline. Source composition, worker/scheduler и DB-to-snapshot
assembly реализованы MP-02–MP-05; MP-05 provider delivery ещё ожидает gate.
Operations executors/API и полное readiness proof требуют MP-08–MP-10.

Owner decision 2026-10-06: текущая версия не требует 2FA/TOTP; OQ-09 DEFERRED,
возврат к вопросу — post-pilot по явному решению владельца. MP-01 удалил
legacy TOTP plugin, login branch, principal/env gate и factor schema новой
forward migration. Auth regression и delivery evidence принадлежат Task Manager.
Username/password, свежая enabled session, server authorization, rate limits
и RLS сохраняются. Разрешены YRL/Vladis, Domclick XML, Avito v3 и CIAN v2;
формат принадлежит SourceAdapter, producer semantics — SourceProfile.

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
