# Operations — AMS Data Hub

**Статус:** Active extension. `03_ARCHITECTURE.md` owns topology and policy;
this file owns executable local, deploy and recovery procedures.

## Local development

Canonical mode is Windows-native checkout plus native PostgreSQL 18.

- local database: `ams_data_hub_dev`;
- isolated test database: `ams_data_hub_test`;
- local URL: `http://127.0.0.1:3001`.

```bash
pnpm install
pnpm prisma:generate
pnpm dev:db:status
pnpm dev:start
```

## Production deployment

Identity: `https://data-hab.ams24.ru`, SSH alias `ams-data-hub-deploy`, app
root `/opt/ams-data-hub`, configuration root `/etc/ams-data-hub`.

1. Confirm clean exact SourceCraft `main` and the green exact-head RISKY gate.
2. Resolve project-only secrets from Secret Master; never print or copy values.
3. Run one manual release workflow and retain web/worker/migrator digests plus
   `registry-manifest.json`.
4. Validate PostgreSQL connection budget and provider backup evidence.
5. Record current and previous immutable references in the release environment.
6. Deploy from a clean checkout of the same SHA; the host only pulls images.
7. Run live/readiness/browser smoke and record proof.

Root-owned mode `0600` runtime env files are separated by web, worker, migrator
and registry concerns. Registry credentials never enter application containers.

## Recovery and restore

1. Confirm exact SHA, branch and database target.
2. Check live/ready endpoints, worker heartbeat and outbox health.
3. Roll back application artifacts to the recorded prior digest set.
4. Restore PostgreSQL only into an isolated target first; validate integrity,
   migrations and application reads before any approved cutover.
5. Rotate affected secrets outside Git and record the incident evidence.

Artifact rollback never reverses schema/data. Migrations stay forward-compatible
or require a separately reviewed data-recovery procedure.
