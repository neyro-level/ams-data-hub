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

E02 replaces the reusable bootstrap-password path with a one-time setup flow.
Until E02 implementation is delivered, the commands below are transitional
starter tooling only and must not be treated as a production provisioning
contract.

The target flow is:

```text
operator creates identity
→ one-time hashed setup token
→ user sets password
→ token is consumed and siblings are revoked
→ business principal becomes available
```

Platform Admin additionally requires verified TOTP for every authority-bearing
session. A user with several memberships must explicitly select an active
organization; selecting the first membership is forbidden.

The current commands remain subject to the E02 transition contract:

```bash
pnpm user:create -- --username <name> --name "<display name>" --system-role MEMBER
pnpm user:set-system-role -- --username <name> --system-role STAFF
pnpm user:add-to-organization -- --username <name> --organization ams-data-hub --tenant-role VIEWER
```

Any temporary password is a migration fallback only, must be passed through
stdin, and cannot bypass completion of one-time setup.
