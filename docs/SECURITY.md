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

## Secrets

Secrets must stay in environment/secret manager, never in Git, docs, browser code, argv or logs.

## Authentication Transition

E02 makes Platform Admin authority conditional on verified TOTP and replaces
permanent bootstrap passwords with one-time hashed setup and recovery material.
Sensitive auth rate limits must be PostgreSQL-backed. Trusted origins and proxy
boundaries are exact; CSRF/origin protection stays enabled. Public errors and
logs use safe codes and never reveal tokens, secrets or recovery material.

The complete implementation/evidence contract is
[`ADR-005`](adr/ADR-005-identity-platform-admin-hardening.md).
