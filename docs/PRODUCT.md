# Superseded — see `01_PRD.md`

This legacy document is retained for historical reading only. `01_PRD.md` is
the authoritative product contract.

# Legacy product baseline

`АМС Старт` — нейтральная стартовая база для кабинетов, CRM, аналитики и внутренних веб-приложений.

## Для кого

- solo owner, который быстро запускает новый B2B/SaaS инструмент;
- внутренний кабинет без публичной регистрации;
- CRM или аналитический workspace с организациями, ролями, аудитом и фоновой очередью.

## Поверхности

- публичная часть: главная, legal pages, footer, login modal;
- приватная часть: dashboard, notifications;
- Platform Admin: организации, пользователи, memberships, проекты, operations.

## Роли

- `PLATFORM_ADMIN` — владелец платформы, управляет пользователями, организациями и базовыми проектами;
- `STAFF` — сотрудник платформы с расширенным чтением;
- `MEMBER` — пользователь организации.

## Производный продукт

Новый продукт должен заменить:

- название, домен, favicon/icon при необходимости;
- legal-реквизиты и документы;
- доменные сущности вместо или поверх `Project`;
- собственные интеграции и фоновые задачи;
- production database topology и deploy host;
- DELIVERY_PROFILE перед реальными пользователями.
