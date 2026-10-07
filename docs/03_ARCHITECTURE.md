# Architecture — AMS Data Hub

**Статус:** Active
**Platform contract:** AMS Application Platform Core 3.4 — Solo Minimal

## Delivery and project profile

```text
PROJECT_CLASS = STANDARD
DELIVERY_PROFILE = CRITICAL
TENANCY = multi-tenant
ASYNC = outbox-plus-queue
DATA = pii
DELIVERY = own-saas
PLATFORM_ADMIN = enabled
```

This repository is the product-owned Data Hub reference application derived
from AMS MicroSaaS Starter. Its production identity is
`https://data-hab.ams24.ru`; runtime target is SSH alias `ams-data-hub-deploy`, and
immutable images are published to the organization SourceCraft registry.
Production remains an explicit owner action and never follows a push or Pull
Request automatically.

## Source of truth

| Area | Authoritative source |
| --- | --- |
| Product scope | `01_PRD.md` |
| Screens, routes and flows | `02_PRODUCT_STRUCTURE.md` |
| Architecture, profile, security and data policy | this file and ADRs |
| Current schema and migrations | `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/` |
| Current work | `04_BACKLOG.md`; execution state is local Task Manager `.beads` |
| Release template | `05_RELEASE_CHECKLIST.md`, Docker/Compose and `ops/` |
| Final conformance, handover and rollback | `05_RELEASE_CHECKLIST.md`, `OPERATIONS.md` and ADR-014 |
| Exact versions | `package.json`, `pnpm-lock.yaml`, `.node-version`, Dockerfile |

The detailed `DATA_MODEL.md`, `SECURITY.md`, `ENVIRONMENT.md` and
`OPERATIONS.md` files remain justified extensions. They refine the area named
here and cannot override it. Visual rules belong only to `06_DESIGN_SYSTEM.md`.

## Module Map

The map records implemented module boundaries. Current work and remaining
operator/release decisions are recorded in the backlog and Task Manager.

### Remediation runtime state — 2026-10-07

The module map is foundation evidence, not production readiness. The approved
remediation program preserves these boundaries while connecting them:

- MP-02: explicit buffered media and single-use feed stream modes exist. The
  private raw spool hashes incrementally, uploads through a separately verified
  streaming storage capability and reopens bounded parser input. Source/adapter
  intake-policy binding uses the narrowest SourceSafety/adapter/hard ceiling
  for HTTP, spool and parser. Attempt reservation is capped at four leases and
  512 MiB total per worker process. MP-02.5 exercises a 188,960,772-byte
  synthetic XML through real filesystem/S3-adapter/parser paths with bounded
  buffers and cancellation regression; SDK/network remain mocked, not provider
  or production Source execution proof.
- MP-03/MP-04: concrete import orchestration and source queue/scheduler ports exist,
  with an explicit combined `source-worker` command, native schedule reconciliation
  and a durable manual-request dispatcher. Production Compose still selects
  `outbox-worker`; command composition is not production activation. Source has
  an opt-in read-only `source-healthcheck` against an exact-owner qualified
  heartbeat: startup reconciliation, active consumer lifecycle and an existing
  pg-boss connection/Source queue probe precede publication. A serial independent
  pump uses DB time; future/stale timestamps are nonhealthy. Observations expire
  after 120 seconds, and abrupt death may leave a row until TTL. Controlled stop
  waits for in-flight publication before exact-row removal. Guardian loss is
  fatal; consumer settlement starts the bounded cleanup watchdog. No schema or
  role grants expand, and existing outbox deployment/readiness stays unchanged.
  SourceExecutionService now provides scoped application orchestration and
  resolves registered descriptors, SecretRef, policy and Last Good before intake.
  Reference-owned intake resolves the endpoint lazily on the server through the
  existing SecretRef environment resolver and Safe Outbound gateway. Its response
  excludes final URL; initial/stream errors expose only fixed safe codes without
  causes. Jobs and DTOs carry scoped IDs, not resolved credentials.
  The service resolves executable parser/normalizer bindings by exact registered
  adapter/profile versions. Synthetic registry regressions cover YRL/Vladis,
  Domclick, Avito v3 and CIAN v2. Four-family PostgreSQL composition regressions
  prove persisted configuration through GOOD, changed hash/stable UID and broken
  input preservation with actual parser/spool/storage adapters. HTTP/SDK lower
  transport is mocked; this does not activate those families in production.
  Concrete server composition now binds scoped Prisma loading, reference-owned
  intake, raw spool/S3 capability, executable parsers, per-record normalization,
  bounded durable staging, Safety Engine and GOOD apply. Records are appended in
  batches capped at 100 records/4 MiB; semantic hashing reads sorted stored hash
  metadata rather than materializing a feed. GOOD, identities and Last Good
  commit together after fresh configuration/service/freeze checks.
  Project status/service changes take the shared safety lock before the UPDATE
  statement, avoiding FK/key-lock inversion. Legacy identity commands and Source
  apply share a source-scoped identity lock. YRL area units normalize to square
  metres; configured rental periods must resolve explicitly, otherwise validation
  rejects the record rather than manufacturing a canonical value. Missing-record
  grace is now revision-bound: only SAFE nonempty non-baseline GOOD runs advance
  absence; both run/time thresholds govern inactivation. Broken runs leave current
  identities, events and Last Good untouched; final transaction failures roll
  back lifecycle and GOOD together. GOOD also records an idempotent
  `snapshot.build.request` intent through the transaction-bound reliability
  repository. Its payload contains scoped IDs and the GOOD revision sequence,
  never raw data/endpoints. Enqueue failure rolls back GOOD/identities/pointer;
  publication is not performed in the import transaction. The default outbox
  worker claims only its registered maintenance topic; snapshot intents stay
  PENDING until a real executor is wired, not failed/completed by a noop handler.
  Snapshot build/publish
  execution remains MP-05/MP-08; scheduled source execution is implemented;
  service unit tests are not production composition proof.
- MP-05: `composeSnapshot` exists as a composer, not a completed DB-state
  application pipeline. Real 13-dataset projectors and pinned input resolution
  are implemented; full build/sign/publication orchestration remains pending.
  MP-05.1 implementation is closed at pushed checkpoint `a074033`; epic delivery
  remains pending. Forward-only input receipt/parts and project sequence
  persistence now exist. Receipts require all 18 private fact sections,
  transaction-bound inserts, immutable post-commit state, request/input hashes
  and bounded replay. A positive sequence is reserved atomically with capture;
  the scoped counter floors existing current/delivery/input sequences. Complete
  transaction-bound DB fact resolution is now composed by the private
  `captureSnapshotInput` command. It is not a public assembly/publication pipeline.
  Transaction-bound shared-catalog and Source fact readers capture the scoped
  subscription candidate closure and exact GOOD identity/hash membership,
  including historical grace facts. Profile configuration is pinned once per
  identity, not copied for every listing or loaded live during rebuild. Fact
  reads are SELECT-only under `snapshot-input`; Source mutation policies stay
  unchanged. The capture runner holds global-safety then project locks, checks
  fresh admission in a bounded authorized Read Committed transaction, and keeps
  every fact in the one outer Repeatable Read cut. This needs two available
  pool connections; acquisition is bounded and failure rolls back capture.
  No SECURITY DEFINER function or worker state-mutation grant is introduced.
  Project-state capture also pins scoped contact candidates, consented visible
  agents, editorial/media-order policy and persisted URL reservations/history.
  Catalog observation capture pins selected own-project prices as exact decimal
  strings and shared-media metadata without producer URLs/license text. Global
  catalog membership does not authorize foreign project observations.
  An additive restrictive RLS layer denies INSERT/UPDATE/DELETE by the
  `snapshot-input` job purpose on captured fact/publication-floor tables,
  independently of scope shape. Receipt/parts/counter writes and other existing
  job/admin purposes retain their previous policies. This closes legacy generic
  project-job write permissions; adding a SELECT policy alone was insufficient.
  Inventory media capture now pins scoped historical GOOD image membership,
  original repeated positions and complete allowlisted asset facts, not just
  mutable relation IDs. It checks Source.LastGood in the same cut and omits
  foreign/future/invalid mirrors; a cross-listing bounded buffer prevents early
  part-budget exhaustion. Inventory capture now uses pages of at most 200 pins,
  bulk scoped identity/head/fact checks and keyset-batched mirror queries.
  SQL returns at most 1 MiB of image arrays or small split markers; a shared
  32 MiB retained-URL budget covers current and historical memberships, with
  historical requests deduplicated per inventory/revision and released per page.
  This bounds retained representations, not process RSS. Native Source-to-media
  capture of 4100 image-less identities uses 64 raw SQL calls and passes the
  actual 30-second worker transaction. The complete command additionally captures
  4100 image-bearing identities and 8200 media positions within that unchanged
  transaction limit, then replays the persisted receipt.
  Object HEAD and public media projection are outside
  the DB capture transaction. Agent capture pins both assigned photo slots under
  ACTIVE/visibility/consent gates, using scoped asset facts and an explicit
  ASSIGNED_ASSET_ONLY marker; assignment is not approved feed-photo provenance.
  Shared observation capture pins exact scoped development/building mirror
  associations in page-batched queries, retaining eligible warning assets and
  rights markers without requiring XML revisions for manual imports. Its
  SHARED_OBSERVATION_MIRROR marker is not a GOOD feed claim. Public projectors
  must use captured observation rights and fail closed on missing feed provenance.
  The command persists all 18 sections atomically and creates a fresh builder
  per transaction retry. Native NOBYPASS tests prove immutable replay after live
  facts change, concurrent same-key capture, rollback and fresh freeze admission.
  Replay skips fact rematerialization, not the current admission check.
  `projectStateRevision` is the base Project version; captured version/value
  parts and their input hash identify the complete state. `catalogRevision`
  hashes captured catalog values, not a global sequence. Input capture alone is
  not full build proof; public projection and signing are described below,
  while publication remains pending. MP-05.2 implementation is closed.
  Five captured candidate-closure projectors emit
  strict geo/developer/development/building/price rows with explicit references,
  cross-parent checks, deterministic order and exact decimal strings. Input
  validation checks all 18 sections, part order/hashes, header/input digest and
  captured catalog digest before projection. Catalog coordinates retain their
  persisted seven-place precision; developer/development names and aliases
  accept persisted 200-character values. Observation source/external IDs and
  private catalog metadata are not copied into public values. Six additional
  pure project-state projectors emit contacts, captured-gated agents, editorial,
  persisted URLs, redirects and lifecycle. They reuse the existing editorial
  mapper/captured media-order policy and omit closed agents/personal editorial.
  Reservation IDs survive legitimate relinks; URL history/tombstones reference
  reserved IDs, not mandatory active entity rows. Lifecycle retains inactive
  state and events. Verified agent media is a server-owned input, not proof of
  HEAD or fresh consent. MP-05.2 supplied these 11 projectors; subsequent tasks
  below add subscription filtering, inventory GOOD resolution and verified media
  to the complete thirteen-dataset candidate. Fresh publication remains pending.
  Generated stored payload byte/record counts avoid repeated JSON sizing in
  deferred commit checks without removing either header/part constraint trigger,
  contiguity/budget checks, immutability or RLS. Native proof retains 4100 inventory
  pins, 8200 media positions and the original 30-second worker limit. Production
  table rewrite/lock rehearsal is a separately approved release prerequisite.
  The ingestion-owned server-only GOOD resolver reads exact captured scoped
  revision/UID/external/hash/sequence/profile pins in pages of at most 200. It
  recomputes the ingestion hash without draft provenance; live Source heads and
  the profile registry do not replace pinned data. A SQL 4-MiB page guard splits
  oversized pages before transfer, and malformed components return marker-only
  failures. Its allowlisted candidates remain INTERNAL, not public DTOs: address
  and coordinates use the captured location policy in the candidate projector
  described below. Full signed build/publication orchestration remains unfinished.
  GOOD resolution now excludes raw `draft.address` and private apartment fields
  from its result. Optional `addressPublic` passes bounded NFKC-aware unit
  redaction: explicit RU/EN unit components and exact captured apartment markers
  are removed; ambiguous surviving markers or forbidden normalized content fail
  closed. This is an address-unit boundary, not final location-policy/DTO proof.
  The inventory candidate projector checks exact verified identity/profile pins,
  normalizes property-specific sparse facts under captured unit/period rules,
  applies deterministic STREET coordinates and uses the persisted captured URL.
  Public DTOs omit private pins/invalid raw values and declare URL/media attachment
  references. Safe-HTML text-token cleanup removes the leading internal source
  code while retaining rich markup. Captured media admission now verifies
  inventory pins, agent assignment/consent and shared ownership before sequential
  project-bound HEAD outside DB. A build-local metadata-conflict-safe cache
  retains repeated positions; strict opaque attachments reference their owners.
  Server-owned candidate assembly now loads only persisted scoped receipts under
  the snapshot-input principal, preflights captured inventory URL/profile settings,
  performs HEAD outside DB, resolves immutable GOOD in pages of at most 200 and
  immediately projects public records. Exact thirteen-dataset references/privacy
  are checked; aggregate canonical array work is capped at 32 MiB including
  brackets and page-spanning separators. Captured subscription selection applies
  ALL_SHARED city scope or CURATED explicit INCLUDE, with EXCLUDE taking priority
  over confirmed listing links. ACTIVE, unmerged developments and developers
  determine the cohort; only ACTIVE, unmerged buildings survive. Geo anchors and
  selected dependencies remain; prices, shared media (before HEAD) and editorial
  follow selected owners. Inventory and persistent URL history are not pruned.
  No live subscription lookup or receipt/hash rewriting occurs.
  Inventory preflight also requires unique captured Source rows and exact
  approved-head ID/sequence membership. Historical GOOD facts may be older than
  the head but never newer; a missing/inconsistent head fails before object IO.
  Capture reuses ingestion's shared apply SAFE policy/count/baseline/hash predicate
  for heads and selected historical facts. Baselines are exact scoped immutable
  GOOD rows, same source and adjacent GOOD sequence. Per-cut cached lookups use
  pages of at most 200 pins; SQL rejects policy/analysis JSON above 4096 bytes each
  before transfer. Private value-free approval pins/hashes are correlated during
  preflight and excluded from public DTOs. Older receipts without this proof fail
  closed and require new capture, never live enrichment or hash rewriting.
  This is not signing/publication;
  MP-05.6 adds project-state-owned `ListingAgentBinding`: exact scoped GOOD
  revision, inventory UID and record hash, plus scoped Agent UID. The canonical
  `agent-matching` command replaces the complete revision assignment set in one
  transaction, not incremental pages. It accepts only trusted server evidence,
  bounds aggregate evidence/offer claims to 50000, and checks global DataSafety
  freeze under its mutation lock before the project matching lock. GOOD fact
  membership is checked in pages of 200; database trigger and scoped FKs reject
  foreign or forged pins. Snapshot capture is SELECT-only for these bindings.
  Binding capture starts from scoped assignment rows before the correlated
  historical fact lookup; it still requires the latest matching GOOD fact at or
  before the head. An older binding cannot replace a missing newer assignment.
  Captured exact-fact assignments publish `agentUid` and an agents reference only
  when the captured Agent passes ACTIVE/showOnSite/consent. An unresolved or
  ambiguous claim omits assignment; failed publication gate preserves inventory
  and omits the personal block/photo. Existing project contacts remain available.
  MP-05.7 computes `requiresProjectContact` from captured ACTIVE inventory: any
  listing without an eligible captured agent assignment requires the exact
  project/contacts row. Directory membership alone does not replace a listing
  relation. Missing/foreign contact fails before media HEAD with the existing
  fixed contact-required error. Candidate returns the derived flag for the
  composer, which repeats the same admission. Empty inventory and a wholly bound
  inventory set do not require fallback. No live contact enrichment or config
  copy is introduced; current publication admission remains separate.
  This does not automatically wire Source GOOD to matching or enable publication;
  fresh consent/rights/publication admission is not replaced by captured replay.
  MP-05.10 adds a server-only signed-build factory: strict scoped receipt lookup
  feeds the existing assembler, composer privacy/reference guards and SecretRef
  Ed25519 signer, then verifies against copied trusted/non-revoked key policy.
  Manifest headers are receipt-derived; sourceRevisions is the sorted unique
  union of approved captured GOOD heads and historical facts used by ACTIVE rows,
  capped at 10000. generatedAt/publishedAt use capturedAt as stable identity time;
  DeliveryRun.createdAt remains the delivery staleness clock. Factory-pinned
  key configuration is not cross-process publication idempotency: MP-05.11 must
  bind the signed identity durably before upload and enforce fresh admission.
  Signing alone does not upload artifacts, update current or register outbox work.
  MP-05.11 staging now binds immutable signed identity before PUT and checks
  receipt-owned Source/cohort anchors and project permission anchors in a short
  ReadCommitted cut under global then project-publication locks. Project checks
  enforce active service, unfrozen jobs, captured contact version and published
  Agent consent/version/photo slots and exact bindings without live enrichment
  or personal-value reads. Fact writers take global before target row/domain
  locks. Final publication repeats Source/Project/Catalog/Media admission after
  settled artifact and manifest PUTs in one short global -> publication cut,
  then atomically persists current and DeliveryRun. Exact committed replay
  precedes configuration/fresh capture and never regresses a newer pointer.
  The combined Source worker optionally registers the strict snapshot topic;
  active cancellation joins owned SDK work. Local synthetic PostgreSQL/pg-boss
  evidence is implementation proof, not live-provider or production activation.
  Implementation and exact-head epic delivery are closed in Task Manager.
- MP-06: ingestion sanitizer emits a branded portable `descriptionHtmlSafe`
  contract; public DTO/snapshot accept only its validated tag grammar, never raw
  markup or attributes. Strict `MediaPublicV1` excludes producer URLs and private
  storage coordinates. The inventory media query resolves current scoped GOOD
  image membership and same-scope mirrored assets, verifies storage HEAD outside
  transactions and rejects changes during IO. The internal authorized media
  reader repeats membership checks around bounded cancellable storage GET,
  verifies length/digest and image format, and never calls producer HTTP or
  legacy unbounded GET. Synthetic producer-OFF proof exercises GOOD/RLS,
  public projection, gzip snapshot composition and mirrored image bytes with
  only external transport replaced. This does not enable a browser route or
  a real storage provider. Complete snapshot orchestration,
  historical missing-grace fact selection and consent-gated agent projection
  are implemented by MP-05; remaining operations/API and readiness proof belong
  to MP-08–MP-10.
- MP-07: explicit immutable verifier policy now defines compressed/decompressed
  file, record-count and total-work limits. Factory configuration rejects unsafe
  overrides. Native gunzip has a finite output bound constrained by remaining
  compressed/decoded budget, including concatenated members. Fatal UTF-8,
  raw-before-Zod cardinality and fixed callback-error rejections retain last-good.
  Raw manifest shape bounds precede schema/crypto allocations; complete trust,
  scope, sequence, set, lengths and all-copy hashes precede any decompression.
  Private bounded copies prevent hash-to-use mutation. Adversarial regressions
  exercise signed bombs, huge JSON/counts, aliases, concatenated gzip, exact
  boundaries, key rotation/revocation and last-good. MP-07 delivery passed its
  exact-head gate and is recorded in Task Manager. Budgets are not callback/RSS limits.
- MP-08: admin requests atomically record a durable scoped request, audited
  idempotency response and an exact IDs-only operational outbox intent. The
  request survives settled-intent retention; mutable SUSPICIOUS admission never
  prevents replay of an already accepted request. Worker reads are exact-purpose,
  single-project and currently SELECT-only. Unsupported consumers reserve/defer
  all six topics. No operational executor is registered by this foundation;
  execution and HTTP discovery/delivery/ACK remain unfinished MP-08 work.
- MP-09/MP-10 own complete runtime and readiness proof. Until those gates pass,
  the closed historical v4 is not a PRODUCTION READY claim.

Allowed families are YRL/Vladis, Domclick XML, Avito v3 and CIAN v2. Producer
behavior is `SourceProfile`-owned; format behavior is `SourceAdapter`-owned;
project-specific branching in parser core is forbidden. Family approval is not
production activation. Manual newbuilding staging/reviewed-hash apply remains
the bounded capability in `DATA_MODEL.md`, without automatic ingestion.

| Boundary | State / first slice | Owns | Public boundary |
| --- | --- | --- | --- |
| `identity-access` | active | users, memberships, account setup, authentication administration | `contracts.ts`, `client.ts`, `server.ts`, `index.ts` |
| `project-registry` | active | organizations, projects, memberships and service state | `contracts.ts`, `server.ts`, `index.ts` |
| `platform-operations` | active | audit, idempotency, outbox, jobs and readiness | `contracts.ts`, `server.ts`, `worker.ts`, `index.ts` |
| `notifications` | active; DH-08.3 operational alerts | in-app delivery, feed/read state, scheduled alert detection and owner-delivery port | `actions.ts`, `server.ts`, `index.ts`; real owner recipient adapter stays disabled until configured |
| `platform-admin` | active | platform-wide resource views, summaries and admin queries | `contracts.ts`, `server.ts`, `index.ts` |
| `shared-catalog` | active; DH-03.1 geography foundation | regions, cities, developers, developments, buildings, provenance, revisions and project subscriptions | `contracts.ts`, `server.ts`, `index.ts` |
| `project-state` | active; DH-04/DH-07 | project contacts, agents and consent evidence, editorial fields, URL registry, redirects and lifecycle | project-scoped contracts plus server facade |
| `media-assets` | active foundation; DH-02.5, extended in DH-03 | validated admin intake, rights metadata, hashes, object references and ownership rules | `contracts.ts`, `server.ts`, `index.ts`; storage remains a platform port |
| `snapshot-delivery` | active foundation; DH-05.1–05.7 | deterministic datasets, manifests, signing, publication sequence, project delivery and ACK | composer/signature contracts, server-only SecretRef signer, immutable project storage, current-manifest pointer, persisted `DeliveryRun`, hashed project ACK credential and portable `packages/snapshot-verifier` |
| `ingestion-core` | active; DH-06/DH-07 and marketplace profiles | source registry, adapter/profile contracts, raw and normalized revisions, identity resolution, safety analysis and apply plan | adapter contracts plus project-job worker facade |
| `operations-control` | active; DH-08.1–08.4 | PII-safe fleet projections, idempotent audited operation requests, guarded data-safety controls and protected Exit Bundle orchestration | `contracts.ts`, `server.ts`, `index.ts`; requests do not imply executor completion; alerts go through `notifications` |
| `platform/*` | active platform layer | database, commands, auth, authorization, config, observability, safe outbound and storage ports | platform-owned APIs only |

Dependency direction is `app/components/worker → module public boundary →
application/domain`; infrastructure implements ports and never becomes another
module's public API. Cross-module imports may use only root facade/contract
files. Prisma stays in `platform/database` and module infrastructure. Safe
outbound, object storage and secret resolution remain platform adapters rather
than business modules. External side effects stay outside a business
transaction.

Remote feed and media HTTP is allowed only through
`platform/http/safe-outbound.ts`. The gateway pins the socket to a twice-checked
public DNS result, repeats the same policy after every redirect, bounds total
time and response bytes, and accepts only caller-declared content types. Direct
`fetch`, Node HTTP/TLS clients and alternative HTTP packages in `src` are
rejected by the architecture guard and Dependency Cruiser.

Secret-bearing configuration crosses application boundaries only as a
`SecretRef`. Its server-only resolver reads the value from the environment,
registers it for value-based log redaction and returns a branded server value
only to the consuming adapter. Browser/UI projections contain no reference name
or value. Structured logs additionally redact sensitive keys and complete feed
URLs, including values embedded in message text.

Internal IDs of project-owned tables are Prisma `cuid()` values. Shared entity
`uid` values are immutable uppercase ULIDs. A `publicUrlId` is a 16-character
lowercase Crockford Base32 value reserved per project; reservation rows are
immutable and retained, so an identifier cannot be reused. Better Auth-owned
identity tables keep provider-generated IDs.

`packages/data-contracts` and `packages/realty-contracts` are private,
project-owned workspace packages. They provide strict Zod schemas,
`schemaMajor/schemaMinor`, deterministic canonical JSON and a runtime-branded
public DTO mapper. Downstream delivery uses pinned vendored schema/release
artifacts; package registry publication requires a separate ADR.

## Data, tenancy and async direction

The selected profile is intentional: a shared deployment can serve independent
organizations and needs an explicit tenant principal, server-owned organization
context, scoped repositories, tenant-aware constraints and isolation tests.
RLS is an additional PostgreSQL protection layer, not a replacement for
authorization; its policy and runtime-role design are implemented in E03.

`outbox-plus-queue` is retained because durable business delivery, replay and
integration journaling require durable state. Data Hub owns the worker and
consumer contracts; production enablement follows the explicit release and
operator configuration. Outbox payloads are minimal,
versioned and secret/PII-safe; external delivery is after commit.

## Authentication and provisioning

The supported system roles are `PLATFORM_ADMIN` and `USER`. A `USER` requires
organization membership and an enabled client-access flag. The approved current
release grants Platform Admin authority through a fresh persisted session,
enabled user and `systemRole = PLATFORM_ADMIN`, followed by server-side
permission/resource checks. No TOTP is required by the current policy. OQ-09
is DEFERRED until an explicit post-pilot owner decision. A user with several
memberships must explicitly select the active organization.

The only bootstrap command is `pnpm admin:provision`. It accepts the password
through stdin, creates or resets a `PLATFORM_ADMIN`, revokes existing sessions
without introducing a current-release factor requirement. Account/password
recovery remains protected and audited. Legacy role and bootstrap commands are
transitional only. MP-01 removes the TOTP plugins, login challenge, principal
factor gate and obsolete environment requirement. A new forward migration drops
only unused factor persistence; accounts, sessions, setup/password recovery,
rate limits and runtime RLS grants remain. Actual unit, PostgreSQL and browser
regressions plus exact-head delivery evidence are recorded in Task Manager;
this auth transition does not imply completed Source/snapshot readiness.

## PII lifecycle

| Concern | Data Hub policy | Production obligation |
| --- | --- | --- |
| Inventory | account, membership, audit, notification and configured contact data are PII candidates | add domain fields before production |
| Access | server authorization; Platform Admin is explicit | define role/resource policy |
| Masking and logs | no secrets in browser/logs; avoid unnecessary PII in events | define field-level masking |
| Retention | operation records have retention boundary | set lawful durations and job policy |
| Export/deletion | no generic export/delete API is implied | define product flow and legal basis |
| Audit | security and significant admin operations are auditable | extend action taxonomy |
| Backup | product-owned managed PostgreSQL evidence and release rollback | define retention and complete restore proof before real data |

Legal requirements remain `REQUIRES_CHECK`; this matrix is an engineering
contract, not legal advice.

## Version matrix and verified exceptions

| Area | Installed exact version | Decision |
| --- | --- | --- |
| Node.js | 24.20.0 | Node 24 line; project exact version is pinned |
| Next.js | 16.3.8 | repository-pinned App Router 16.x |
| React | 19.3.0 | repository-pinned React 19 line |
| Prisma / adapter | 7.10.0 / `@prisma/adapter-pg` 7.10.0 | supported PostgreSQL adapter pattern |
| PostgreSQL target | 18 | guarded native integration and isolated restore proof |
| Better Auth | 1.7.7 | repository-pinned 1.7 line; upgrade requires separate verification |
| pg-boss | 12.30.0 | PostgreSQL queue; schema migration/runtime privileges stay separate |
| TypeScript | 6.0.3 | explicit project exception to Core 3.4's 5.9.x hold; no upgrade is implied |

Official compatibility checked on 2026-10-02:

- Next.js 16 upgrade/proxy guidance: <https://nextjs.org/docs/app/guides/upgrading/version-16>;
- Next.js 16.3.8 security release: <https://github.com/vercel/next.js/releases/tag/v16.3.8>;
- React 19.3 stable release: <https://react.dev/blog/2026/09/09/react-19-3>;
- Prisma 7 PostgreSQL adapter: <https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql>;
- Prisma 7/8 release status: <https://www.prisma.io/docs/orm/release-status>;
- Better Auth two-factor plugin: <https://better-auth.com/docs/plugins/2fa>;
- Better Auth 1.7.7 security release: <https://github.com/better-auth/better-auth/releases/tag/v1.7.7>;
- PostgreSQL 18 row security policies: <https://www.postgresql.org/docs/18/ddl-rowsecurity.html>;
- pg-boss runtime and queue contract: <https://github.com/timgit/pg-boss>;
- TypeScript 6 release notes: <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html>;
- TypeScript 6.0.3 stable release: <https://github.com/microsoft/TypeScript/releases/tag/v6.0.3>.

The TypeScript 6 exception is observational: it is retained because the exact
project toolchain is already pinned and no incompatible API has been found in
this scope. TypeScript 7 is a separate major migration and is intentionally not
mixed into the Next.js security update. A downgrade or further major migration is a separate RISKY task,
not an incidental hardening change.

## ADRs and revisit triggers

- [`adr/README.md`](adr/README.md) is the stable ID and status map.
- ADR-001 fixes the application-platform profile; ADR-005–ADR-011 and ADR-014
  retain the active security/runtime decisions.
- ADR-002, ADR-004 and ADR-013 are explicitly superseded and their IDs are not
  reused.
- ADR-012 retains cache-header, error and observability safeguards; its PWA and
  public-contact clauses were retired by DH-00.5. Revisit TypeScript only
  through a separately approved version task.
- ADR-015 fixes the per-project object-storage boundary. Its provider-level
  credential denial proof is required before an S3 adapter is enabled.
