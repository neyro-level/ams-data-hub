# ADR index — AMS Data Hub

ADR IDs are stable. They are not renumbered after the transition from the
reference foundation to the product-owned Data Hub application.

| ID | Status | Current decision or replacement |
| --- | --- | --- |
| ADR-001 | Active | Application Platform Core 3.4 profile |
| ADR-002 | Superseded | Product boundary is now `03_ARCHITECTURE.md` plus the approved v1 plan |
| ADR-003 | Active | Safe native PostgreSQL test foundation |
| ADR-004 | Superseded | Product identity is owned by `03_ARCHITECTURE.md`; import history is in `CHANGELOG.md` |
| ADR-005 | Active | Identity and Platform Admin hardening |
| ADR-006 | Active | PostgreSQL tenant isolation and runtime identities |
| ADR-007 | Active | Command atomicity and repository boundary |
| ADR-008 | Active | Outbox-plus-queue reliability |
| ADR-009 | Active | PostgreSQL security evidence |
| ADR-010 | Active | Risk-based manual SourceCraft gates |
| ADR-011 | Active | Immutable runtime artifact and release template |
| ADR-012 | Active, amended | Private-cache headers, error and observability guards stay active; PWA/contact clauses were retired by DH-00.5 |
| ADR-013 | Superseded | Clean-room starter derivation is outside the product-owned Data Hub lifecycle |
| ADR-014 | Active | Final conformance, handover and rollback evidence |
| ADR-015 | Active | Per-project snapshot storage isolation |
| ADR-016 | Active | Pinned vendored schemas for independent handoff builds |

Superseded ADRs remain tracked as historical decisions until the template-trace
cleanup task removes obsolete verifier coupling. Their IDs must never be reused.
