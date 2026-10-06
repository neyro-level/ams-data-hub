# DH-00 Canon Mapping

Status: `DH-00.2_TRANSFER_COMPLETE`. This is the completed transfer proof,
not a second product specification or task graph. Current execution refers to
the approved v4 artifact at its unchanged exact path and hash.

## DH-00.2 transfer proof

| Removed source family | Current owner of unique meaning |
| --- | --- |
| Product aids | `01_PRD.md` |
| Legacy architecture | `03_ARCHITECTURE.md` and `DATA_MODEL.md` |
| Legacy master plan/inventory | `AMS Data Hub Master Plan v1.md` and `AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json` (exact v4 approval artifact) |
| Auth aid | `SECURITY.md` and ADR-005 |
| Deploy/local/recovery runbooks | `OPERATIONS.md` |
| Separate public/private design aids | `06_DESIGN_SYSTEM.md` |
| Derivation/handover aids | `04_BACKLOG.md`, `05_RELEASE_CHECKLIST.md` and `OPERATIONS.md` |
| Superseded ADR-002/004/013 content | stable replacement pointers in `adr/`; original text in Git history |

`docs/README.md` is the document map. `AGENTS.md` is the project router.
Snapshot and Exit Bundle contracts are in `contracts/`; source profiles and
secret-free dated evidence are in `sources/` and `research/`. Approved
`00_CONSTITUTION.MD.md` is preserved as an architectural input, not mutable
runtime or delivery status.

## Current checks

The superseded files are absent, incoming active links point to the resulting
canon, and `pnpm docs:check` verifies its required files and local Markdown
links. Applied schema and versions belong to repository runtime files, not
the old migration checkpoint. Mutable PR/gate/merge evidence belongs to Task
Manager and `DELIVERY_STATE.yaml`.
