# ADR-007: Command Atomicity And Repository Boundary

**Status:** accepted for E04 implementation
**Scope:** business mutations in the neutral starter; no product-specific CRUD engine.

## Decision

Every business mutation follows one command path:

```text
action/API boundary
→ fresh server principal
→ input validation
→ defineCommand authorization
→ one transaction with E03 DB context
→ repositories
→ business state + audit + outbox/idempotency
→ commit
→ cache invalidation / typed result
```

`defineCommand` is the only application-level mutation primitive. It opens the
transaction after validation and authorization, applies the server-owned E03
database context before protected SQL, and passes the transaction explicitly to
repositories. A command has no global Prisma client and no direct external I/O.

Modules expose public application entrypoints only. Cross-module consumers call
those entrypoints or declared ports; they do not import another module's
Prisma repository or internal persistence model.

## Transaction Contract

1. A command authorizes against a typed `PrincipalContext`, not client-supplied
   role or organization data.
2. The command's transaction contains every business write, optimistic-version
   check, audit event, idempotency state and outbox record that describe that
   mutation. Any failure rolls the whole unit back.
3. Audit/outbox repositories receive the same transaction handle as the
   business repository. A second independent transaction is forbidden.
4. Cache invalidation happens only after a successful command result reaches
   the action boundary. It cannot precede commit.
5. Email, HTTP, storage and provider calls are forbidden inside a transaction.
   A command records an outbox item; worker processing performs the side effect
   later. This rule also applies to retries.
6. A stale version, missing record or RLS denial becomes a safe typed error
   code. Raw database/provider messages and sensitive values do not cross the
   action/API envelope.

## Repository And Module Contract

- `domain` and `application` import ports and DTOs, never Prisma or Next.js.
- Prisma is confined to `platform/database` and module `infrastructure`.
- A repository constructor accepts a transaction/scoped DB for a mutation; its
  return value is a DTO or application/domain projection, never a Prisma model
  as a public API.
- Read paths use a server principal and E03 scoped DB when tenant data is read.
  Platform reads remain explicit and cannot masquerade as tenant reads.
- `project-registry` is the reference migration: domain contracts → application
  commands/ports → Prisma infrastructure → public module entrypoint.
- Identity, project and reliability mutations must converge on this contract;
  legacy direct global-Prisma writes are removed or routed through a command.

## Error And Staleness Contract

| Condition | Public result | Persistence behaviour |
| --- | --- | --- |
| invalid input | stable `*_INPUT_INVALID` code with field errors | no transaction/write |
| unauthenticated/disabled | stable auth code and correlation ID | no command write |
| unauthorized/RLS denied | stable forbidden/not-found-safe code | transaction rolls back |
| optimistic version mismatch | stable stale/not-found-safe code | no partial state, audit or outbox |
| duplicate idempotency key | existing deterministic command outcome | no duplicate business state/outbox |
| internal failure | safe `*_FAILED` code and correlation ID | transaction rolls back; detailed cause stays server-side |

## Implementation And Evidence Map

| E04 guarantee | Target implementation | Required evidence |
| --- | --- | --- |
| DB authorization context exists for every mutation | `defineCommand` invokes E03 transaction-context helper before repository access | unit test order; PostgreSQL integration rejects missing context |
| state, audit and outbox are atomic | transaction-bound repository factory and shared transaction handle | integration failure injection proves no partial rows survive |
| no unrestricted write path | project-registry and remaining writers move to application ports/infrastructure | architecture check rejects global Prisma in mutation application code |
| cross-module access uses public APIs | module exports and import boundary rules | Dependency Cruiser/static import tests |
| stale/error policy is uniform | shared typed command/action error mapping | command unit tests and safe-log inspection |
| no external I/O in transaction | mechanical import/call guard plus outbox-only dispatch | negative static tests and rollback proof |

## Consequences And Sequencing

E04 implementation follows the merged E03 database-context work; schema, auth
and command changes are not stacked in separate unmerged worktrees. E05 may
consume the outbox only after E04 proves atomic enqueue. The change is `RISKY`:
it needs architecture checks, command unit tests, PostgreSQL transaction tests
and explicit rollback evidence before PR review.

## Verification Record

The E04 implementation was verified on the epic branch after the merged E03
runtime context became its base. Evidence produced by the task-scoped checks:

- dependency rules and static architecture guards pass with no violations;
- command unit tests prove validation and authorization happen before the
  single injected transaction is opened;
- isolated native PostgreSQL integration tests prove an audit failure rolls
  back the business write;
- idempotency, outbox and audit rows commit together, while a duplicate request
  reuses the original outbox result;
- typecheck, lint, unit, documentation and the complete integration suite pass.

This record is verification evidence only. It does not authorize merge or a
production release; E04 remains `PR_ONLY`.
