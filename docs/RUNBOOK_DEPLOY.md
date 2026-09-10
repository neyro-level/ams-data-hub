# DEPLOY RUNBOOK

Release unit: immutable OCI image + Docker Compose + host Nginx. Merge, image build and deploy are separate owner-gated steps.

## Scope

Manual production deploy of reviewed canonical `main`. This runbook does not authorize deploy without an owner command.

Repository assets use Linux host networking: web binds `127.0.0.1:3000`, and database/backup operations use the approved self-managed PostgreSQL 18 topology. Managed PostgreSQL is not a release target for this project.

## Preconditions

- current branch = clean local `main` fast-forwarded to `origin/main`;
- exact commit SHA reviewed and Merge Gate green;
- Docker Engine + Compose available on the target;
- required web/worker/migrator/backup env files exist on target;
- Docker runs on Linux with host networking so loopback-only PostgreSQL remains reachable from application containers;
- no secret value is printed;
- rollback target and current symlink readable.

## Build artifact

```bash
pnpm release:build
```

Artifact contains:

- `docker-image.tar` built outside production host;
- `docker-compose.production.yml`;
- reviewed `ops/` assets;
- `release-manifest.json` with exact SHA, image tag, image digest and lock checksum.

Artifact does not require host install/build and does not include local DB data or secrets.

## Target preparation

Deploy script:

1. uploads artifact/checksum;
2. verifies checksum and manifest SHA;
3. rejects an existing target release directory and in-place rebuild;
4. verifies all protected env files;
5. loads the OCI image with Docker on target;
6. verifies loaded image digest against the manifest;
7. validates compose config under the fixed project name `ams-seo-monitor`, shared by deploy checks and systemd;
8. installs backup/restore scripts;
9. runs the pre-migration backup as the `postgres` OS user, then requires offsite upload + HEAD confirmation;
10. resolves the immutable backup file behind `latest.dump`, mounts that exact file read-only, waits for first-run PostgreSQL initialization to finish, then restores it in an ephemeral PostgreSQL container;
11. runs `migrate` container with Prisma + pg-boss schema migration;
12. never imports operator configuration; migrations are the only automatic database change;
13. installs reviewed Nginx/systemd assets.

Any failure before symlink switch leaves the current code runtime untouched. The mandatory backup and restore smoke run before migration because code rollback does not reverse database changes.

## Cutover

After successful preparation:

1. arm post-switch rollback trap;
2. atomically switch `current` symlink;
3. atomically write root-owned `shared/release.env` with exact SHA, image tag and image digest;
4. `systemctl daemon-reload`;
5. validate and reload Nginx;
6. restart compose stack through `seo-monitor-web.service`;
7. run scheduled sync once;
8. enable sync, outbox-retention and backup timers;
9. verify web and worker containers use the exact image digest from manifest;
10. require loopback live/ready DTOs to report exact target SHA, ready DB/auth, typed outbox counts, worker heartbeat and integration freshness;
11. record previous release and deployed SHA;
12. remove uploaded temp artifact/checksum.

## Post-deploy smoke

Required:

- public `/` = 200 and canonical metadata;
- `/api/health/live` = 200, valid correlation ID and exact deployed SHA;
- loopback `/api/health/ready` = 200, same SHA, PostgreSQL ready, auth configured, queue status, worker heartbeat and freshness DTOs;
- external `/api/health/ready` = 403;
- unauthenticated `/analyst/` redirects to `/?login=1`;
- analyst sign-in and report read work;
- client cannot read foreign project/site/report;
- web and worker containers use the same image digest;
- scheduled sync succeeds and DB timestamps/status are credible;
- retention timer and backup timer active;
- latest backup has confirmed offsite object.

Do not paste response bodies containing user/report data into public logs.

## Automatic code rollback

Any post-switch command error triggers:

- restore previous `current` symlink;
- restore previous compatible Nginx/systemd assets;
- restart previous compose/service topology;
- restore `shared/release.env` to previous release SHA + image digest.

Rollback does not reverse PostgreSQL migrations/data. Migrations must stay backward-compatible or have an explicit recovery decision.

## Production proof

Record outside source docs:

- deployed SHA;
- artifact checksum;
- image tag + digest;
- service/timer states;
- health/auth/isolation smoke results;
- migration state;
- backup/restore result;
- rollback target.
