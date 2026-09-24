# Auth

**Status:** Active extension. `03_ARCHITECTURE.md` owns the platform profile and
cross-cutting policy; this file owns the detailed starter auth contract.

Better Auth owns identity, password and session lifecycle.

## Login

Public login modal redirects successful users to `/dashboard/`. Public signup is disabled.

## Roles

- `PLATFORM_ADMIN` → platform owner;
- `STAFF` → platform staff/read operations;
- `MEMBER` → tenant user, requires organization membership.

## Provisioning

Users can be created in Platform Admin or by operator CLI:

```bash
pnpm user:create -- --username <name> --name "<display name>" --system-role MEMBER
pnpm user:set-system-role -- --username <name> --system-role STAFF
pnpm user:add-to-organization -- --username <name> --organization ams-start --tenant-role VIEWER
```

Password is exactly 8 printable characters and must be passed through stdin only.
