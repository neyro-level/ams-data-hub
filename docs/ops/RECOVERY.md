# Recovery

**Status:** Active extension. A derived product must add its own data and
integration recovery contract before production.

Starter-level recovery checklist:

1. confirm exact commit SHA and branch;
2. confirm database target is not unknown;
3. check `/api/health/live`;
4. check `/api/health/ready`;
5. confirm worker heartbeat and outbox health;
6. restore from latest verified PostgreSQL backup if data corruption is confirmed;
7. rotate affected secrets outside Git.

The reusable E08 material includes:

- `ops/release/rollback.sh` for exact previously recorded image identities;
- `ops/postgres/restore-smoke.sh` for an isolated disposable restore;
- `ops/postgres/provider-proof.example.json` for managed-provider evidence.

Artifact rollback does not reverse schema or data. A derived product must prove
forward-compatible migrations or document its own reviewed data rollback path.

Derived products must add their own integration and business-data recovery steps.
