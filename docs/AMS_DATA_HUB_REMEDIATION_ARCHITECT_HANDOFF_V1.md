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

### Active implementation contract: MP-05.1

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
real feeds remain outside this checkpoint. MP-05.1 stays IN_PROGRESS until
the complete resolver and its native proof pass; persistence scaffolding alone
does not satisfy the task.

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
or production capacity. Strict task closure still requires the clean pushed
implementation checkpoint and Task Manager evidence.

Current runtime correctness and all 30 DoD remain unverified by this planning
handoff. External provider/restore evidence must be revalidated for the final
candidate/environment; old-plan closure is not a substitute. Concrete worker
or unified orchestration and public media type names should reuse the narrowest
existing mechanism during implementation, with no speculative extra services.
