# ADR-003: Safe PostgreSQL test foundation

**Status:** accepted

## Decision

Integration tests use a real native PostgreSQL 18 test database, never the
development or production target. Before any migration, seed or cleanup, the
harness must fail closed unless all of the following are true:

```text
APP_ENV = test
host = loopback
database name ends in _test
test role is distinct from development/runtime roles
host is not a production/managed target
```

The harness owns only its declared disposable test database. It may apply
migrations, pg-boss schema setup, neutral seed and deterministic cleanup there;
it must not reset, truncate or alter another database.

## Implementation contract

| Approved guarantee | E00A implementation boundary | E00A verification evidence |
| --- | --- | --- |
| Native PostgreSQL 18, not a mock | one `pnpm test:integration` entrypoint configures a real native connection | empty-database smoke completes against PostgreSQL 18 |
| Unsafe target is rejected before mutation | preflight validates `APP_ENV`, loopback host, `_test` name, dedicated role and production-host denylist | negative guard tests finish before migrate, seed or cleanup starts |
| Lifecycle is isolated and repeatable | only the declared disposable database receives migrate, pg-boss setup, neutral seed and deterministic cleanup | two clean runs produce the same result |
| Later epics get stable test identities | test role is separate from development and runtime roles; each mutable worktree database remains distinct | configuration assertion proves the separation |
| Foundation stays neutral | the harness adds no auth, RLS, command or async feature assertion | scope review records those assertions as E02--E06 work |

## Consequences

- `pnpm test:integration` becomes the one reusable entrypoint for this guarded
  lifecycle and real PostgreSQL assertions.
- Auth, RLS, command and async assertions are added by their own epics after
  the foundation is proven.
- Parallel worktrees require separate mutable `_test` databases.

## Evidence boundary

E00A implementation adds the guard, lifecycle and empty-database smoke. E00A
verification proves both rejected unsafe input and two deterministic clean runs.
