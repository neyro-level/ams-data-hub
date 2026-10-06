# New-building aggregator pilot

Date: 2026-10-05. Mode: local non-production evidence.

The owner-authorized public-source pilot read five live development cards and
downloaded five development images per card. The provider, region, external
identities, entity names, source URLs and media remain only in ignored local
evidence and are not committed to the portable product repository.

## Evidence summary

- live development cards: 5;
- downloaded media files: 25;
- valid image streams: 25;
- unique SHA-256 values: 25;
- minimum decoded dimensions: 1920 by 960;
- login, CAPTCHA, paid action, database write and production write: none;
- fallback provider: not used.

## Runtime compatibility

The implemented `Developer -> Development -> Building` hierarchy can represent
developer names, development names, city/district references, building labels,
floors, commissioning year/quarter, construction status, material and housing
class.

The follow-up import foundation now adds normalized address/coordinates,
source-owned external identities, observation timestamps, `PriceObservation`
and `SharedMediaAsset` with media order, rights and attribution. Its
transaction-bound preview/apply commands require Platform Admin access and a
confirmed reviewed-plan digest; PostgreSQL tests cover migration, replay,
rollback and project isolation. See `../DATA_MODEL.md` for the current contract.

Remaining boundaries: this foundation records public media URL metadata, not
downloaded blob hashes, MIME/dimensions or storage objects. Typed amenities,
parking, security and finishing remain outside the payload; provider marketing
text must not be copied into shared facts. The local pilot's media are not
imported by this change.

## Decision boundary

This pilot is evidence, not an import. The separate RISKY foundation implements
typed staging, dry-run/diff, provenance, media rights and manual apply; it
does not add collection, schedules or automatic apply. No production database
or object storage was changed.
