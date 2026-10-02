# Final Conformance And Derived-Product Handover

**Status:** Active extension
**Repository role:** product-owned reference application and reusable copy-source

This document closes the Data Hub hardening program. Evidence is valid only for
the exact clean Git SHA printed by `pnpm verify:conformance`. Data Hub owns its
production identity and infrastructure; every future derived repository owns
its own product, legal and release decisions.

## Guarantee-to-proof matrix

| Guarantee | Runtime/source owner | Executable proof | Bounded status |
| --- | --- | --- | --- |
| neutral identity and copy-source boundary | `starter.identity.json`, `DERIVATION.md`, E00/E01 | `pnpm verify:config`, `pnpm derive:smoke` | starter placeholders are intentional only while `mode=starter` |
| guarded native PostgreSQL test target | test environment guard, E00A | `pnpm test:integration` preflight and two clean cycles | local `_test` database only; never production |
| identity, tenant principal and RLS | auth/runtime transaction boundary, E02/E03 | integration matrix plus `pnpm verify:rls-coverage` | derived product must configure its own runtime roles |
| atomic commands, audit and idempotency | command/repository boundary, E04 | command unit and PostgreSQL rollback scenarios | product commands are added only in the derived repository |
| outbox-plus-queue reliability | platform operations worker, E05 | competing lease, retry, dead-letter and shutdown tests | shipped disabled-by-deployment until a product owns consumers |
| cross-contract database evidence | guarded integration runner, E06 | repeated forward/reverse `pnpm test:integration` | evidence is local and secret-free, not CI attestation |
| manual exact-head delivery gates | `.sourcecraft/*`, E07 | `pnpm verify:sourcecraft-policy` | Data Hub uses one CRITICAL RISKY gate |
| immutable web/worker/migrator release | Docker/Compose/release scripts, E08 | `pnpm verify:release-template`, registry digest inspection | production host never builds |
| UI, PWA, private-cache and safe-error boundary | routes, service worker and observability, E09 | unit/security/build/E2E in `pnpm verify:release` | browser/live proof repeats for the derived product |
| clean-room product derivation | disposable copy, E10 | `pnpm derive:smoke` | verification copy is deleted and never published |
| final docs/runtime agreement | this matrix and E11 verifier | `pnpm verify:conformance` | final `main` SHA proof occurs only after owner-approved merge |

## Verify command matrix

| Intent | Command | Evidence |
| --- | --- | --- |
| fast static contract | `pnpm verify:quick` | policy, config, typecheck, lint and architecture PASS |
| database/security composition | `pnpm test:integration` | two clean PostgreSQL 18 cycles and local JSON evidence |
| UI/runtime regression | `pnpm test:e2e:run` | Playwright route and viewport scenarios PASS |
| local release-equivalent candidate | `pnpm verify:release` | daily suite, conformance SHA and Node runtime PASS |
| independent copy-source proof | `pnpm derive:smoke` | disposable derived repository install/test/build PASS |

`verify:release` does not publish, deploy or start Docker. Container rebuild and
inspection are repeated only by a derived product when its release artifact is
actually in scope.

## Known bounded exceptions

- The first Data Hub release has no previous application image for rollback;
  subsequent releases must retain the prior immutable digest set.
- Production readiness is not inferred from local checks: it requires one
  green exact-head RISKY gate, one exact-main registry build and live proof.
- Managed PostgreSQL backup/restore evidence remains provider-owned and must be
  captured before valuable production data is accepted.

## Derived-product handover

1. Copy a reviewed clean starter SHA into a new repository; do not mutate this
   repository into the product.
2. Complete `starter.identity.json`, legal data, product domain and optional
   module decisions, then run `pnpm derive:verify` and `pnpm derive:smoke`.
3. Choose `COMMERCIAL` or `CRITICAL`; configure protected `main` and one manual
   exact-head SourceCraft gate.
4. Create product-owned Secret Master, PostgreSQL 18 database/runtime roles,
   migration ownership, connection budget, backup and restore proof.
5. Add product entities and integrations only behind the existing command,
   repository and worker boundaries.
6. Build non-root immutable web, worker and migrator images from reviewed
   canonical `main`; record digests and a rollback unit outside the app host.
7. Complete the release checklist and browser/live smoke. Production remains a
   separate explicit owner command in the derived repository.

## Final-main closure

After the PR is owner-reviewed and merged, use a clean canonical `main`:

1. record `git rev-parse HEAD`;
2. confirm the green exact-head SourceCraft RISKY gate for the merged ancestor;
3. confirm `pnpm verify:conformance` prints the final `main` SHA;
4. run one manual SourceCraft `release` workflow for that exact SHA;
5. deploy only the published `image@sha256` references and record live proof.

Production requires an explicit owner release command.
