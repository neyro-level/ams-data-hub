# Architecture

`АМС Старт` следует `AMS Application Platform Core 3.4 — Solo Minimal`.

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
