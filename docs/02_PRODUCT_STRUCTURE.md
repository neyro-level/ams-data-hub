# Product Structure — AMS Data Hub

**Статус:** Active

## Surface map

| Surface | Routes / responsibility | Access |
| --- | --- | --- |
| Public shell | `/`, `/politika/`, footer, login modal, `not-found`, `error` | public; complete site is `noindex, nofollow` |
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

`/admin/fleet/` is the cross-project operations surface. It exposes PII-safe
fleet state, guarded source requests, audited SUSPICIOUS/snapshot/ACK requests,
data-safety freeze/unfreeze controls and a redacted audit feed. Recording a
Build/Publish/Rollback/ACK request does not claim that an executor completed it.
The notifications feed receives deduplicated Platform Admin alerts for overdue
sources, SUSPICIOUS/CRITICAL imports, stale ACK, worker health and failed
backups. Owner email uses the same safe alert envelope, but remains disabled
until a real recipient adapter is explicitly configured.

## Derivation substitutions

A derived product replaces application name/slug/origin, legal content,
visual identity where needed, health/service identifiers, database names and
artifact names. It must not reuse Data Hub credentials, hostname or database.
