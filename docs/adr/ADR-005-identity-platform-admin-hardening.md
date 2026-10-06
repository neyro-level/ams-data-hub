# ADR-005: Identity And Platform Admin Hardening Contract

**Status:** active, amended by owner 2026-10-06; MP-01 runtime transition pending
**Scope:** `PLATFORM_ADMIN = enabled`; product-owned identity contract; changes do not authorize production release.

## Decision

E02 keeps Better Auth as the sole owner of identity, password, session
and authentication lifecycle. AMS owns the current, server-created principal,
organization selection, authorization, provisioning state, recovery operations
and their audit evidence.

The 2026-10-06 owner amendment supersedes the earlier factor requirement:
current release TOTP is NOT REQUIRED, OQ-09 DEFERRED until an explicit post-pilot
decision. MP-01 removes the existing plugin, session factor gate and factor-only
recovery/schema. This ADR states the approved target, not completed removal.

The transition is additive and forward-fixable: new schema fields/tables are
introduced before an enforcement switch; legacy sessions and bootstrap access
are revoked only after an operator has completed and verified the replacement
flow. No public sign-up, social login, arbitrary role editor or MCP OAuth is
introduced.

## Invariants

1. Every protected request resolves the session and user from persistence, then
   builds a fresh server-owned `PrincipalContext`. A disabled user, an expired
   or deleted session, or a revoked membership is denied on the next request.
2. A `PLATFORM_ADMIN` principal requires a fresh persisted session, enabled
   user and explicit system role, then permission/resource authorization.
   No second factor is required in the current release. Platform Admin is never
   assigned a fake tenant.
3. A member with more than one active membership has no implicit first
   organization. The application requires an explicit, server-validated
   organization selection and revalidates that membership on every request.
4. Creating an account creates a random one-time setup token. Only its hash,
   expiry, purpose and consumption/revocation state are stored. Before a
   successful setup, business access is denied. Successful setup consumes its
   token and revokes all other active setup tokens for that identity.
5. The legacy eight-character bootstrap password is a temporary migration
   fallback only. It is not a provisioning contract and cannot grant business
   access until the one-time setup flow completes.
6. Platform Admin recovery uses one-time, hashed recovery material and an
   audited operator flow. It has no permanent public recovery endpoint; using
   recovery rotates or revokes account/password material and existing sessions.
   Factor reset/re-enrollment is excluded from the current release.
7. Sensitive authentication endpoints use PostgreSQL-backed, bounded rate-limit
   records. Trusted origins are exact, CSRF/origin protection remains enabled,
   and production refuses to start until the deployment supplies the exact
   `BETTER_AUTH_TRUSTED_PROXY_CIDRS` boundary. Forwarded IP data are accepted
   only through that boundary; the deployment must make the origin private from
   direct client traffic. Responses and logs expose safe error codes, never
   tokens, secrets or recovery material.

## Implementation And Evidence Map

| E02 guarantee | Target implementation | Required evidence |
| --- | --- | --- |
| Fresh principal; disable/revoke on next request | `principal-session` resolves persisted session/user; principal factory validates enabled user and selected membership; revoke paths delete/invalidate sessions | unit tests for disabled, expired/deleted session and revoked membership; PostgreSQL integration; auth E2E |
| No implicit tenant for multi-membership | explicit active-organization state, validated against current membership; no ordered-membership fallback | unit + PostgreSQL integration for zero, one and several memberships; E2E selection/change attempt |
| Current-release Admin without TOTP | compatible password/session configuration, fresh enabled principal and explicit role; no factor plugin or factor timestamp authorization | MP-01 unit, PostgreSQL integration and E2E accept authorized password-only Admin while denying disabled/revoked users and unauthorized resources |
| One-time account setup | hashed `account-setup` token state with expiry/used/revoked markers; command/API consumes atomically and revokes siblings | unit token lifecycle tests; PostgreSQL transaction integration; E2E denies dashboard before completion |
| No permanent bootstrap password | provisioning commands issue setup token rather than a reusable password; migration revokes fallback after setup | command tests and safe-log inspection; E2E verifies fallback cannot obtain business principal |
| Account/password recovery is deterministic | hashed one-time recovery state; protected audited operator flow, material/session rotation; no factor-specific reset/re-enrollment | MP-01 unit lifecycle tests; PostgreSQL integration; operator runbook dry-run without secret output |
| Persistent auth rate limits and safe network policy | PostgreSQL rate-limit repository; exact trusted-origin/proxy configuration; normalized public error contract | unit configuration/error tests; PostgreSQL concurrency integration; E2E throttling and safe-log inspection |
| Compatible Better Auth baseline | exact installed `better-auth` and adapter version checked against official documentation before schema/config change | version evidence, generated Prisma client, migration review, auth E2E |

## Data And Boundary Contract

- Auth-owned tables remain compatible with the installed Better Auth baseline;
  custom state is stored in explicitly named AMS tables or additive columns,
  never by modifying provider internals blindly.
- Setup, recovery and rate-limit values are stored as hashes or counters with
  expiry/consumption metadata. Raw materials appear once at controlled issuance
  and are excluded from logs, audit payloads and browser state.
- `organizationId` arriving from URL, form, API body or cookie is a selection
  request, not access proof. The server binds the final tenant only through the
  current membership.
- Authorization remains server-side: permission and resource checks follow
  principal construction. UI visibility is not evidence of access.

## Rollout And Recovery

1. Verify the installed Better Auth 1.7.x schema/configuration contract before
   writing the migration.
2. Use a new compatible forward migration for MP-01; never rewrite applied
   migration history. Preserve fail-closed password/session/role checks while
   removing unused factor state; production migration is a separate release step.
3. Bootstrap the first Platform Admin through a controlled operator flow:
   identity, role, one-time setup, protected account recovery material,
   then disable the bootstrap path.
4. If a transition defect occurs, use a forward fix or the audited one-time
   recovery procedure. Direct edits to auth tables are not the normal recovery
   route.

## Consequences

E02 is security-sensitive and remains `RISKY`. It requires unit, PostgreSQL
integration, auth E2E and safe-log evidence before its PR is eligible for
review. Operator provisioning uses `pnpm admin:provision` and the audited
recovery path. Credentials and recovery material remain outside Git; merge
and production authorization follow ADR-010 and the release checklist.
