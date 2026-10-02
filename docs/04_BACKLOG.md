# Backlog — AMS Data Hub

**Статус:** Active
**Execution source:** `AMS-MICROSAAS-HARDENING-2026-01 v4` and local Task
Manager graph. This file is the product-facing summary, not a duplicate graph.

## NOW

- No active foundation epic remains in the starter tree. E00–E10 are merged;
  E11 supplies the final conformance and handover candidate through its own
  PR-only owner gate.
- Git and Task Manager, not this product backlog, record whether that final PR
  has already landed in canonical `main`.

## NEXT

- Create a derived repository through `DERIVATION.md` and `HANDOVER.md`.
- Select the derived product domain, `COMMERCIAL | CRITICAL` delivery profile,
  secrets, PostgreSQL topology and release target before product work.

## COMPLETED HARDENING

- **E00–E01:** canon, safe PostgreSQL test foundation and neutral derivation.
- **E02–E06:** identity, RLS, atomic commands, outbox-plus-queue and integrated
  PostgreSQL evidence.
- **E07–E10:** manual gates, runtime artifacts, UI/PWA safety and clean-room
  derivation proof.
- **E11:** final matrix, bounded exceptions, command map and handover contract
  in the final PR-only stream.

## Constraints

Each hardening epic has a separate `PR_ONLY` delivery task. No task in this
repository authorizes automatic merge or production.
