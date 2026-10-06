# ADR-001: AMS Data Hub Platform Profile

**Status:** Active.

## Decision

Use `AMS Application Platform Core 3.4 — Solo Minimal` with the product profile
in `../03_ARCHITECTURE.md`: `PROJECT_CLASS = STANDARD`,
`DELIVERY_PROFILE = CRITICAL`, multi-tenant, PII, outbox-plus-queue, own-saas
and Platform Admin enabled.

## Context and consequences

Data Hub is a product-owned reference application with its own domain, identity
and infrastructure. Server authorization, transaction-bound repositories,
RLS, audit and independent worker remain mandatory. Shared catalog and
project-owned ingestion are implemented; client-specific logic stays outside
core. Push/PR are zero-CI; merge requires one manual exact-head RISKY Gate.
Production needs a separate exact-main release and live proof.
