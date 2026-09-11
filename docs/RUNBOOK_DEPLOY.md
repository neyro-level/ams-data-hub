# Runbook Deploy

Production release is not part of the starter conversion. A derived app should use this sequence:

1. choose DELIVERY_PROFILE;
2. replace domain, legal data, env names and deploy host;
3. configure PostgreSQL and secret manager;
4. run `pnpm verify:quick`;
5. for risky/auth/schema changes run `pnpm verify:risky`;
6. build an immutable artifact with `pnpm release:build`;
7. deploy from exact reviewed `main` SHA;
8. smoke test `/api/health/live`, `/api/health/ready`, `/`, `/dashboard/`, `/admin/`.

The provided Docker Compose and ops files are templates. They must be reviewed before a real production release.
