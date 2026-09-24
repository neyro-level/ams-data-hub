# ADR-002: Strong starter hardening boundary

**Status:** accepted

## Context

`АМС Старт` is a reusable copy-source foundation, not a product reference or a
production application. Its baseline already includes organizations, roles,
audit, a transactional outbox and a worker boundary, but it does not yet prove
the stronger guarantees required before a derived product is trusted with real
users or data.

The approved program `AMS-MICROSAAS-HARDENING-2026-01 v3` must improve those
platform guarantees without importing provider-specific modules, production
identity, credentials or deployment state from another application.

## Decision

The starter remains an `EXPERIMENT` copy-source and keeps this platform profile:

```text
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
```

The hardening program is limited to neutral platform foundations:

- explicit server-owned tenant context and default-deny tenant access;
- PostgreSQL-backed isolation, command transaction boundaries and durable audit;
- transactional outbox plus queue, lease, retry, dead-letter and retention
  evidence;
- secure identity provisioning, Platform Admin MFA/recovery and server-side
  rate limiting;
- reproducible test, artifact, derivation and manual-gate templates.

The following remain outside the starter: a product domain, provider
integrations, production secrets, a production database or host, and an
automatic production release.

## Traceability

The approved master plan is the sole execution source. This ADR freezes the
architecture boundary for its guarantee matrix:

| Guarantee group | Planned implementation and evidence |
| --- | --- |
| Canon, stack exceptions, PII lifecycle | E00 implementation and verification |
| Test database safety | E00A implementation and verification |
| Neutral derivation | E01 implementation and verification |
| Identity and Platform Admin | E02 implementation and verification |
| Tenant context, RLS and data boundaries | E03 implementation and verification |
| Commands, audit and idempotency | E04 implementation and verification |
| Outbox-plus-queue reliability | E05 implementation and verification |
| Cross-contract PostgreSQL proof | E06 implementation and verification |
| SourceCraft gates, artifact/runtime, UI safety | E07--E09 implementation and verification |
| Clean-room derivation and final conformance | E10--E11 implementation and verification |

Each epic is delivered through a separate `PR_ONLY` pull request. A pull request
does not authorize merge or production; those remain owner actions outside this
ADR.

## Consequences

- `outbox-plus-queue` is retained as a tested optional foundation; a derived
  product does not need to run a worker until it introduces an async contract.
- A derived product must select `COMMERCIAL` or `CRITICAL`, its own secrets,
  database topology and release identity before production.
- The program may add neutral contracts and evidence, but it must not turn the
  starter into a generator or a second product.
