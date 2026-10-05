# ProjectExitBundleV1

`ProjectExitBundleV1` is the typed public handoff manifest. This foundation
defines the shape; DH-08.4 owns the exporter, media copy and clean-machine proof.

The bundle uses `DATA_MODE=local`, contains every required public dataset,
client-controlled media manifest, pinned vendored contracts and the three
handoff documents. It explicitly declares that AMS Hub and AMS storage are not
runtime dependencies. Public data never contains source credentials, raw feeds,
private agent identity/matching fields, audit internals or consent evidence.
Consent evidence, when legally required, is a separate protected and audited
operational handoff and is never referenced by this public manifest.

Runtime contract:

- `DATA_MODE=hub`: pull, verify, atomically apply and ACK signed snapshots.
- `DATA_MODE=local`: read the handed-off local dataset; disable Hub polling,
  webhook and ACK; require no AMS credentials.
