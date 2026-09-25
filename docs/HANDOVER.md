# Final Conformance And Derived-Product Handover

**Status:** Active extension  
**Repository role:** reusable copy-source starter; not a production target

This document closes the neutral hardening program without turning the starter
into a product or generator. Evidence is valid only for the exact clean Git SHA
printed by `pnpm verify:conformance`. A derived repository owns every later
product, infrastructure, legal and release decision.

## Guarantee-to-proof matrix

| Guarantee | Runtime/source owner | Executable proof | Bounded status |
| --- | --- | --- | --- |
| neutral identity and copy-source boundary | `starter.identity.json`, `DERIVATION.md`, E00/E01 | `pnpm verify:config`, `pnpm derive:smoke` | starter placeholders are intentional only while `mode=starter` |
| guarded native PostgreSQL test target | test environment guard, E00A | `pnpm test:integration` preflight and two clean cycles | local `_test` database only; never production |
| identity, tenant principal and RLS | auth/runtime transaction boundary, E02/E03 | integration matrix plus `pnpm verify:rls-coverage` | derived product must configure its own runtime roles |
| atomic commands, audit and idempotency | command/repository boundary, E04 | command unit and PostgreSQL rollback scenarios | product commands are added only in the derived repository |
| outbox-plus-queue reliability | platform operations worker, E05 | competing lease, retry, dead-letter and shutdown tests | shipped disabled-by-deployment until a product owns consumers |
| cross-contract database evidence | guarded integration runner, E06 | repeated forward/reverse `pnpm test:integration` | evidence is local and secret-free, not CI attestation |
| manual exact-head delivery gates | `.sourcecraft/*`, E07 | `pnpm verify:sourcecraft-policy` | starter is `CI NOT RUN (EXPERIMENT)` |
| immutable web/worker/migrator template | Docker/Compose/release scripts, E08 | `pnpm verify:release-template`, derived image inspection | no starter registry, server or published artifact |
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

- The starter intentionally has no production domain, server, registry,
  Secret Master project, database, backup or release authority.
- SourceCraft paid CI is not run for this `EXPERIMENT` repository. A derived
  `COMMERCIAL | CRITICAL` product activates exactly one manual exact-head gate.
- The last E08 local image inspection recorded 11 high/critical Debian base
  findings per image with no fixed version. This is dated residual evidence,
  not permission to release; the derived product rebuilds and rescans.
- Legal operator fields and optional-module decisions remain placeholders in
  starter mode and must be resolved before a derived product is published.

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

After the E11 PR is owner-reviewed and merged, use a clean canonical `main`:

1. record `git rev-parse HEAD`;
2. run `pnpm verify:release` with the guarded native PostgreSQL 18 test target;
3. run `pnpm derive:smoke`;
4. confirm `pnpm verify:conformance` prints the same final `main` SHA;
5. record `LOCAL PASS / CI NOT RUN (EXPERIMENT)` and close the E11 owner gate.

No step in this handover authorizes production.
