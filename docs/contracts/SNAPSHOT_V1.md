# Snapshot V1 contract

`@ams-data-hub/snapshot-verifier` is the canonical server-side consumer for a
Hub snapshot. A site must keep its last-good state until every gate passes.

Verification order is fail-closed: strict manifest schema; trusted non-revoked
Ed25519 `keyId`; signature; expected `projectId` and supported `schemaMajor`;
strictly increasing `publishSequence`; complete dataset set; exact compressed
`bytes` and SHA-256; gzip/JSON; project-supplied Zod schemas; reference integrity.

The consumer atomically applies the returned datasets only when `accepted` is
`true`, then sends the authenticated ACK. Every rejection preserves `nextState`
as the previous last-good state. Webhook data is never trusted as snapshot data;
the consumer pulls the signed current manifest and immutable files from its
project-scoped storage access.

`descriptionHtmlSafe` is the only HTML-bearing public inventory field. Ingestion
sanitizes raw descriptions with `p`, `br`, `ul`, `ol`, `li`, `strong`, `em` and no
attributes. The shared Realty contract brands validated output, with a portable
bounded tag grammar (100,000 characters, depth 64). DTO and snapshot validation
accept that exact field without rewriting or sanitizing it again. Raw description
fields, HTML in other fields, scripts, links, attributes, comments and malformed
markup fail closed. Consumer inventory schemas use the same shared contract;
do not bypass it with an unrestricted string or render raw feed descriptions.
