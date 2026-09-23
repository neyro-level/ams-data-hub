# Architecture

`АМС Старт` следует `AMS Application Platform Core 3.4 — Solo Minimal`.

## Repository And Delivery Contract

- `PROJECT_CLASS = STANDARD`: repository входит в поддерживаемый портфель AMS, но не является клиентским production-приложением.
- `DELIVERY_PROFILE = EXPERIMENT`: у самого starter нет реальных пользователей, подключённых клиентов, production-данных, домена, БД или deploy host.
- SourceCraft `integrator-p/ams-microsaas-starter` — canonical primary; GitHub `neyro-level/ams-microsaas-starter` — exact read-only mirror.
- Push и Pull Request не запускают платный CI. Статус разработки starter — только `LOCAL PASS / CI NOT RUN (EXPERIMENT)`.
- Ручные SourceCraft workflows являются не активным release-route, а шаблонами будущего hardening. Их нельзя запускать для starter.
- Перед первым реальным пользователем производный repository проходит отдельный `EXPERIMENT -> COMMERCIAL | CRITICAL` stream и получает собственные secrets, database topology, immutable artifact, rollback identity и production runbook.
- Сам `ams-microsaas-starter` в production не выпускается.

## Layers

- `src/app` — Next.js routes, server actions and layouts;
- `src/components` — reusable UI and public/private presentation;
- `src/modules/identity-access` — Better Auth adapter, users, roles, memberships;
- `src/modules/project-registry` — neutral project entity for starter validation;
- `src/modules/platform-admin` — admin resources and summary;
- `src/modules/platform-operations` — audit, idempotency, outbox, jobs, readiness;
- `src/modules/notifications` — notification feed and read state;
- `src/platform` — database, authorization, actions, commands, config, observability;
- `src/worker` — neutral worker entrypoint.

## Dependency Direction

Presentation calls module public entrypoints. Module internals stay private. Prisma is allowed only in platform database and module infrastructure. Domain/application layers do not import Next.js, React or Prisma.

## Runtime

- Next.js 16 / React 19 / TypeScript strict;
- Prisma 7 + PostgreSQL;
- Better Auth owns identity/password/session;
- outbox + pg-boss compatible worker boundary;
- Docker standalone image for production packaging.

## PWA

The app is installable in browser standalone mode. Service worker caches only public shell/static assets and explicitly skips private routes and API requests.
