# ADR-013: Clean-Room Product Derivation Proof

**Status:** Superseded; clean-room starter derivation is outside Data Hub product lifecycle

A derived product starts as a disposable copy of the starter, never by mutating the starter repository. The clean-room procedure creates a new Git identity, applies one sample neutral product identity, replaces every required placeholder through the E01 manifest, and verifies that no starter or legacy-product token, source remote, domain, runtime/service or migration identity remains outside deliberately excluded source history/documentation.

The smoke validates: copy-source checklist; product name/slug/origin/health service identifiers; environment registry; fresh migration ownership; branch policy; selected `DELIVERY_PROFILE`; optional-module decisions; Prisma generation; quick/unit/build checks. It then stops before domain, secrets, server, production database, paid CI or release setup.

| Guarantee | Required proof |
| --- | --- |
| no hidden source identity | tracked path/content scan and derivation verifier |
| independently owned repository | remote/branch/migration ownership assertions |
| installable foundation | disposable-directory install, Prisma generate, quick/unit/build |
| explicit product decisions | checklist for optional modules and delivery profile |
| no accidental production | guard confirms no secrets/host/deploy actions and records handoff boundary |

The 2026-09-26 disposable proof created a new local Git repository, replaced
product, runtime, artifact, asset and PostgreSQL-role identities, selected a
delivery profile and optional modules, installed 636 packages from the local
pnpm store, generated Prisma Client, passed quick checks and 46 unit tests, and
completed a clean Next.js production build. The directory was deleted after
the run; no remote repository, secret, database, paid CI or production target
was created.

The derivation directory is disposable and never committed; the test avoids machine-specific paths. E10 is `RISKY` if identity automation mutates repository metadata, otherwise its contract remains PR-only and does not publish a template service or product.
