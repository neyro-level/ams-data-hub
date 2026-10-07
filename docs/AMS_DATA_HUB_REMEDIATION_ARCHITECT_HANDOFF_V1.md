# Remediation architect handoff — AMS Data Hub

Date: 2026-10-06
Plan: AMS-DATA-HUB-REMEDIATION-2026-10 v1 APPROVED by owner
Mode: PLAN / Task Manager graph preparation; not implementation completion.
Source: `../AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.md`
SHA-256: `d3d0bc7df74ac36e3f91260b806ec6dc94beca50c9ece88d074d8a80169fcd1a`
Inventory: `AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.inventory.json`
Audit baseline: `4f2224b4996bceabc1bb28ed139f68a94b67d48d`

## VERIFIED

The exact owner source was read in full. Inventory schema version 2 contains
11 epics, 75 implementation tasks and 11 delivery tasks: 97 managed nodes.
The existing Task Manager helper's Validate actually passed: coverage 11/11,
DECLARED, 86 tasks, exact source SHA above; no missing dependencies or cycles.
This is graph validation, not evidence that any remediation task is complete.
Import, Reconcile, claim and live execution status belong to Task Manager.

Task Manager registration on 2026-10-06: Import CREATED 97 nodes; its actual
post-import Reconcile is CLEAN (11/11 epics, 86 tasks, 97 managed; missing IDs,
unexpected IDs, drift and cycles are all empty). No remediation implementation
task was closed by this registration. The completed v4 source remains unchanged.

Historical `AMS-DATA-HUB-IMPLEMENTATION-2026-01 v4` and its `dh-*` nodes
remain a closed historical delivery program. The new source does not modify or
reopen that approval artifact. New stable IDs resolve as `adh-mp-00-1`, etc.
`MP-06A/B` source sections map to `mp-06.1/.2`; Scenario A–G map to
`mp-09.a–g`; 10.1–10.6 map to `mp-10.1–6`. `mp-10.7` explicitly
owns mandatory regression guards from source section 3.

## Architectural dependency decisions

Initial implementation ready set: `mp-00.1`, `mp-00.2`, `mp-00.3`;
`mp-00.4` consolidates all three before MP-00 delivery.

Five waves remain the controlling milestones:
1. MP-00 canon and MP-01 current TOTP removal.
2. MP-02 bounded safe intake, MP-03 concrete source composition, MP-04 worker.
3. MP-05 real snapshot, MP-06 public contracts/media, MP-07 bounded verifier.
4. MP-08 operation executors and project delivery API.
5. MP-09 complete runtime scenarios and MP-10 readiness proof.

The graph does not flatten the permitted independent work. After canon delivery,
MP-02 intake, MP-06A safe HTML, MP-06B public media contract and MP-07 verifier
can start independently of TOTP and source runtime. These are preparation
branches, not permission to skip later wave completion.

MP-06 delivers independently from canonical main: its public media projector
reuses existing media pipeline/catalog/composer facades, not unmerged MP-05
dataset-projector ranges. Its producer-host independence proof uses that real
existing public boundary with synthetic fixtures. The final assembled pipeline
is subsequently covered by MP-09. MP-05 starts only after MP-06 delivery and
MP-04 delivery. Compose/sign also waits on the bounded verifier. This ordering
avoids both task cycles and a cross-epic delivery dependency on unmerged work.

Reuse the existing modular monolith, adapters/profiles, command transaction,
tenant/RLS, outbox, pg-boss, storage, signing and ACK boundaries. Source-specific
behavior remains profile-owned, format behavior adapter-owned. External HTTP,
S3 and publication effects never run inside business DB transactions.

## Owner decisions and operational limits

Current TOTP removal is already approved; it is not a new owner blocker.
Four feed families, manual reviewed-hash newbuilding apply and strictly
sanitized `descriptionHtmlSafe` remain approved. REALTY LITE implementation is
outside this repository/task.

Each delivery card requires one reviewed exact-head manual SourceCraft RISKY
Gate, `run_build=true` and relevant unit/integration inputs before merge.
Push/PR stay zero-CI. Canonical main is SourceCraft; GitHub remains one-way mirror.

No graph card authorizes staging/production deployment, production migration,
real feeds/PII, new secrets/provider credentials or remote server mutation.
MP-09's “real” means actual application composition and runtime entrypoints,
using synthetic HTTPS fixtures, isolated local PostgreSQL/pg-boss and approved
non-production storage, not test-only dependency injection.
Provider S3 isolation, real feeds or remote backup configuration require an
already authorized scope/environment; otherwise record REQUIRES CHECK and
continue safe independent work. Never replace required external proof with a
synthetic claim, and never claim production-ready while that evidence is absent.
A release requires separate owner intent after the final exact-main readiness
and immutable artifact/live proof/rollback contract.

## Canon drift to resolve in MP-00

Current PRD contains mandatory Platform Admin TOTP; architecture and SECURITY
retain MFA policy statements. These are expected inputs to MP-00/MP-01, not
evidence of reconciled canon. Backlog/map pointer registration alone does not
make all documents consistent. MP-00 must distinguish approved target policy
from still-present runtime behavior until MP-01 removes it.
Do not claim missing composition/executors are complete because their
contracts or test helpers exist.

## Definition-of-Done coverage

Each numbered source DoD has implementation ownership and final scenario/gate
coverage; acceptance stays the source's requirement, not a new checklist graph.

| Source DoD | Implementation ownership | Final proof |
| --- | --- | --- |
| 1 Configuration-only Source | MP-03.1/.3/.7 | MP-09.a–d; MP-10.4 |
| 2 SecretRef credential | MP-03.2 | MP-09.a; MP-10.2 |
| 3 Actual source worker | MP-04.1–4 | MP-09.a/.g; MP-10.4 |
| 4 Streaming feed | MP-02.1–5 | MP-09.a; MP-10.2/.4 |
| 5 Broken source Last Good | MP-03.5; MP-05.4 | MP-09.f |
| 6 Stable inventory identity | MP-03.4 | MP-09.a; MP-10.3 |
| 7 Missing-object grace | MP-03.4/.5 | MP-09.a |
| 8 Safe agent matching | MP-03.4; MP-05.6 | MP-09.a; MP-10.2 |
| 9 Mirrored media | MP-06.3/.4 | MP-09.a |
| 10 Media independent of CDN | MP-06.2/.5/.6 | MP-09.a; MP-10.2 |
| 11 Public contact fallback | MP-05.7 | MP-09.a |
| 12 Shared Catalog | MP-05.3 | MP-09.e |
| 13 Manual newbuilding | MP-00.3; MP-05.2 | MP-09.e |
| 14 Actual DB snapshot assembly | MP-05.1–10 | MP-09.a/.e; MP-10.4 |
| 15 All canonical datasets | MP-05.2; MP-10.7 | MP-10.1/.4 |
| 16 Safe HTML accepted | MP-06.1; MP-05.10 | MP-09.a; MP-10.2 |
| 17 Private/raw data rejected | MP-05.5/.6/.10; MP-10.7 | MP-10.2 |
| 18 Ed25519 signing | MP-05.10 | MP-09.a; MP-10.2 |
| 19 Signing rotation/revocation | MP-07.3/.4 | MP-10.2 |
| 20 Monotonic sequence | MP-05.9; MP-08.4 | MP-10.7; MP-09.g |
| 21 Actual publication | MP-05.11; MP-08.3 | MP-09.a; MP-10.4 |
| 22 Isolated storage | MP-05.11; MP-08.7 | MP-10.2/.3 |
| 23 Project-scoped manifest | MP-08.7 | MP-09.a; MP-10.2 |
| 24 Actual ACK route | MP-08.8 | MP-09.a; MP-10.6 |
| 25 Operations executors | MP-08.1–6 | MP-10.6 |
| 26 Higher-sequence rollback | MP-08.4 | MP-10.6 |
| 27 SUSPENDED preserves current | MP-08.10 | MP-10.2/.6 |
| 28 Restore drill | Existing project drill, MP-10.3 | MP-10.3 |
| 29 Exit Bundle | Existing exporter final contract | MP-10.5 |
| 30 All gates green | MP-10.1–7 and delivery | MP-10.delivery |

## REQUIRES CHECK

### Completed input-capture contract: MP-05.1

WORK on the approved graph: capture a complete, bounded, project-scoped DB
input in one Repeatable Read transaction, reserve its positive publication
sequence in that transaction, and persist immutable allowlisted fact parts.
An identical idempotency request returns the original input; changed parameters
conflict. Catalog revision identifies captured values, not a timestamp or a
mutable latest-change pointer. Historical GOOD inventory facts still backing
ACTIVE grace identities are pinned with their actual revision. No network,
object-storage or signing work occurs inside capture. Existing module-owned
queries and command/authorized-transaction seams are extended, not bypassed.

Verification must exercise the concrete resolver and repository with a scoped
NOBYPASS worker on the isolated synthetic database: tenant isolation, one-cut
reads, immutable retry, historical fact matching, positive sequence, bounded
capture and rollback. Public projection, signing/publication, production and
real feeds remain outside this checkpoint. MP-05.1 implementation was closed
by the strict Task Manager helper at clean pushed checkpoint `a074033` after
complete resolver/native proof; persistence scaffolding alone was insufficient.

Capture retry constructs a new fact builder inside every transaction attempt.
Fresh admission uses a second bounded authorized Read Committed transaction
while the outer global-safety/project locks are held; it never acquires the
same locks recursively. This preserves the caller's single Repeatable Read fact
cut without privileging a SQL function or granting worker UPDATE on Project or
DataSafetyState. Pool acquisition/transaction failure is fail-closed, not an
excuse to proceed with the old admission cut. New scoped SELECT policies do
not authorize writes to Source, catalog, agent or project facts.

The project-state capture reader now selects scoped public contact candidates,
consented ACTIVE visible agents, editorial facts without internal presentation
notes, media-order policy and persistent URL entries/reservations, redirects,
tombstones, confirmed listing links and lifecycle facts in that same caller cut.
Reservations without an entry remain pinned; no replacement public URL IDs are
allocated during capture. Private consent actors/bases and non-publishable agent
data are not selected. These are private input facts, not public DTOs; the
complete command now composes them with media association capture below.

Catalog candidate capture returns its bounded development UID closure. Own-project
price/shared-media observations are selected only within that closure and pinned
in the same cut; decimal values stay exact strings. Producer URLs are replaced
by a private digest and license/attribution text by eligibility markers, not
copied into the receipt. This metadata is not proof of a mirrored public asset.
Legacy generic project-job policies were found to permit fact mutation under
the capture purpose. A forward-only restrictive policy layer now denies fact
and publication-floor INSERT/UPDATE/DELETE for `snapshot-input` (including its
legacy job representation), even with wildcard/multiple/empty scopes. It does
not remove existing legitimate import/mirror/admin policies or receipt/counter
writes. Native denial and ordinary-workflow controls must pass before claiming
the boundary fixed.

Inventory media capture in MP-05.1 now reads exact scoped ACTIVE identity/hash
and immutable GOOD image membership from the captured inventory pins, retaining
producer positions (including duplicate images). An eligible historical mirror
must reference a scoped GOOD record no newer than the fact revision and belong
to that record's image membership. Capture stores relation revision/update
tokens and allowlisted asset digest/type/size/key/rights markers, not producer
URLs, filenames, license text or mutable relation IDs alone. The head pin must
also match scoped Source.LastGood in that same cut. A capture-local buffer emits
at most 200 records/1 MiB per part across listings, preserving repeated producer
positions without one empty part per inventory; finish emits one empty section
only when the whole media capture is empty. Any failure prevents finalization.
HEAD/public DTO projection remains outside capture. Native proof covers
historical grace, wrong/foreign/future/stale-head pins, warning omissions and
remirror after capture; batching has separate resource regression tests.
Agent photo capture now pins scoped eligible assets for both assignment slots,
with ACTIVE/visibility/consent gating and ASSIGNED_ASSET_ONLY provenance. It
does not choose slot priority or prove approved feed-photo origin; feed-photo
public projection must omit absent proof rather than treating assignment as GOOD.
Shared observation capture now pins scoped development/building associations and
eligible mirrored asset facts in page-batched queries. Manual import observations
do not need a fabricated XML revision: SHARED_OBSERVATION_MIRROR records the
actual association, not GOOD-backed feed provenance. Captured shared-media facts
remain the rights/attribution-marker source for future projectors; no live reads
may substitute changed rights or remirrored assets during replay.
The private `captureSnapshotInput` command now composes all readers and persists
all 18 sections with a positive sequence in one transaction. Its receipt-first
path skips fact rematerialization but still requires fresh current admission.
Every retry constructs a new builder. Catalog revision hashes captured catalog
values; project-state revision is the base Project version, with full captured
version/value parts and input hash identifying the complete state.
Inventory media capture now validates up to 200 pins with one scoped bulk query,
then reads mirrors in keyset pages of 200. Current and historical image membership
queries return at most 1 MiB of arrays or small split markers; normalized leaves
share a 32 MiB retained-URL budget before accumulation. Historical requests are
deduplicated per inventory/revision and released after each mirror page. This is
a bound on retained representations, not RSS. The awaited Source page visitor
keeps Source and media capture in the same cut and propagates failures.
Native NOBYPASS Source-to-media capture of 4100 image-less identities now uses
64 raw SQL calls and passes the actual 30-second worker transaction. Unit tests
cover split accumulation and combined current/historical URL-budget exhaustion.
The complete command additionally passes native capture of 4100 image-bearing
identities and 8200 media positions within the unchanged 30-second transaction
limit, followed by persisted replay. The 16-test native suite also proves
immutable replay after live facts change, concurrent same-key requests, atomic
rollback, foreign-scope denial and fresh freeze admission. This proves the
private input-capture boundary, not 13-dataset projection, signing, publication
or production capacity. Clean pushed implementation checkpoint and strict
Task Manager evidence now close MP-05.1; MP-05 epic delivery remains pending.

### Active implementation contract: MP-05.2

Unified candidate assembly extension: load only a persisted scoped receipt under
the snapshot-input project-job principal; validate captured inventory/URL/profile
inputs before object IO; perform HEAD outside database transactions; resolve
immutable GOOD facts in pages of at most 200 and immediately project each page
to public records. Compose the five catalog, six project-state, inventory and
media datasets with exact-kind/reference/privacy checks and bounded public work.
No raw page accumulation, live profile/Source lookup, inferred agent identity,
signing or publication. Verification must use actual persisted capture/resolver
with synthetic NOBYPASS PostgreSQL, all thirteen datasets and replay after live
edits; partial helpers alone do not close this task. Existing production, secret,
PII and historical-migration stop conditions remain unchanged.

Unified candidate proof now uses actual persisted capture with normalized GOOD
draft/fields and recomputed record hashes, persistent inventory URL, all thirteen
real datasets and unsigned deterministic composition. Native replay remains
identical after live Source/profile/catalog/contact/editorial/agent/media edits.
A separate 201-record historical grace case verifies fact sequence 1 under
captured head sequence 2, real resolver pages `[200, 1]`, producer-off/reprofile
replay and no object HEAD for absent media. The final two native suites PASS
20/20; unchanged 4100/8200 capture takes 13.1 seconds under the original 30-second
worker limit. Final units PASS 59/59; full static checks PASS (383 modules/1170
dependencies), with final test TypeScript/lint after the strict-scope fixture
correction. Docs/secrets/diff checks are recorded in Task Manager. Synthetic
object transport is not a live-provider proof. Cohort/policy composition, complete
source-fact preservation, confirmed listing-agent binding and fresh admission,
signing/publication remain subsequent implementation work, not proved by this
candidate checkpoint.

Compose all 13 public dataset projectors from the immutable captured input and
its exact scoped GOOD references. Reuse existing domain-owned public DTO/media,
contact, editorial and URL mappings; never pass raw Prisma rows to the composer.
Projection must not replace captured facts, rights or profile configuration with
live values. Immutable GOOD draft loading is scoped, hash/revision checked and
bounded; producer URLs, raw records, storage coordinates and consent internals
are not public dataset fields. Public media verification occurs outside capture.
Catalog selection, agent/contact fallback and persisted URL/lifecycle semantics
must remain compatible with the subsequent MP-05.3–8 tasks, not be invented by
generic field spreading. Empty datasets remain explicit; reference/privacy
validation fails closed. Tests must prove actual 13-dataset composition,
determinism, privacy and unchanged receipt replay using synthetic fixtures.
Signing/publication and runtime activation remain later tasks. No deployment,
real feeds, real PII or new credentials are authorized by this contract.

The first MP-05.2 checkpoint implements only the five catalog/geo/price candidate
closure projectors, with strict public schemas, deterministic order, explicit
references and cross-parent validation. Receipt validation checks bounded all-18
parts and their order/hashes plus the header/input/catalog digests. Prices retain
exact decimal strings; no observation source/external IDs or private metadata
are spread into public rows. Persisted seven-place coordinates and 200-character
developer/development names/aliases remain supported. This does not yet apply
subscription filtering. The next checkpoint adds six pure project-state
projectors: official contacts, captured-gated agents, editorial, persisted URLs,
redirects and lifecycle. Existing editorial/media-order mapping is reused without
private notes; closed personal publication gates omit agents and their editorial.
Verified agent media is a trusted server-owned input, not HEAD/fresh consent proof.
URL reservations keep their assigned IDs even after relinks; redirects/tombstones
reference those persisted rows. Historical state/events do not require an active
inventory row. Actual GOOD inventory resolution, imported inventory URL readiness,
public media verification and complete-build proof remain required before
MP-05.2 closure; 11 pure projectors are not a complete 13-dataset pipeline.

Native PostgreSQL proof projects the actual captured catalog and project-state
candidate closure, including persisted seven-place Decimal coordinates and
200-character names/aliases. Persisted replay preserves all eleven datasets
after live catalog/contact/editorial/URL changes and agent consent revocation;
this is replay proof, not permission to publish revoked personal data.
Capacity reruns exposed complete-capture results over the unchanged 30-second
limit. The additive identity/hash lookup index has a natural NOBYPASS EXPLAIN
regression. Phase instrumentation additionally exposed repeated JSON sizing in
deferred commit checks; forward-only generated stored sizes preserve both
triggers and all integrity limits. The final native 17-test suite passes the
original 4100-identity/8200-media assertion (25.4 seconds including admission;
outer transaction 25.3 seconds, source/media 22.8 seconds, save 2.0 seconds).
Generated-count fidelity, forgery rejection (SQLSTATE 428C9), late gap/record
overflow after an immediate header check and full rollback are also verified.
Stored-column production rewrite/lock rehearsal remains a release prerequisite.
The next MP-05.2 checkpoint adds a server-only ingestion-owned exact GOOD resolver.
It accepts at most 200 captured pins and scoped revision/hash/sequence/profile
identities, rechecks the normalized ingestion hash, and never consults live
LastGood or the profile registry. SQL guards a 4-MiB projected page before transfer;
oversized pages split, malformed draft/fields return markers without payload.
Only allowlisted normalized draft candidates, finite selected scalar fields and
exact internal identity pins leave the resolver. The pins include source/external
identity, normalized hash and captured profile identity; they are never public
DTO fields. No raw record, producer media URLs or phones leave the resolver.
These candidates are NOT public DTOs; address/coordinates still require captured
location policy and inventory schema projection. The subsequent inventory
candidate projector applies captured profile policy;
the subsequent media checkpoint supplies receipt-owned HEAD verification;
unified receipt assembly remains pending.
Native 18/18 PostgreSQL NOBYPASS tests verify historical missing-grace GOOD
resolution, foreign scope/wrong hash/sequence/profile rejection, unchanged facts
after live Source edits, and marker-only refusal of missing/null draft/fields.
The worker can see those malformed GOOD records, so the marker proof is not an
RLS-denial false positive. A captured-only profile absent from the runtime registry
resolves successfully; a matching stored hash whose payload differs is rejected
by recomputation. Original 4100/8200 capture still passes the unchanged 30-second
assertion (outer transaction 23.8 seconds). Four targeted resolver unit tests
cover allowlists, duplicate/bounded pages, split leaves and oversized-leaf refusal;
mock batching evidence does not substitute for complete public-build capacity.
The next address boundary consumes finite captured private apartment paths
internally and excludes raw address/private markers from resolver output.
Optional `addressPublic` is bounded and normalized with NFKC-aware forbidden
content checks before/after normalization. Explicit unit components, compound
numbers and attached exact captured markers are removed; ambiguous values fail
closed instead of using the raw address. The subsequent candidate projector
applies captured STREET precision and InventoryEntity/DTO assembly. No arbitrary public-address
fallback or profile-registry lookup is introduced.
Address verification: native 18/18 NOBYPASS suite passes historical GOOD address
redaction/replay, Unicode-created forbidden content rejection, spaced compound
and attached alphabetic compound unit removal. Original 4100/8200 capture still
passes the unchanged 30-second limit (final outer transaction 23.7 seconds).
Targeted units are 63/63 across eight files, including 150 composed address
label/separator/private-marker combinations. Architect-found Unicode/partial
compound/attached-marker bypasses were fixed and rereviewed; no complete public
inventory or thirteen-dataset assembly proof is claimed by this checkpoint.
No fixture volume or worker limit was reduced/relaxed; full public assembly
capacity and unified orchestration are still unproven; the subsequent checkpoint
implements captured media verification separately.

The inventory candidate projector now normalizes actual verified GOOD candidates,
not caller-provided InventoryEntity objects. It checks exact source/external/hash/
profile pins, constructs each property's full sparse variant, uses captured unit
and rent-period aliases, preserves false/zero, and emits finite INVALID reasons
without producer raw values. Format-only profiles use an explicit versioned
family baseline; missing address/URL, unknown rent period and partial coordinates
reject readiness, with no invented currency, identifiers or period. Persistent
captured URL entries supply publicUrlId; references include URL and owner/position
media attachments. Coordinates pass deterministic STREET policy before the DTO.
Private source codes are removed through bounded safe-HTML text-token passes,
including split markup/NBSP, without flattening rich HTML. Unrecognized leading
codes reject. Unitless heights remain INVALID pending captured unit semantics;
unselected variant facts remain ABSENT, not inferred facts. Private externalId
accepts the ingestion identity bound of 240 characters; it is omitted publicly.
This pure candidate seam is not complete receipt orchestration or media HEAD proof,
confirmed agent linkage or thirteen-dataset closure. Native PostgreSQL NOBYPASS
suite is 18/18 PASS, including real captured identity/profile/persisted URL → GOOD
candidate → public inventory and identical replay after Source disable/profile
change. Original 4100/8200 capture passes the unchanged 30-second assertion
(outer transaction 13.9 seconds in this run). Targeted units are 31/31 across
three files, including format-only profiles, property variants, unknown units/
periods, zero/false, pin mismatches, media-reference closure and rich-HTML code
removal across inline markup/NBSP/br/block boundaries. Architect-found attachment
and HTML-boundary P2 issues were fixed and rereviewed with no new targeted findings.

Active MP-05.2 captured-profile extension uses the existing orchestration Task
Contract: adapt only receipt-owned GOOD resolver identity, case semantics and
finite field mappings, with no live registry lookup. Configuration-only YRL
uses the explicit versioned case-sensitive parser baseline; format-owned
profiles retain their captured flag (CIAN is case-insensitive). The selection
omits office contacts, pattern strings and other unused private configuration;
Only ACTIVE inventory fact profiles are required: unrelated legacy default
sources do not block the build, while required unsupported/missing profiles,
duplicate identities/targets and incompatible families reject. This is
not the full configuration projection or unified 13-dataset assembly proof.

Active MP-05.2 media Task Contract: verify receipt-owned inventory GOOD
pins, captured agent consent/assignment and shared observation associations before
any IO; reuse immutable asset/key/rights/HEAD matching; sequential project-bound
HEAD outside DB with a bounded build-lifetime cache; emit strict owner-position
opaque attachments and finite diagnostics, never producer URLs/private metadata.
Manual agent photo assignment has deterministic priority over feed assignment;
HEAD failure omits it rather than silently overriding the owner's selection.
Required proof: targeted eligibility/HEAD/privacy/reference/replay regressions,
native captured-fact composition, types/lint/architecture/docs/secrets. No production,
new credentials, migrations, real feeds or fresh-publication gate changes.
Media checkpoint implementation: `createSnapshotMediaProjectionServer` composes
receipt admission, media-owned captured verification and the strict media dataset.
It owns candidate/HEAD metadata copies, pins the server-selected HEAD port, and
uses build-local cache/conflict checks. Explicit omissions cannot publish a
supplied asset; malformed digest/key/type/size/rights are finite invalid-asset
diagnostics without IO. Mirrored WARNING can retain a verified immutable object;
duplicate owner positions are explicitly ambiguous omissions. Public rows contain
only owner and MediaPublicV1, with reciprocal owner/attachment references.
Native proof is 19/19 across snapshot-build-input and media-projection suites:
actual PostgreSQL NOBYPASS capture of inventory/agent/shared media → HEAD outside
traced transactions → public media/agent maps → identical replay after live asset
key/consent edits. The capture proof uses a synthetic HEAD port; the separate
existing media suite uses the real S3 adapter with only SDK transport replaced,
validating immutable keys/hash/actual synthetic image bytes and producer-off read.
Original 4100/8200 capture passes the unchanged 30-second limit (outer transaction
13.9 seconds). No live-provider, fresh-publication or unified thirteen-dataset
composition proof is claimed. Architect targeted review and latest closure found
no actionable findings; final unit/static evidence is recorded in Task Manager.
Current runtime correctness and all 30 DoD remain unverified by this planning
handoff. External provider/restore evidence must be revalidated for the final
candidate/environment; old-plan closure is not a substitute. Concrete worker
or unified orchestration and public media type names should reuse the narrowest
existing mechanism during implementation, with no speculative extra services.
