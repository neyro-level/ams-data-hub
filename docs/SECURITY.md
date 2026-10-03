# Security

**Status:** Active extension. `03_ARCHITECTURE.md` owns the cross-cutting
policy; this file records the starter's detailed trust boundaries.

## Trust Boundaries

- browser never receives secrets;
- server actions require authenticated principal context;
- tenant access requires both auth and resource authorization;
- Platform Admin does not use fake tenant identity;
- every protected request resolves a fresh server-owned principal; disabled,
  revoked or expired access is denied on the next request;
- membership and organization selection are revalidated server-side; an input
  `organizationId` is never tenant-access proof;
- external HTTP/email/AI/storage calls are outside business transactions.

## PII

The starter contains account data, memberships, notifications and audit events. Derived products must document any additional PII before production.

## Public Contact Form

The visual form is kept, but delivery is disabled by default. It sends only when `NEXT_PUBLIC_CONTACT_API_URL`, `NEXT_PUBLIC_CONTACT_PROJECT_ID` and `NEXT_PUBLIC_CONTACT_SITE_KEY` are configured by the derived product.

## PWA Cache

Service worker skips `/api/*`, `/admin/*`, `/dashboard/*`, `/notifications/*`, auth/session routes and non-GET requests. It caches only public shell/static assets.

E09 formalizes route-aware cache/error/log safeguards in [`ADR-012`](adr/ADR-012-ui-pwa-error-observability-safety.md).

## Secrets

Secrets must stay in environment/secret manager, never in Git, docs, browser code, argv or logs.

## Login, roles and provisioning

Better Auth owns identity, password and session lifecycle. Public signup is
disabled. `PLATFORM_ADMIN` is the platform authority; tenant users require an
active organization membership and server-side resource authorization.

The supported provisioning flow is one-time and auditable:

```text
operator creates identity
→ server stores only a hash of the setup token
→ user sets a password
→ token is consumed and sibling tokens are revoked
→ fresh principal resolution enables access
```

Platform Admin authority requires verified TOTP in production. Multiple active
memberships require explicit organization selection. Temporary passwords, when
used by migration tooling, are supplied through stdin and never bypass setup.

## Authentication Transition

E02 makes Platform Admin authority conditional on verified TOTP and replaces
permanent bootstrap passwords with one-time hashed setup and recovery material.
Sensitive auth rate limits must be PostgreSQL-backed. Trusted origins are exact;
CSRF/origin protection stays enabled. A production-derived product must define
the exact reverse-proxy IP/CIDR boundary in `BETTER_AUTH_TRUSTED_PROXY_CIDRS`
and restrict the origin so it is not directly reachable by clients. Without that
value Better Auth refuses to start in production; the starter never trusts an
unconfigured forwarded-IP header. Public errors and logs use safe codes and
never reveal tokens, secrets or recovery material.

The complete implementation/evidence contract is
[`ADR-005`](adr/ADR-005-identity-platform-admin-hardening.md).

## Tenant Isolation Transition

E03 adds database defence in depth: each protected transaction receives a server-owned local PostgreSQL context, and RLS denies missing or mismatched tenant context. Runtime web and worker identities are non-owner `NOBYPASSRLS` roles; production credentials are intentionally outside this starter. The disposable local test identity can bypass RLS only to reset and seed its own `*_test` database; assertions switch to the runtime role first. See [`ADR-006`](adr/ADR-006-postgresql-tenant-isolation.md).

## Atomic Mutation Transition

E04 requires a fresh server principal, authorization and one transaction for
every business mutation. Audit/outbox/idempotency records share that transaction;
safe public errors carry a correlation ID, while raw persistence details stay
server-side. The complete rule is [`ADR-007`](adr/ADR-007-command-atomicity-and-repository-boundary.md).

## Async Transition

E05 queue payloads are untrusted, validated again by the worker, versioned and
free of secrets or unnecessary PII. Runtime worker access is a separate
non-owner database identity; external effects happen only after commit. See
[`ADR-008`](adr/ADR-008-outbox-plus-queue-reliability.md).
