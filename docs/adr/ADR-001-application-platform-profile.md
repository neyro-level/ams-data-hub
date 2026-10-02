# ADR-001: AMS Data Hub Platform Profile

## Decision

Use `AMS Application Platform Core 3.4 — Solo Minimal` as the neutral starter profile.

## Context

The repository is a reusable foundation, not a production app and not a product-specific reference vertical.

## Consequences

- keep auth, tenant model, Platform Admin, audit, outbox and worker;
- avoid provider-specific integrations in the baseline;
- require a separate hardening stream before real users or production data.
