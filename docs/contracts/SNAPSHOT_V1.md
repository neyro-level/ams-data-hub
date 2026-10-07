# Snapshot V1 contract

URL/lifecycle datasets transfer persistent Hub state, not consumer SEO policy.
They preserve independent publicUrlId reservations, entries after legitimate
relink, stored canonical paths, factual/presentation lifecycle, immutable 301
history and GONE tombstones. Inactive inventory state/events survive without an
ACTIVE inventory dataset row. Neither catalog selection nor current Agent gate
prunes URL history; replay never recalculates paths from slug/templates or live
state. Templates/reserved namespaces and robots/indexability/sitemap/title/host
policy are excluded. Consumer HTTP redirect/410 and SEO behavior are separate.

Capture reserves sequence inside its transaction under global-safety then
project advisory locks. The scoped counter floors persisted captures, current
manifest and DeliveryRun; replay does not allocate. First counter creation uses
atomic INSERT ON CONFLICT, and serialization conflicts retry the entire bounded
RepeatableRead cut. Counter/header/parts roll back together; INT_MAX fails closed.

The server-owned signed-build seam accepts only a scoped receipt lookup. It
derives headers from the validated persisted cut, invokes the real composer
before the SecretRef Ed25519 signer, and verifies the signature with a copied
trusted/non-revoked key policy. sourceRevisions is the sorted unique union of
captured approved GOOD heads and historical GOOD facts used by ACTIVE inventory,
at most 10000 IDs. generatedAt/publishedAt use capturedAt as stable snapshot
identity time; delivery staleness continues to use DeliveryRun.createdAt.
Factory-pinned signing configuration does not establish cross-process/rotation
publication idempotency. Durable binding and fresh publication admission must
precede exposing a current pointer; successful signing alone does not publish.

Artifact staging binds the exact canonical signed manifest before any PUT.
`SnapshotPublicationBinding` is scoped to one immutable receipt and sequence;
its inputHash, keyId, canonical manifest and SHA-256 cannot be replaced by a
retry or key rotation. Canonical manifest work is capped at 2 MiB. Database
checks bind headers/timestamps/hash to the receipt and exact stored manifest
bytes. Only the scoped snapshot-publication purpose can read/insert bindings;
it cannot mutate captured facts or receipts. The staging server invokes the
actual signed build, binds identity in a short ReadCommitted cut, then invokes
existing project content-addressed storage outside DB. Partial PUT failure
leaves only orphan artifacts and the binding; no current pointer or DeliveryRun
is registered by this seam. A failed artifact batch waits for every owned PUT
to settle before returning failure, and never uploads its manifest afterward.
Staging alone is not publication. Final fresh admission is owned by the facade
below; actual registered outbox verification is recorded in the runtime section.

Newbuilding preview/apply acquires the common global safety advisory lock before
its explicit Source row lock, matching the Source runtime lock order. An import
must not retain a Source row while waiting for publication's global lock.
This ordering prerequisite alone does not implement fresh publication admission.

Publication-gate fact DML takes the common global safety advisory lock in
BEFORE STATEMENT triggers, before target row locks: project/safety, Source and
its safety policy, inventory cohort, subscription and membership/selection,
public contact, Agent/assignment, media ownership/rights slots, and selected
Developer/Development/Building lifecycle/merged-parent eligibility. Existing
RLS/grants and row-level guards remain in force. Legacy identity commands also
acquire global before their source-identity domain lock; explicit pre-locks must
follow this order. Final publication must use plain scoped reads under global
then its project publication lock, not acquire Source/path locks or regenerate
historical URL/catalog facts. These writer locks do not themselves publish.

Staging prepares copied, value-free Source/head and ACTIVE inventory anchors
from the validated receipt before object IO. Its pre-PUT binding cut checks exact
Source dataset/sharing/head ID/sequence/hash and the complete ACTIVE UID/source/
normalizedHash cohort, including additions. Historical GOOD membership is checked
through metadata only; a retained missing-grace fact may precede its approved
head. Source enabled/version/lastAttempt changes and failed imports do not alone
invalidate unchanged approved GOOD. The exact single-project publication purpose
has scoped SELECT access to these facts and GOOD-only revisions/records; restrictive
policies reject wildcard/multi-project/legacy publication readers and fact writes.
This pre-PUT Source check does not protect the later upload window. Final post-PUT
all-owner admission and atomic current/run are owned by the final facade below,
not by this pre-PUT Source check.

Staging also prepares value-free project anchors from the validated receipt and
the server-computed published Agent/assignment graph before HEAD. The pre-PUT
cut rejects frozen jobs, disabled/suspended projects, changed or missing captured
contact, and changed published Agent consent/version/photo slots or exact binding
tuples. Required fallback contact cannot be absent; adding an uncaptured optional
contact or a new unrelated Agent does not enrich or invalidate the old snapshot.
Project names and whole Project.version are not freshness anchors. The reader
selects only permission/identity metadata, in pages of 200, under the same locks;
it does not fetch personal contact values or regenerate captured datasets.
Exact-purpose restrictive SELECT policies cover Project, ProjectPublicContact,
Agent, ListingAgentBinding and global DataSafetyState; wildcard/multi-project
and foreign-scope admission fails before personal reads. This is still only a
pre-PUT prerequisite, not final post-PUT admission or current publication.

Catalog staging admission owns metadata anchors for the actual selected public
Developer/Development/Building graph. It compares captured subscription mode and
version plus complete city/decision sets, including direct child DML without a
parent version bump. Selected entities must still exist, be ACTIVE/unmerged and
retain captured parent/city/district relationships. Unrelated additions and
name/version/value edits do not invalidate the immutable cut; no live selection,
price/geo projection or URL regeneration is performed. The reader uses only
selected UID pages of 200 after the exact scope guard. Subscription reads are
project-scoped; shared catalog rows remain global, with exact-purpose RLS rather
than a selected-UID row capability. No grants or write permissions are expanded.
This additional pre-PUT gate does not replace final admission after upload.

Media staging prepares copied server-only provenance pins before HEAD using the
same captured candidate and manual Agent slot choice. Only actual verified public
owner/position/ref attachments retain pins afterward; omissions, unsupported kinds,
ambiguous positions and failed HEAD do not become fresh publication anchors.
The gate compares scoped immutable asset identity/hash/key/type/bytes/rights and
license trim-presence, captured relation owner/source/revision/asset and canonical
URL hash with eligible MIRRORED/WARNING status and nonnull mirror time, plus shared
observation ownership/position/rights and attribution/license trim-presence.
No URLs, license/attribution values, filenames or producer payloads are returned
by fresh reads. SQL presence markers use the exact ECMAScript trim character set.
Inventory attachment positions remain those of immutable GOOD image lists, not
MediaSource.position; repeated producer positions may share one relation. Shared
position comes from the observation; Agent position is zero. Shared/manual relation
revision is an opaque identity, never invented GOOD/current-head provenance.
New private captures include relationCanonicalUrlHash. Older media receipts without
the required strong pin fail before HEAD and require a fresh capture identity;
persisted receipt bytes/hashes are never rewritten. Timestamp-only protection is
not substituted for the hash. The three scoped SELECT extensions keep existing
grants and fact-write denial. Pre-PUT checks still require post-PUT repetition;
the final facade repeats these checks after PUT; staging itself never publishes.

The server-only final publication facade accepts only
the scoped snapshot-input principal and persisted receipt hash lookup, never a
caller-supplied staged manifest or permission cut. Following fully settled PUTs,
it repeats Project/Source/Catalog/Media admission under global then publication
locks in one short ReadCommitted transaction, rechecks the immutable binding and
publishes current plus DeliveryRun atomically. Cancellation checks after DB writes
remain inside the callback so rollback covers both rows. An exact committed
receipt/binding/run replay returns the same run without signing, HEAD, PUT or
rewriting a newer pointer; a concurrent commit is checked again before reporting
a staging/admission failure. Pending bindings remain immutable and conflicting
new signatures cannot overwrite them. This facade alone is not an outbox
executor. Targeted native proof covers actual capture/signing and synthetic SDK
HEAD/PUT, all four post-PUT permission changes, atomic rollback/cancellation,
concurrent committed fallback and restart/rotation replay. It does not prove a
registered durable outbox execution, a live provider or production readiness.

Manual BUILD has a separate server-only staged-build facade. It reuses actual
capture/sign/bind/artifact staging but never writes current or DeliveryRun.
Following settled PUTs and fresh Project/Source/Catalog/Media admission, it
records an immutable scoped `SnapshotArtifactStageReceipt` with exact
input/idempotency/sequence/manifest pins and a database-generated timestamp.
Config-free exact replay precedes mutable admission and signer/storage IO,
including concurrent committed-stage recovery after cancellation following an
initial replay miss. Stage completion does not authorize later publication:
PUBLISH must independently verify current trust, artifact integrity and fresh
admission. The operational BUILD request adapter is not yet registered.

The existing combined source-worker optionally registers `snapshot.build.request`
when `SNAPSHOT_BUILD_ENABLED=true`; absent/false preserves old intake and reserved
snapshot intents. Its strict envelope/payload must agree on organization and
contain exact project/source/revision/positive sequence. Ingestion owns the short
metadata-only GOOD membership check. Historical GOOD remains valid after a newer
head or producer disable; membership is not proof of canonical enqueue provenance.
Capture identity is server-owned and stable across attempts, derived with the
`snapshot-build-outbox-v1` domain from the durable outbox ID. Persisted exact
receipt/binding/run replay precedes fresh admission and credential/storage reads.
The enabled registry must still parse at startup; missing registry is not a
config-free startup guarantee. Missing private credentials/key match fail later
during real signing, not registry parsing.

Publication commit is separate from fenced outbox completion. A lost completion
lease cannot roll back publication; recovery reuses the same committed run and
does not rewrite a newer pointer. Errors use finite codes, never SDK/config/DB
messages. Owned lifecycle and invocation signals are combined through publication
and staging; buffered S3 HEAD/PUT receive cancellation plus a 60-second request
bound. Cancellation is not a missing-image omission. All artifact writes settle
before failure; cancelled staging cannot upload its manifest afterward. This
wiring has targeted local native proof: 22/22 across staging/publication and
delivery suites, including the enabled capability and actual durable recovery
queue-drain takeover/completion. The canonical GOOD enqueue uses a synthetic
empty-feed fixture; queue/SDK transports are replaced, not the handler or database
publication/settlement. A separate native 3/3 matrix uses the actual combined
`runSourceWorker` function with real local pg-boss: enabled publication and durable
completion, disabled reserved intent/no IO, invalid enabled config before startup.
It observes the exact-owner heartbeat while active and its absence after joined
stop. Only SDK transport is replaced in that matrix. This is not main.ts CLI/OS
signal, remote-provider, ignoring-abort shutdown or production proof. Task Manager
owns implementation closure; epic provider delivery remains separate.

`@ams-data-hub/snapshot-verifier` is the canonical server-side consumer for a
Hub snapshot. A site must keep its last-good state until every gate passes.

Verification order is fail-closed: bounded raw JSON manifest shape; strict
manifest schema; trusted non-revoked
Ed25519 `keyId`; signature; expected `projectId` and supported `schemaMajor`;
strictly increasing `publishSequence`; complete dataset set; exact compressed
`bytes` for every file and SHA-256 for every verified copy; only then bounded
gzip/JSON; project-supplied Zod schemas; reference integrity. A late invalid file
never allows an earlier dataset to inflate or execute its caller schema.

The consumer atomically applies the returned datasets only when `accepted` is
`true`, then sends the authenticated ACK. Every rejection preserves `nextState`
as the previous last-good state. Webhook data is never trusted as snapshot data;
the consumer pulls the signed current manifest and immutable files from its
project-scoped storage access.

Verifier policy exposes `maxCompressedFileBytes` (default 4 MiB, ceiling 16 MiB),
`maxDecompressedFileBytes` (16/64 MiB), `maxDatasetRecords` (50,000/250,000)
and `maxTotalSnapshotBytes` (64/256 MiB). Explicit trusted overrides must be
positive safe integers at or below the ceilings; invalid configuration fails
factory construction with `SNAPSHOT_VERIFIER_LIMIT_INVALID`. Limits are captured
as immutable values, independent of later caller policy changes. Total snapshot
work charges compressed and decoded bytes per dataset, not process RSS or
external downloading. Native synchronous gunzip uses `maxOutputLength` set to
the smaller of the per-file ceiling and remaining combined snapshot budget;
concatenated members share that bound. This preserves the synchronous API without
an unrestricted output allocation. Actual raw array counts are checked before
Zod, and raw/validated counts must match the signed manifest. Invalid UTF-8 is
rejected, never decoded with replacement characters. Schema/reference exceptions
return fixed rejection codes and retain exact last-good. The byte/count budgets
bound artifact work, not arbitrary allocations by trusted policy callbacks or
prior downloading. The raw manifest is capped at thirteen file entries and
10,000 source revision identifiers before Zod/canonicalization; raw identifier
strings are at most 1,024 characters (the signed schema still trims and caps
identifiers at 240). Scalar/key/date/signature lengths and safe integers are
checked before schema cloning. Oversized/malformed shape returns
`MANIFEST_INVALID`; resource policy failures return `SNAPSHOT_LIMIT_EXCEEDED`.
Referenced bodies must be own Uint8Array properties. Bounded private compressed
copies bind hashes to later use, including mutable/shared input buffers. Reused
file keys are permitted for compatible consumers, but charged/decoded per kind;
extra unreferenced files are ignored. Inputs are parsed JSON and trusted byte
containers/policy, not a sandbox for arbitrary getters, proxies or callbacks.

`descriptionHtmlSafe` is the only HTML-bearing public inventory field. Ingestion
sanitizes raw descriptions with `p`, `br`, `ul`, `ol`, `li`, `strong`, `em` and no
attributes. The shared Realty contract brands validated output, with a portable
bounded tag grammar (100,000 characters, depth 64). DTO and snapshot validation
accept that exact field without rewriting or sanitizing it again. Raw description
fields, HTML in other fields, scripts, links, attributes, comments and malformed
markup fail closed. Consumer inventory schemas use the same shared contract;
do not bypass it with an unrestricted string or render raw feed descriptions.

`MediaPublicV1` contains only a lowercase SHA-256 `ref`, `kind: IMAGE`,
deterministic `position` and optional validated `width`, `height`, `alt`.
`PublicInventoryDto.media` uses this strict contract, not the internal
`media[].sourceUrl` provenance schema. The public mapper defaults to no media
until separately projected mirrors are supplied; it never uses producer URLs
as a fallback. Neither original URLs, private bucket keys, presigned URLs nor
filenames belong in this contract. A digest is not a capability: delivery must
resolve it through authorized organization/project-owned MediaSource/MediaAsset
state. The contract does not create a permanent public storage URL or bypass
ADR-015. The server-owned `media-assets.projectInventoryMedia` query resolves
inventory image references from the scoped immutable GOOD record and its
`draft.imageUrls`, not from caller-provided URLs. It requires the pinned current
LastGood revision, matching MediaSource revision/entity/image membership,
and an `expectedRecordHash` pin matching the canonical inventory normalized hash,
same-scope MediaAsset, valid rights and verified immutable storage HEAD. HEAD
is outside database transactions; a second database read rejects a revision
or relation change during IO. Public output contains only digest references
and fixed value-free warning codes. WARNING may retain a verified earlier
mirror for a current image member, never an original URL fallback.
This query is limited to INVENTORY/LISTING_IMAGE. Agent photos require their
own fresh consent-gated projection. Forward migration
`20261006163000_media_projection_good_read` enables only scoped GOOD reads for
the server-owned `media-projection` database purpose; import writes and FORCE
RLS are unchanged. Historical fact revisions for missing-grace inventory use the
MP-05 captured path below; full snapshot build/publication composition is
implemented. Consumer HTTP delivery and Operations executors remain MP-08 work.

`createSnapshotMediaProjectionServer` accepts only a server-loaded immutable
SnapshotInput receipt and server-selected project-bound storage. It validates
all receipt parts/hashes, checks captured inventory GOOD identity/revision/hash
pins, agent consent/version/asset assignment, and shared observation ownership
before HEAD. It never substitutes live Source/MediaSource/profile state during
replay. HEAD is sequential outside DB, cached only for one build; conflicting
metadata for one object key rejects before IO. Repeated positions remain intact.
Manual agent photo assignment wins over feed assignment; a missing manual object
is omitted rather than overridden. `ASSIGNED_ASSET_ONLY` is not GOOD provenance.
Shared manual observations retain their BUILDING/DEVELOPMENT association without
invented GOOD pins. Unsupported shared kinds are explicit finite omissions.
Missing/invalid objects produce value-free diagnostics, never producer fallbacks.
Fresh consent/rights/publication admission remains a separate pre-publication gate.

`createSnapshotCandidateAssemblyServer` accepts a matching snapshot-input
project-job principal and persisted receipt lookup hashes, not caller-supplied
entities/receipt JSON. It loads the scoped immutable input, validates required
ACTIVE inventory profiles and persistent URL entries, closes the read transaction
before media HEAD, then resolves GOOD pages ≤200 in a separate scoped read
transaction and immediately projects public records. No live Source/profile or
LastGood substitution is allowed. All thirteen actual projectors are invoked;
exact kinds, declared references and privacy are verified. Aggregate uncompressed
canonical dataset arrays are capped at 32 MiB including brackets and separators
across pages. Captured catalog selection uses ALL_SHARED subscribed cities minus
EXCLUDE, or CURATED explicit INCLUDE minus EXCLUDE without an implicit city
restriction. Confirmed inventory links expand captured candidates but cannot
override subscription decisions. Developments/developers and buildings must be
ACTIVE and unmerged; subscribed-city anchors and selected geo dependencies remain.
Selected-owner prices, shared media and editorial follow the same cohort; shared
media filtering precedes HEAD. Inventory and persistent URL/redirect/tombstone/
lifecycle history remain intact. Selection never changes persisted parts or hashes.
ACTIVE inventory additionally requires a unique captured Source with matching
approved-head ID/sequence. A historical fact must precede that head; equal
sequence requires the same revision ID. Source without a head and without ACTIVE
inventory contributes no rows. Producer-OFF does not remove captured GOOD.
Capture reuses ingestion's actual SAFE policy/count/analysis predicate for both
the head and each selected historical fact. The baseline is the exact scoped GOOD
`baseLastGoodRevisionId`, from the same source and preceding GOOD sequence; its
record count is read from the immutable row, not trusted from analysis metrics.
Each private proof contains version, SAFE disposition, source/revision/sequence,
policy/analysis hashes, baseline ID and previous GOOD count. Preflight correlates
these pins and equal-head proofs before object IO; none enters public DTOs.
The per-cut cache bounds each lookup to 200 pins. SQL rejects policy or analysis
JSON over 4096 bytes each before transfer; no raw policy/analysis is captured.
Earlier input-v1 receipts lacking this proof fail closed and require a new capture
with a new idempotency key. They must not be supplemented from live state or have
their immutable hash rewritten. This is a tightened private admission contract,
not a public snapshot schema change.
Confirmed assignment is captured as a private value-free `agent-binding` in
listing-links: inventory UID, Source, exact selected GOOD revision/hash and Agent
UID. Preflight rejects foreign, duplicate, orphan or mismatched pins; it never
infers linkage from phones. Only captured ACTIVE/showOnSite/consent-approved
agents admit inventory `agentUid` with a declared agents reference. Otherwise
the listing remains without the personal block/photo; captured project contacts
remain available. This uses durable project-state assignment, not caller pins.
The listing fallback flow derives `requiresProjectContact` from the immutable
input: any ACTIVE listing without an eligible captured agent binding requires
the exact project's projected contact row. Missing/foreign contacts fail with
`SNAPSHOT_PROJECT_CONTACT_REQUIRED` before HEAD. Empty inventory or all-bound
inventory does not require fallback. Candidate assembly returns this computed
flag; composition must pass it unchanged and repeats the contact check. This is
not a caller override, live lookup or duplicate contact in project config.
The trusted server matching command replaces the full assignment set for one
GOOD revision atomically; it is not an incremental reconciliation API.
This candidate result does not claim fresh rights/consent/cohort admission,
automatic ingestion-to-matching orchestration,
signing or publication. Later plan steps must supply those proofs.

The strict public `media` attachment row is `{entityType, entityUid, media}`,
where `media` is `MediaPublicV1` and entityType is INVENTORY, AGENT, DEVELOPMENT or
BUILDING. Record keys are `ENTITY_TYPE/uid/position`; AGENT uses position 0.
Each attachment declares its owner reference; inventory/agent DTOs declare the
matching media reference. Private asset/relation IDs, keys, URLs and license
text never enter attachment rows. This does not add a delivery capability.

`ingestion-core.createInventoryPublicProjectionServer(storage)` composes the
scoped media query with the existing public inventory mapper. It accepts only
server-owned persisted canonical facts and a server-selected revision. The
hash pin binds their version; it does not authenticate arbitrary request JSON.
Scope and UID come from the validated entity, not separate caller overrides.
Public media order is position then ref; identical `(position, ref)` relations
are deduplicated, but one asset at different positions is retained. Conflicting
assets or metadata at one position are omitted with `MEDIA_RELATION_AMBIGUOUS`.
Positions are never renumbered after an omission. No path copies source URLs
from the internal entity into the public DTO.
Image positions come from the immutable GOOD-record, not mutable MediaSource
position metadata: a canonical URL may repeat at several positions, served by
one verified mirrored object. A first-attempt failed image has a persisted
MediaSource WARNING without an asset; it is omitted, leaving the listing valid.
Missing mirrors and unavailable storage objects also produce fixed value-free
warnings, never producer URL fallbacks. Arbitrary adapter messages/codes are not
stored as warnings; only the finite outbound codes and image-decode code are
retained, with `MEDIA_MIRROR_FAILED` as the safe default.

`media-assets.readInventoryPublicMedia` is an internal server facade, not an
anonymous HTTP route. It reuses the authorized current GOOD membership query
before and after object I/O, with exact inventory hash, digest and position.
Its storage capability is bounded streaming GET: checked declared size, one
bounded output buffer, actual length and SHA-256, cancellable stream and timeout.
The image decoder verifies MIME and format; only `{ref, contentType, body}` is
returned. Legacy whole-body GET and producer HTTP are never fallbacks.
Synthetic PostgreSQL proof composes the projected inventory and media dataset,
then reads actual mirrored bytes through this facade after producer media is
disabled. SDK transport is synthetic; storage adapter, GOOD/RLS queries,
projection, gzip composition and reader are real. This is not provider live
proof, browser delivery, full MP-05 orchestration or production activation.
