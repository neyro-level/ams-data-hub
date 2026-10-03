# DH-00 Canon Mapping

Status: `PASS_FOR_DH-00.2`  
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
| Program constitution | `docs/00_CONSTITUTION.MD.md` on the approved-plan branch; absent from base `origin/main` | `docs/00_CONSTITUTION.md` | Domain and operations constitution v3.1.2 | Add under canonical name without semantic rewrite; then link it from numbered canon. |
| Product requirements | `docs/01_PRD.md`, `docs/PRODUCT.md` | `docs/01_PRD.md` | Product, personas, scope and open questions; `PRODUCT.md` is marked superseded | Preserve unique content in `01_PRD.md`; remove legacy aid only after link scan. |
| Screens and routes | `docs/02_PRODUCT_STRUCTURE.md` | `docs/02_PRODUCT_STRUCTURE.md` | Routes, Hub Admin flows and public surface | Retain and update against approved public-surface scope. |
| Platform architecture | `docs/03_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` | `docs/03_ARCHITECTURE.md` plus justified data contract files | Platform profile, ownership, policy; legacy architecture is explicitly superseded | Keep `03`; move only unique schema map detail to a justified data-contract extension; remove `ARCHITECTURE.md` last. |
| Execution priority | `docs/04_BACKLOG.md` | `docs/04_BACKLOG.md` | NOW/NEXT/LATER | Replace starter derivation references with pointer to approved plan and Beads. |
| Implementation program | `docs/MASTER_PLAN.md`, `docs/MASTER_PLAN.inventory.json`, approved `docs/AMS Data Hub Master Plan v1.md`, `docs/AMS_DATA_HUB_MASTER_PLAN_V1.inventory.json` | `docs/04_IMPLEMENTATION_PLAN.md` and the matching inventory | Legacy starter graph; approved Data Hub v1 graph | Rename/copy only the approved plan at the documented checkpoint; retire legacy graph and inventory after links target v1. |
| Release readiness | `docs/05_RELEASE_CHECKLIST.md`, `docs/HANDOVER.md` | `docs/05_RELEASE_CHECKLIST.md`, `docs/DELIVERY_STATE.yaml` | Exact-main release, handover proof matrix | Keep release checklist; move mutable proof pointers to delivery state and retain only independent handover contract if still needed. |
| Auth and trust boundary | `docs/AUTH.md`, `docs/SECURITY.md` | `docs/SECURITY.md` with an optional auth extension only if still independently detailed | Better Auth/provisioning; PII and trust boundary | Consolidate duplicated policy, preserve implementation detail that does not fit architecture. |
| Environment registry | `docs/ENVIRONMENT.md` | `docs/ENVIRONMENT.md` | Names and purpose of env variables without values | Retain; update names only with runtime changes. |
| Operations | `docs/RUNBOOK_DEPLOY.md`, `docs/ops/LOCAL_DEVELOPMENT.md`, `docs/ops/RECOVERY.md` | `docs/OPERATIONS.md` | Deploy, local recovery and operational procedure | Consolidate distinct runbooks into operations sections before deleting old paths. |
| Visual system | `docs/06_DESIGN_SYSTEM.md`, `docs/EXTERNAL_SITE_DESIGN_SYSTEM.md`, `docs/INTERNAL_DASHBOARD_DESIGN_SYSTEM.md` | `docs/DESIGN_SYSTEM.md` | Cross-surface plus public/private UI detail | Preserve non-duplicated rules in one design system; do not change visual behavior in this task. |
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
