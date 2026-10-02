# Документы AMS Data Hub

## Canonical product documents

| Question | Source of truth |
| --- | --- |
| What and for whom | `01_PRD.md` |
| Routes, screens and derivation substitutions | `02_PRODUCT_STRUCTURE.md` |
| Platform profile, architecture, policy and exact version decisions | `03_ARCHITECTURE.md` and ADRs |
| Current product work | `04_BACKLOG.md` |
| Derived-product release readiness | `05_RELEASE_CHECKLIST.md` |
| Cross-surface visual rules | `06_DESIGN_SYSTEM.md` |
| Copy-source derivation and identity verification | `DERIVATION.md` |
| Final guarantee matrix and derived-product handover | `HANDOVER.md` |

## Justified detailed extensions

| File | Role | Status |
| --- | --- | --- |
| `AUTH.md` | Better Auth and provisioning detail | Active extension |
| `DATA_MODEL.md` | schema-oriented neutral model map | Active extension |
| `SECURITY.md` | trust boundary and PII implementation detail | Active extension |
| `ENVIRONMENT.md` | variable registry without values | Active extension |
| `RUNBOOK_DEPLOY.md`, `ops/*` | reusable local/recovery/deploy procedures | Active extension |
| `EXTERNAL_SITE_DESIGN_SYSTEM.md`, `INTERNAL_DASHBOARD_DESIGN_SYSTEM.md` | detailed public/private surface rules | Active extension |
| `MASTER_PLAN.md`, `MASTER_PLAN.inventory.json` | approved Task Manager execution graph and import inventory | Active execution artifacts |
| `HANDOVER.md` | final guarantee-to-proof matrix, bounded exceptions and derived-product transfer | Active extension |

`PRODUCT.md` and `ARCHITECTURE.md` are retained only as legacy reading aids and
are superseded by the numbered canon above. `MASTER_PLAN.md` does not replace
the product backlog: it is the approved execution graph for this finite
hardening program. Task Manager stores mutable execution state locally in
`.beads`.

Starter does not contain an industry vertical. Domain model, integrations,
pricing, legal texts and production topology belong to a derived repository.
