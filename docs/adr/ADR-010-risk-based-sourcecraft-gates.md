# ADR-010: Risk-Based SourceCraft Gate Template

**Status:** accepted for E07 implementation  
**Scope:** dormant copy-source template; the starter itself never runs paid SourceCraft CI.

## Decision

The starter preserves zero CI on branch push and Pull Request. Its own status is
only `LOCAL PASS / CI NOT RUN (EXPERIMENT)`. A derived `COMMERCIAL` or
`CRITICAL` repository enables exactly one manual, exact-head SourceCraft gate
immediately before merge: `STANDARD` for UI/text/safe client work or `RISKY`
for schema, auth, security, backend, runtime, CI and release changes.

The workflow is not a release route and must not deploy, publish artifacts or
run on schedule. It receives the exact reviewed source SHA, verifies that SHA
against the checked-out commit, records the result, and cannot be reused after a
new push. `RISKY` adds only checks proven relevant to the diff; it does not mean
all suites by default.

## Gate Contract

| Mode | Inputs | Required proof | Explicitly excluded |
| --- | --- | --- | --- |
| `STANDARD` | exact head SHA, scoped paths/risk hint | diff/scope review, typecheck, lint and relevant tests | deploy, automatic image/security scans unrelated to artifact |
| `RISKY` | exact head SHA, risk classification | STANDARD base plus only schema/auth/security/runtime-specific proof | a second paid gate for same SHA, production rollout |

Configuration tests must reject `push`, `pull_request`, scheduled development
triggers, missing exact-SHA linkage, ambiguous risk mode and a workflow that
tries to deploy. The risk classifier is an attention hint: uncertain work is
classified RISKY by the reviewer, not auto-merged by a label.

## Verification And Secrets

The template maps stable package scripts to checks only after their contracts
exist. It always includes a secret scan. Dependency scanning is enabled only
when a shipped dependency artifact is in scope; image scanning is enabled only
when a locally built image is in scope. Logs preserve exact SHA and safe check
outcomes, never credentials, full environment values or private URLs.

## Implementation And Evidence Map

| E07 guarantee | Target implementation | Required evidence |
| --- | --- | --- |
| starter remains zero-CI | SourceCraft config has no push/PR/schedule trigger | YAML/config negative tests; no SourceCraft run |
| derived project can gate exact head | manual workflow input/checkout/attestation chain | local positive and stale-SHA negative tests |
| scope follows risk | deterministic script map plus human RISKY fallback | config contract tests for STANDARD/RISKY selections |
| secret safety | required secret scan and safe log policy | fixture scan test without exposing a real secret |
| no accidental release | workflow has no deploy/publish action | config test rejects release actions |

The repository encodes `main` protection in `.sourcecraft/branches.yaml` with
`prevent_force_push`, `prevent_non_pr_changes` and `prevent_deletion`. The CI
file has no event block at all; its two workflows are callable only as manual
templates. Dependency audit is opt-in for a changed dependency artifact. Image
scanning is intentionally absent until a derived repository introduces an OCI
artifact and its scanner contract.

`scripts/ci/classify-risk.mjs` prints a conservative `RISK_HINT` from the
reviewed changed paths. It never selects a workflow or authorizes merge; the
reviewer remains responsible for the final STANDARD/RISKY decision.

This ADR authorizes no paid run and no change to a real derived project. E07 is
`RISKY` because it changes CI policy; delivery remains PR-only and never merges
automatically.
