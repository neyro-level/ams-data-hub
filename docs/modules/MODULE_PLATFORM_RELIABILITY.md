# Module: Platform Reliability

## Назначение

Владеет audit, idempotency, transactional outbox, pg-boss transport, JobRun, leases, bounded retry/dead-letter, retention and readiness.

## Не входит в scope

Unregistered arbitrary jobs, Redis/broker, HTTP inside DB transaction, secrets/raw PII in payload/error/audit and infinite retry.

## Data ownership

AuditEvent, IdempotencyKey, OutboxEvent, JobRun, RuntimeHeartbeat and RetentionRun.

## Principal types

`platform-admin` for typed enqueue/retry, `platform-analyst` for allowed sync actions, `job` for handler execution, internal worker lease identity.

## Roles and permissions

Platform commands require explicit permission/target organization. Tenant users do not access outbox/job data.

## Commands

Enqueue, claim, complete, fail, retention and readiness operations. Enqueue atomically creates idempotency marker + OutboxEvent + AuditEvent.

## Queries

Outbox health counts, worker heartbeat/integration freshness and Platform Admin operation views.

## DTO

Versioned bounded payload, safe error code, correlationId, timestamps and counts. No secrets, raw provider bodies or PII payloads.

## Invariants

- same idempotency key + same hash returns original event;
- same key + different hash is conflict;
- only lease owner completes/fails;
- runtime pg-boss does not perform schema DDL;
- retries are bounded; permanent/exhausted failure becomes DEAD_LETTER;
- application OutboxEvent/JobRun remain business delivery truth.
- successful `send()` completes dispatch even when it returns null for a duplicate; no immediate arbitrary fetch follows send;
- readiness uses only the throttled persistent outbox-worker heartbeat for worker liveness.

## Tenant behavior

organizationScope is explicit organizationId or `platform`; JobPrincipal organization must match event/target.

## Resource authorization

Calling command proves permission and target resource before enqueue. Worker validates topic payload and tenant scope again.

## State lifecycle

Outbox: PENDING → PROCESSING → PROCESSED or retry PENDING/DEAD_LETTER. JobRun records every attempt. Retention removes only eligible terminal detail.

## Concurrency

Conditional claim + lease owner/time prevents double completion. Stale PROCESSING event may be reclaimed under policy.

## Idempotency

Canonical JSON hashing, unique scope/organizationScope/key and idempotent handlers.

## Audit

Enqueue and admin retry write safe markers. Payload and error redaction is mandatory.

## Events / Async policy

Current topic: `project.sync.requested`. Outbox is persisted in business transaction; persistent worker publishes with `singletonKey = outboxEventId`, and the later handler reads only `job.data.event` outside transaction.

## Integrations

PostgreSQL, pg-boss and pino. pg-boss uses separate pool/schema migration lifecycle.

## Failure behavior

Invalid/unknown topic → permanent dead-letter; retryable error → exponential backoff up to five attempts; readiness exposes degradation without misreporting DB outage.

## Tests

Atomic counts, duplicate/conflict, lease ownership, retry/backoff, dead-letter, JobRun attempts, retention, readiness and clean migration path.
