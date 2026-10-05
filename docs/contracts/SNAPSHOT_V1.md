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
