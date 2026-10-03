# DH-00 Canon Mapping

Status: `DH-00.2_TRANSFER_COMPLETE`
Source task: `dh-00.1` of `AMS-DATA-HUB-IMPLEMENTATION-2026-01 v1`
Base: `6246a2fa26ed8aaae629f891d6c64d07c0f8a96f`

This is a mapping checkpoint, not a new source of truth. It records the only
permitted migration order for DH-00.2: transfer unique current meaning, update
incoming links, run the document check, then remove a superseded file in a
separate revertible commit.

| Role | Current file(s) | Target source of truth | Unique current meaning | DH-00.2 action |
| --- | --- | --- | --- | --- |
| Project router | `AGENTS.md` | `AGENTS.md` | Local invariants, delivery profile and checks | Retain; align only links and command names. |
| Entry point | `README.md`, `docs/README.md` | root `README.md`, `docs/README.md` | Product start instructions; document map | Retain; make the document map point only to the resulting canon. |
| Program constitution | `docs/00_CONSTITUTION.MD.md` | same exact approved input | Domain and operations constitution v3.1.2 | Preserve exact content and path referenced by approved v1; no semantic rewrite. |
| Product requirements | `docs/01_PRD.md`, `docs/PRODUCT.md` | `docs/01_PRD.md` | Product, personas, scope and open questions; `PRODUCT.md` is marked superseded | Preserve unique content in `01_PRD.md`; remove legacy aid only after link scan. |
| Screens and routes | `docs/02_PRODUCT_STRUCTURE.md` | `docs/02_PRODUCT_STRUCTURE.md` | Routes, Hub Admin flows and public surface | Retain and update against approved public-surface scope. |
| Platform architecture | `docs/03_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` | `docs/03_ARCHITECTURE.md` plus justified data contract files | Platform profile, ownership, policy; legacy architecture is explicitly superseded | Keep `03`; move only unique schema map detail to a justified data-contract extension; remove `ARCHITECTURE.md` last. |
| Execution priority | `docs/04_BACKLOG.md` | `docs/04_BACKLOG.md` | NOW/NEXT/LATER | Replace starter derivation references with pointer to approved plan and Beads. |
| Implementation program | legacy `docs/MASTER_PLAN*`; approved exact-path plan and inventory | approved exact-path files | Legacy starter graph; approved Data Hub v1 graph | Keep approved source path bound to Beads; remove legacy graph and inventory. |
| Release readiness | `docs/05_RELEASE_CHECKLIST.md`, `docs/HANDOVER.md` | `docs/05_RELEASE_CHECKLIST.md`, `docs/DELIVERY_STATE.yaml` | Exact-main release, handover proof matrix | Keep release checklist; move mutable proof pointers to delivery state and retain only independent handover contract if still needed. |
| Auth and trust boundary | `docs/AUTH.md`, `docs/SECURITY.md` | `docs/SECURITY.md` with an optional auth extension only if still independently detailed | Better Auth/provisioning; PII and trust boundary | Consolidate duplicated policy, preserve implementation detail that does not fit architecture. |
| Environment registry | `docs/ENVIRONMENT.md` | `docs/ENVIRONMENT.md` | Names and purpose of env variables without values | Retain; update names only with runtime changes. |
| Operations | `docs/RUNBOOK_DEPLOY.md`, `docs/ops/LOCAL_DEVELOPMENT.md`, `docs/ops/RECOVERY.md` | `docs/OPERATIONS.md` | Deploy, local recovery and operational procedure | Consolidate distinct runbooks into operations sections before deleting old paths. |
| Visual system | `docs/06_DESIGN_SYSTEM.md`, two legacy surface files | `docs/06_DESIGN_SYSTEM.md` | Cross-surface plus public/private UI detail | Consolidate non-duplicated rules in the numbered standard file; do not change runtime visuals. |
| ADRs | `docs/adr/ADR-001…ADR-014` | `docs/adr/` | Platform, RLS, async and digest-release decisions | Keep stable IDs; DH-00.3 supplies explicit old-to-new mapping where needed. |
| Contracts | no tracked `docs/contracts/` yet | `docs/contracts/` | Required future snapshot and Exit Bundle contracts | Create only in the first epic that delivers a real contract (DH-05/DH-08). |
| Changelog | no tracked `CHANGELOG.md` yet | `CHANGELOG.md` | Product history | Create in DH-00.2 with initial-import history only. |

## Link and existence check

- `docs/README.md` currently names `MASTER_PLAN.md` and its legacy inventory as
  active execution artifacts; this must change only when the approved v1 plan
  and inventory are present on the delivery branch.
- `03_ARCHITECTURE.md`, `04_BACKLOG.md`, `06_DESIGN_SYSTEM.md`, `DERIVATION.md`,
  `HANDOVER.md`, ADR-014 and the document map contain the legacy links listed
  above. DH-00.2 must update every such incoming link before removal.
- The base branch does not yet contain the approved plan or constitution input.
  That is expected: this mapping does not copy them, and the later checkpoint
  must bring the exact approved files deliberately rather than infer content.

## Pass condition

The table covers every tracked document family in the base tree, identifies one
target for each, and leaves destructive removal to a distinct checkpoint after
`pnpm docs:check` passes.

## DH-00.2 transfer proof

| Removed source | Target containing unique current meaning |
| --- | --- |
| `PRODUCT.md` | `01_PRD.md` |
| `ARCHITECTURE.md` | `03_ARCHITECTURE.md` and `DATA_MODEL.md` |
| legacy `MASTER_PLAN*` | approved exact-path plan and inventory |
| `AUTH.md` | `SECURITY.md` login, roles and provisioning section |
| deploy/local/recovery runbooks | `OPERATIONS.md` |
| external/private design-system files | `06_DESIGN_SYSTEM.md` public/private sections |
| `DERIVATION.md`, `HANDOVER.md` | `04_BACKLOG.md`, `05_RELEASE_CHECKLIST.md` and `OPERATIONS.md` |

The approved plan path is intentionally preserved because its hash/path is part
of the imported v1 graph and execution ledger. Mutable delivery proof remains
in Beads rather than being duplicated in documentation.
