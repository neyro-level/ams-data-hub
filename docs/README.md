# AMS MicroSaaS Starter — карта проекта

Status: Active

Updated: 2026-09-10

## Что создаём

Приватный reusable foundation для быстрого запуска AMS Application Platform продуктов: SaaS, аналитических модулей, кабинетов и mini-CRM. Текущий код содержит полный рабочий SEO reference vertical AMS IMPULSE, но не его Git-историю, локальные данные, secrets или production identity.

## Текущий статус

Starter baseline. Не развёрнут в production и не подключён к реальным данным.

## Platform contract

`AMS Application Platform Core 3.4 — Solo Minimal`. Фактические версии определяют `package.json`, lockfile и `.node-version`.

`DELIVERY_PROFILE = EXPERIMENT` действует только для неразвёрнутого starter repository. Производный продукт с реальными пользователями/PII/ценной БД обязан пройти hardening и выбрать `COMMERCIAL` или `CRITICAL` до merge/release.

## Source of Truth

| Область | Source of Truth |
|---|---|
| назначение starter и reading order | `docs/README.md` |
| reference product и роли | `docs/PRODUCT.md` |
| архитектура, profile, modules, security и production contract | `docs/ARCHITECTURE.md` и профильные документы |
| data model и lifecycle | `docs/DATA_MODEL.md` |
| auth и PII | `docs/SECURITY.md`, `docs/AUTH.md` |
| environment ownership | `docs/ENVIRONMENT.md` |
| текущая работа | `docs/MASTER_PLAN.md` |
| release/recovery | `docs/RUNBOOK_DEPLOY.md`, `docs/ops/*` |
| exact runtime | `package.json`, lockfile, Prisma schema/migrations и runtime config |

## Как начинать производный продукт

1. Создать отдельную branch/worktree от чистого `origin/main`.
2. Обновить Product, Architecture и Master Plan под реальный продукт.
3. Подтвердить platform profile и удалить только ненужные domain-модули.
4. Создать отдельные environment, database, domain, secrets и infrastructure identities.
5. Выполнить risk-based review и proof до первого merge/release.

## Current Focus

Чистый импорт starter baseline в новый SourceCraft repository.
