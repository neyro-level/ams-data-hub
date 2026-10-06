# ADR-010: Risk-Based SourceCraft Gates

**Status:** Active.
**Scope:** product-owned Data Hub with `DELIVERY_PROFILE = CRITICAL`.

## Decision

Push and Pull Request create zero CI runs. Each merge uses one reviewed exact
head and one manual SourceCraft `merge-risky` Gate. A new push invalidates old
head evidence. The available `merge-standard` workflow does not reduce the
Data Hub CRITICAL merge requirement.

The Gate verifies checkout SHA, scans secrets and runs `verify:quick` plus
relevant scoped tests. Integration, dependency scan and build inputs follow
the reviewed risks; all suites are not implied by RISKY.

## Configuration and evidence

`.sourcecraft/ci.yaml` declares empty path filters for push/PR, so event runs
are disabled; manual workflows remain callable. `.sourcecraft/branches.yaml`
protects main from force push, non-PR changes and deletion.
`scripts/ci/classify-risk.mjs` is a review hint and cannot authorize merge.

Record PR source/target, exact head, workflow/run, verdict and merge SHA in the
Task Manager execution ledger. Gate is separate from the manual `release`
workflow. Production requires explicit owner authorization, exact-main SHA,
immutable registry digests, live proof and rollback evidence.

## Verification And Secrets

`tests/sourcecraft-policy.test.ts` and the policy/exact-head scripts enforce
the contract. Secrets and full environment/private URLs never enter evidence.
A local PASS is not a CI attestation or production proof.
