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

The pilot also confirmed material runtime gaps:

- `Development` has no address or coordinates;
- external source identity, source URL and observation timestamp have no typed
  owner;
- `CatalogProvenanceSource` currently contains only `MANUAL_ADMIN`;
- `PriceObservation` is required by the approved plan but absent from the
  current Prisma schema;
- `SharedMediaAsset` is required by the approved plan but absent from the
  current Prisma schema;
- gallery order, source hash, MIME type, dimensions, rights and attribution
  therefore cannot be recorded as shared-catalog facts;
- factual amenities, parking, security and finishing need an explicit typed
  boundary; provider marketing text must not be copied into shared facts.

## Decision boundary

This pilot is evidence, not an import. A repeatable path needs a separate RISKY
schema/import task with a typed staging payload, dry-run/diff, explicit
provenance, media rights and manual apply. No production database or object
storage was changed.
