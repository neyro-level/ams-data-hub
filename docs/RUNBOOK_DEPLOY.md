# Runbook Deploy

`ams-microsaas-starter` is a copy-source template, not a production target. Do not create a domain, VPS, production database, production secrets, rehearsal or live deployment for this repository. Its `release-check`, Docker, Compose and ops files are reusable starting material only; they are not approved evidence for a real release.

The E08 template contract separates build/runtime/migrator artifacts and binds a reviewed SHA to image and rollback digests. It is local reusable material, not a starter release route: see [`ADR-011`](adr/ADR-011-runtime-artifact-and-release-template.md).

After copying the starter into a product-owned repository, a derived app should use this sequence:

1. choose DELIVERY_PROFILE;
2. replace domain, legal data, env names and deploy host;
3. configure PostgreSQL and secret manager;
4. run `pnpm verify:quick`;
5. for risky/auth/schema changes run `pnpm verify:risky`;
6. replace the starter CI template with the project-owned manual exact-head gate and a single-build immutable artifact route;
7. record the current artifact digest and the previous rollback digest in durable storage;
8. deploy that exact artifact from the reviewed canonical `main` SHA without building on the production host;
9. smoke test `/api/health/live`, `/api/health/ready`, `/`, `/dashboard/`, `/admin/`.

The provided Docker Compose and ops files must be reviewed and adapted in the derived repository before a real production release. A green starter check cannot be reused as production attestation for the derived product.
