# Backlog — АМС Старт

**Статус:** Active
**Execution source:** `AMS-MICROSAAS-HARDENING-2026-01 v3` and local Task
Manager graph. This file is the product-facing summary, not a duplicate graph.

## NOW

- **E00 / E00A:** normalize canon and create safe real PostgreSQL test
  foundation.
- **E01:** establish neutral copy-source derivation contract.

## NEXT

- **E02–E03:** harden identity, Platform Admin, tenant context and database
  isolation.
- **E04–E06:** make commands, audit, outbox and PostgreSQL evidence atomic and
  reproducible.
- **E07–E09:** align SourceCraft gates, runtime artifact and UI/observability
  safety.

E08 runtime/artifact implementation is locally verified and awaits its own
PR-only review path; this does not authorize merge or production.

## LATER

- **E10–E11:** clean-room derivation proof and final conformance handover.
- Product-specific vertical slices only in a derived repository.

## Constraints

Each hardening epic has a separate `PR_ONLY` delivery task. No task in this
repository authorizes automatic merge or production.
