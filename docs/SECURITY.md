# Security

**Status:** Active extension. `03_ARCHITECTURE.md` owns the cross-cutting
policy; this file records the Data Hub trust boundaries.

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

Data Hub contains account data, memberships, notifications, audit events, agent contacts and client-feed data. New PII categories must be documented before production.

## Public surface

Only the login page, privacy policy and operational health endpoints are public. The site is excluded from indexing. Public contact collection, public signup, offline mode and service-worker caching are not present.

## Cache boundary

Private, auth, API and operational routes use explicit non-cacheable response headers. There is no browser service worker.

E09 formalizes route-aware cache/error/log safeguards in [`ADR-012`](adr/ADR-012-ui-pwa-error-observability-safety.md).

## Secrets

Secrets must stay in environment/secret manager, never in Git, docs, browser code, argv or logs.
Application code passes `SecretRef` objects, not secret values, across internal
configuration boundaries. Resolution is server-only. Resolved values are
registered with the structured logger redaction layer; sensitive keys, embedded
values and remote feed URLs are removed from both structured fields and message
text. UI projections expose only configured/not-configured state and redacted
markers. Feed URLs are never rendered in full.

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

Current-release Platform Admin authority is based on a fresh persisted session,
enabled user and explicit system role, with server-side permission/resource
checks. TOTP is NOT REQUIRED; OQ-09 is DEFERRED until explicit post-pilot owner
decision. Multiple active memberships require explicit organization selection. Temporary passwords, when
used by migration tooling, are supplied through stdin and never bypass setup.

## Authentication Transition

The current owner amendment replaces E02's previous factor policy, not password/
session or authorization security. MP-01 removes legacy runtime factor checks,
TOTP-specific recovery and unused factor schema through a new forward migration.
Its evidence is auth-scoped, not overall production readiness.
One-time hashed account setup/password recovery material remains protected.
Sensitive auth rate limits must be PostgreSQL-backed. Trusted origins are exact;
CSRF/origin protection stays enabled. The production deployment must define
the exact reverse-proxy IP/CIDR boundary in `BETTER_AUTH_TRUSTED_PROXY_CIDRS`
and restrict the origin so it is not directly reachable by clients. Without that
value Better Auth refuses to start in production; Data Hub never trusts an
unconfigured forwarded-IP header. Public errors and logs use safe codes and
never reveal tokens, secrets or recovery material.

The complete implementation/evidence contract is
[`ADR-005`](adr/ADR-005-identity-platform-admin-hardening.md).

## Remediation publication and runtime boundary

The four approved XML families retain Safe Outbound, XXE protection and
SourceProfile/SourceAdapter separation. The newbuilding capability permits only
staging, dry-run, reviewed hash, explicit manual apply and transaction-bound
audit/revision. No approval enables live feeds or production schedules here.
Safe HTML remains limited to ingestion-sanitized `descriptionHtmlSafe`; raw HTML
is forbidden. Original media URLs are provenance, not an approved public media
fallback. MP-06 implements the public DTO/scanner boundary. MP-07 implements
finite compressed/decoded/count/combined-work policy, cheap raw manifest bounds,
complete preflight before any inflation and private hash-bound copies. Native
gunzip output is capped before JSON/Zod; raw and validated record counts match
the signed manifest. Rejections preserve exact last-good and do not apply/ACK.
Adversarial tests use synthetic signed artifacts, not live feeds or private data.
These are artifact-work limits, not a sandbox for trusted callbacks or limits on
prior download/concurrent consumer calls; external consumers must bound those
operations themselves. MP-09/MP-10 must prove the final composed runtime.

## Tenant Isolation Transition

Each protected transaction receives a server-owned local PostgreSQL context;
RLS denies missing or mismatched tenant/project context. Runtime web and worker
identities are non-owner `NOBYPASSRLS` roles. Production credentials live in the
project Secret Master scope. The disposable local test identity bypasses RLS
only to reset/seed its guarded `*_test` database; assertions switch to runtime
roles. See [`ADR-006`](adr/ADR-006-postgresql-tenant-isolation.md).

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
