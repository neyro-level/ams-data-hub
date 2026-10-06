# ADR-014: Final Conformance And Handover Contract

**Status:** Active for the product-owned Data Hub application.

Conformance applies to one exact final SourceCraft main SHA. Each guarantee
has executable evidence, a bounded exception or an explicit deferred capability
with its owner/trigger. Closed implementation tasks do not imply production.

`../05_RELEASE_CHECKLIST.md` owns the guarantee matrix and release exceptions;
`../OPERATIONS.md` owns deployment, recovery and rollback.
`pnpm verify:conformance` checks the product contract against tracked runtime,
identity, branch policy and required scripts, and records commit/tree identity
only from a clean tracked checkout. `pnpm verify:release` includes it.

The approved v4 DH-00–DH-09 graph is complete. `../DELIVERY_STATE.yaml` and Task
Manager record exact PR/Gate/merge evidence. Additional work has separate
tasks and reviewed delivery. Production migration, real credentials, artifact
publication and rollout remain a separately authorized exact-main release.

Independent consumer handoff uses pinned vendored transfer contracts,
`ProjectExitBundleV1` and verified local mode. Consent evidence remains a
separate protected legal/operator handoff; it is absent from public bundles.
No derivation/generator command is required by the current product lifecycle.
