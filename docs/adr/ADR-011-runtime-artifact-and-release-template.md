# ADR-011: Hardened Runtime, Artifact And Release Template

**Status:** accepted and locally verified for E08
**Scope:** Data Hub runtime artifacts and release contract; this decision alone
performs no registry publish, server mutation, DNS or credential operation.

## Decision

A reviewed exact Data Hub SHA produces separate immutable build, runtime-dependency, non-root runtime and migrator artifacts from a digest-pinned Node base. The final runtime excludes package managers, dev tooling, tests, build cache and unnecessary source; writable paths are explicit and bounded.

`web`, `worker`, `migrator` and `backup` have separate environment/permission contracts. Only migrator has controlled migration capability; web/worker are E03 non-owner runtime identities. A release record binds reviewed SHA, image digest and an explicit previous rollback digest. Production requires an explicitly authorized exact-main release, immutable
registry digests and live proof; merge is not a deployment.

## Template Evidence

| Guarantee | Local template proof |
| --- | --- |
| minimal immutable runtime | `runtime-web` and `runtime-worker` run as `node`; image inspection proves package managers, `tsx`, `tsc`, tests and source are absent |
| separated identities | Compose binds separate web, worker and migrator images and environment files; migrator rejects arbitrary commands |
| deterministic rollback | schema-v2 release manifest requires three current digests and either an explicit previous manifest or an explicit first-release decision |
| safe infrastructure shape | Compose uses read-only filesystems, bounded `/tmp`, dropped capabilities and `no-new-privileges`; Nginx/systemd use the project-owned deployment identity |
| recoverability | logical backup/isolated restore scripts and a managed-provider evidence interface are reusable but not executed against a real provider here |
| bounded database load | checked example allocates 33 of 80 usable connections and leaves 47 unallocated |
| safe live proof | local-only skeleton checks SHA, liveness/readiness, private cache policy and unauthenticated workspace/admin access |

Container vulnerability inspection uses Docker Scout against exact image IDs
and writes SARIF only to ignored `.local/evidence`. Inspection does not publish
an image. Current merge authorization follows ADR-010; registry/server actions
require the separately approved release workflow and rollback runbook.

Historical image scans do not attest current artifacts. Rebuild and inspect
every exact release image; record current findings, accepted bounded exceptions
and rollback digests in that release's evidence.
