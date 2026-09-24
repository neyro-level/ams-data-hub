# Product Structure — АМС Старт

**Статус:** Active

## Surface map

| Surface | Routes / responsibility | Access |
| --- | --- | --- |
| Public shell | `/`, legal pages, footer, login modal | public; contact delivery disabled by default |
| Auth | `/api/auth/*` and login flow | Better Auth; public signup disabled |
| Workspace | `/dashboard/`, `/notifications/` | authenticated tenant principal |
| Platform Admin | `/admin/*` | explicit `PLATFORM_ADMIN` authority |
| Health | `/api/health/live`, `/api/health/ready` | operational, no secret disclosure |

## Core flows

1. Operator or Platform Admin creates an account and membership.
2. User authenticates and acts only through a server-owned principal.
3. Tenant work is scoped to an organization; Platform Admin operations are
   explicit and audited.
4. A business mutation may create an outbox event in the same transaction;
   worker delivery occurs after commit.

## Derivation substitutions

A derived product replaces application name/slug/origin, legal content,
visual identity where needed, health/service identifiers, database names and
artifact names. It must not reuse starter credentials, hostname or database.
