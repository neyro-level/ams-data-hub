# ADR-001: Профиль AMS IMPULSE

## Статус

Принято. Это единственное действующее архитектурное решение верхнего уровня.

## Контекст

AMS IMPULSE совмещает публичный SEO-лендинг, приватную multi-tenant отчётность, Platform Admin и фоновые read-only интеграции. Проекту нужны строгая tenant-изоляция, воспроизводимая доставка внешних операций и ограниченная обработка account/operational PII.

## Решение

- platform contract: `AMS Application Platform Core 3.4 — Solo Minimal`;
- `TENANCY = multi-tenant`;
- `ASYNC = outbox-plus-queue`;
- `DATA = pii`;
- `DELIVERY = own-saas`;
- `PLATFORM_ADMIN = enabled`;
- `DATABASE = self-managed-postgresql`;
- project runtime retains exact TypeScript `6.0.3` as an approved project exception to the Core 3.4 default line; downgrade has no product or safety benefit;
- архитектура: один modular monolith на Next.js, отдельные web/worker процессы из одного OCI image;
- data owner: PostgreSQL + Prisma, без второго ORM или runtime storage;
- auth owner: Better Auth для identity/password/session, AMS для Membership, permissions, resource authorization и admin provisioning;
- mutations: `defineAction/API/job adapter → defineCommand → transaction-bound repositories`;
- async: transactional OutboxEvent → pg-boss → idempotent handler;
- public landing и внутренний кабинет сохраняют разные design systems;
- существующие opaque CUID сохраняются; массовая смена идентификаторов не имеет продуктовой ценности;
- RLS, Redis, public signup, billing, files, realtime, внешний `/api/v1` и отдельные services добавляются только по отдельному product trigger.

## Последствия

- `PrincipalContext`, tenant-aware repositories и PostgreSQL constraints являются совместными уровнями защиты;
- Platform Admin не получает фиктивный tenant; вход без дополнительного фактора является утверждённым owner exception с HTTPS, закрытой регистрацией, rate limiting, session revocation и audit как compensating controls;
- applied migrations неизменяемы, production использует только `prisma migrate deploy`;
- release привязан к exact reviewed SHA и immutable image;
- self-managed PostgreSQL 18 — утверждённая production topology: private listener, separate runtime/migrator/backup boundaries, offsite backup и restore proof обязательны;
- перенос на Managed PostgreSQL не планируется и не является conformance gap.

## Критерий пересмотра

ADR пересматривается только при изменении platform profile, auth/data owner, async mechanism или production topology.
