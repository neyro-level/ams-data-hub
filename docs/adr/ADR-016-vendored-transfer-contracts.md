# ADR-016 — Vendored transfer contracts

Status: Active

## Decision

Project handoff uses pinned immutable schema files vendored into the client
repository or Exit Bundle. A private AMS package registry is not a runtime or
build dependency of the handed-off product. Each vendored artifact is listed
with SHA-256 and byte length in `ProjectExitBundleV1`.

## Consequences

The client can install, build and run with `DATA_MODE=local` without Hub, AMS
S3 or AMS credentials. Updating a schema requires a deliberate new bundle and
version review. A transferable package artifact may be added only by a later
ADR after repeated need; OCI remains the image registry, not an npm registry.
