# ProjectExitBundleV1

`ProjectExitBundleV1` is the typed public handoff manifest. This foundation
defines the shape. DH-08.4 adds deterministic canonical JSON artifacts,
`AgentPublicV1`, fail-closed privacy scanning, digest validation and a media
transfer port that rewrites the public manifest to client-controlled HTTPS URLs.

The bundle uses `DATA_MODE=local`, contains every required public dataset,
client-controlled media manifest, pinned vendored contracts and the three
handoff documents. It explicitly declares that AMS Hub and AMS storage are not
runtime dependencies. Public data never contains source credentials, raw feeds,
private agent identity/matching fields, audit internals or consent evidence.
Consent evidence, when legally required, is a separate protected and audited
operational handoff and is never referenced by this public manifest.

The public exporter does not accept a consent-evidence dataset. Protected
consent evidence uses a separate Platform Admin-only transfer port, returns only
a receipt and digest, and records a content-free audit marker. A real handoff
still requires an explicit owner/legal operation.

Runtime contract:

- `DATA_MODE=hub`: pull, verify, atomically apply and ACK signed snapshots.
- `DATA_MODE=local`: read the handed-off local dataset; disable Hub polling,
  webhook and ACK; require no AMS credentials.
