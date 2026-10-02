# Runbook Deploy

**Status:** Active extension. `05_RELEASE_CHECKLIST.md` owns derived-product
release readiness; this file provides reusable procedure detail.

`ams-data-hub` — project-owned эталонное приложение. Production identity:
`https://data-hab.ams24.ru`, server alias `ams-data-hub-deploy`, root
`/opt/ams-data-hub`, configuration root `/etc/ams-data-hub`.

Release separates web, worker and migrator images and binds the reviewed SHA to
their immutable SourceCraft Registry digests: see
[`ADR-011`](adr/ADR-011-runtime-artifact-and-release-template.md).

Canonical sequence:

1. choose DELIVERY_PROFILE;
2. confirm exact clean SourceCraft `main` and the green exact-head RISKY gate;
3. provision separate managed PostgreSQL identities and project-only secrets in
   Secret Master scope `ams-data-hub/prod`;
4. run `pnpm verify:quick`;
5. for risky/auth/schema changes run `pnpm verify:risky`;
6. run the manual SourceCraft `release` workflow once for exact `main`;
7. build and publish separate `runtime-web`, `runtime-worker` and `migrator`
   images once to `pkg.sourcecraft.tech`, retaining all three exact digests;
8. download `registry-manifest.json` from that workflow without rebuilding;
9. validate `ops/postgres/connection-budget.example.json` against the real managed PostgreSQL limit and capture provider backup evidence from `provider-proof.example.json`;
10. record current and previous immutable image references in
    `/opt/ams-data-hub/shared/release.env`;
11. from a clean local checkout of the same `main`, set
    `AMS_DATA_HUB_DEPLOY_HOST=ams-data-hub-deploy` and run
    `node scripts/deploy-production.mjs`; the host only pulls exact digests and
    never builds;
12. run `ops/release/live-proof.sh` from the trusted host for `/api/health/live`, `/api/health/ready`, `/`, `/dashboard` and `/admin`.

`ops/release/rollback.sh` is an application-artifact rollback template. It never reverses a database migration: a derived product must keep migrations forward-compatible or provide a separately reviewed data-recovery procedure.

The server must have Docker Compose and four root-owned mode `0600` files:
`/etc/ams-data-hub/registry.env`, `web.env`, `worker.env`, and `migrator.env`.
`registry.env` contains only `SOURCECRAFT_REGISTRY_PULL_PAT`; it is used for
`docker login` and never passed to application containers. The first release has
no application rollback image; database recovery remains a separate managed
PostgreSQL procedure.
