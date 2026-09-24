# ADR-011: Hardened Runtime, Artifact And Release Template

**Status:** accepted for E08 implementation  
**Scope:** reusable local template only; no registry publish, server mutation, DNS or production credential.

## Decision

A reviewed derived-project SHA produces separate immutable build, runtime-dependency, non-root runtime and migrator artifacts. The final runtime excludes package managers, dev tooling, tests, build cache and unnecessary source; writable paths are explicit and bounded.

`web`, `worker`, `migrator` and `backup` have separate environment/permission contracts. Only migrator has controlled migration capability; web/worker are E03 non-owner runtime identities. A release record binds reviewed SHA, image digest and an explicit previous rollback digest. Production remains a derived-product action, never a starter action.

## Template Evidence

| Guarantee | Planned proof |
| --- | --- |
| minimal immutable runtime | local image inspection proves no dev package manager/tooling/source surface |
| separated identities | migrator probe succeeds only with migration identity; runtime probe lacks DDL privileges |
| deterministic rollback | release metadata requires exact SHA, current digest and explicit prior digest |
| safe infrastructure shape | Compose/Nginx/systemd are placeholders without real host/domain/credential |
| recoverability | logical backup/restore rehearsal runs only against an isolated disposable target |
| bounded database load | connection budget declares web, worker, pg-boss, migrator and maintenance allocations |
| safe live proof | skeleton checks route, access and cache expectations without sending production traffic |

Container vulnerability inspection runs locally only when an image is actually built; it never publishes the image. The contract stops if Docker/artifact proof needs a registry, server or production credentials. Full implementation is `RISKY`, PR-only, and a derived product must complete its own release and rollback runbook before use.
