# ADR-008: Outbox-Plus-Queue Reliability Contract

**Status:** implemented and locally verified in E05
**Scope:** neutral `outbox-plus-queue` foundation; no product provider or schedule is added.

## Decision

Data Hub preserves the outbox-plus-queue model. A business command writes a
minimal, versioned `OutboxEvent` in the same transaction as state, audit and
idempotency. Only after commit may a long-lived worker claim that event and
enqueue/execute an asynchronous delivery. The system is at-least-once; every
consumer is idempotent and receives a server-owned scope and correlation ID.

The typed outbox registry contains platform smoke and explicitly registered
Data Hub source/delivery topics. Adding a business topic requires its scoped
contract, idempotency policy and tests. Queue payloads are untrusted input and are
validated again by the worker. They contain no secret and no unnecessary PII.

## State And Ownership

```text
PENDING → PROCESSING → PROCESSED
                    ↘ retryable failure → PENDING
                    ↘ terminal failure → DEAD_LETTER
```

- Claim is atomic and assigns one lease owner (`workerId`) plus `lockedAt`.
- A worker may complete/fail only its current lease. A stale owner cannot finish
  work after takeover.
- Lease expiry permits a single controlled takeover; every attempt produces one
  `JobRun` with a correlation ID.
- Retry is finite, classified and bounded by the topic policy. Exhaustion writes
  one terminal `DEAD_LETTER` state and one deduplicated safe platform
  notification.
- A supported but not yet executable reserved intent, or busy Source dispatch,
  is lease-bound deferred to PENDING with a JobRun DEFERRED marker. It is neither
  PROCESSED nor DEAD_LETTER. A durable deferral count excludes these attempts
  from executor failure budget without resetting unique delivery ordinals;
  operational JobRun retention cannot consume that budget later.
- Same idempotency key plus same payload returns the prior deterministic outcome;
  the same key plus changed payload is `IDEMPOTENCY_CONFLICT` and creates no new
  delivery.

## Worker And pg-boss Contract

1. The worker starts as a long-lived process with a unique runtime identity,
   signal-aware intake stop, bounded drain and final heartbeat/readiness update.
   It never silently abandons an acknowledged lease: shutdown either completes,
   records a classified failure, or leaves a lease that is demonstrably eligible
   for takeover.
2. `pg-boss` owns its schema. A controlled migration-capable step creates or
   upgrades that schema; runtime worker uses `migrate: false` and does not get
   DDL privileges. This uses the E03 `worker` runtime identity.
3. Heartbeat is renewed only while the worker is able to claim/process work.
   Readiness reports database/queue availability and backlog/dead-letter state
   with safe codes, not credentials or payloads.
4. Retention removes only policy-expired operational rows, records counts and
   outcome in `RetentionRun`, and does not erase live leased or required audit
   evidence.

## Implementation And Evidence Map

| E05 guarantee | Target implementation | Required evidence |
| --- | --- | --- |
| Atomic enqueue | E04 command writes outbox/idempotency/audit via one transaction | PostgreSQL rollback test: enqueue failure and business failure leave no partial rows |
| No double completion | atomic claim plus worker, attempt and lease-time fencing on takeover/settlement | PostgreSQL concurrency test with two workers and takeover |
| Idempotent delivery | request hash and topic consumer idempotency key | same-key/same-payload replay test; changed-payload conflict test |
| Bounded recovery | topic registry carries finite retry/backoff/expiry policy | retry tests and one dead-letter notification assertion |
| Safe shutdown | worker lifecycle controller, bounded active-handler drain and handoff-safe lease state | signal/lifecycle tests; acknowledged-work proof |
| Observable runtime | heartbeat, ready check and retention evidence repositories | readiness/heartbeat tests and retention integration proof |
| No runtime DDL | pg-boss migration ownership and E03 role grants | migration/ACL test shows runtime worker cannot create/alter/drop |

## Boundaries

Provider retry policies and schedules require an explicit owned contract;
this reliability decision alone does not enable an external provider.
External HTTP, email, storage or AI calls execute only in a consumer after the
business transaction commits. A consumer failure records a safe code; raw
payloads, secrets and provider responses stay out of public errors and audit
markers. E05 implementation is `RISKY` and waits for merged E03/E04 database
and command work before its shared runtime wiring.

## Local Verification

E05 proof covers atomic competing claims, stale-lease fencing (including a
reused worker identity), transactional takeover rollback, idempotency conflict,
bounded retry and one dead-letter notification, heartbeat/readiness, runtime
DDL denial, retention, and graceful worker shutdown. The evidence is executable
in `tests/integration/outbox-reliability.integration.test.ts` and
`tests/outbox-worker.test.ts`. Local evidence is not release attestation;
current merges use the exact-head manual gate in ADR-010 and production
requires separate explicit authorization.
