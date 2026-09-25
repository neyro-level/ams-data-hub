# Release Checklist — derived product template

**Статус:** Active
**Applicability:** this starter itself is not a release target.

## Before a derived product may release

- [ ] Select `COMMERCIAL` or `CRITICAL` delivery profile and record it in the
      derived `03_ARCHITECTURE.md`.
- [ ] Replace starter identity, origin, legal data, service/artifact names and
      environment registry.
- [ ] Create a product-owned Secret Master scope and a separate database;
      starter credentials or database are never reused.
- [ ] Set production DB, migration and runtime identities; runtime has no DDL
      or `BYPASSRLS` privilege.
- [ ] Configure a manual exact-head SourceCraft merge gate; push and PR remain
      zero-CI.
- [ ] Build one immutable, non-root image from reviewed canonical `main` SHA;
      do not build on the production host.
- [ ] Document backup, restore, rollback digest, connection budget and trusted
      proxy policy.

## Proof before rollout

- [ ] Run only the risk-relevant local proof and the required exact-head gate.
- [ ] Verify migration plan, health/readiness and worker contract where async is
      enabled.
- [ ] Record commit SHA, image digest, runtime version and release timestamp.
- [ ] Perform live smoke for `/api/health/live`, `/api/health/ready`, public
      entry, workspace and Platform Admin where enabled.

## Rollback

- [ ] Stop rollout and retain the failed evidence.
- [ ] Roll back to a recorded prior immutable image; do not rebuild ad hoc.
- [ ] Restore data only through the product-owned recovery procedure.
