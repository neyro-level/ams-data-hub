# Timeweb S3 isolation proof — 2026-10-05

**Scope:** non-production provider proof for `adh-dh-09-4`.

## Result

| Check | Result |
| --- | --- |
| Credential A reads private bucket B | `DENIED` |
| Credential B reads its private bucket B | `PASS` |
| Synthetic fixture body integrity | `PASS` |
| Synthetic fixture deletion | `PASS` |
| Temporary policies, users and buckets deletion | `PASS` |
| Production data or deployment touched | `NO` |

The fixture SHA-256 was
`bea0bfb3c42ec96f3879e7023dc888b5f21a2ad459831686411555835c7d1b63`.
Credentials were resolved process-locally from Secret Master and were not
written to Git, documentation, command arguments or retained evidence. The
four temporary proof secrets were deleted after the run. Project-owned S3
administrator credentials remain in Secret Master for future explicitly
authorized provisioning; the real application adapter remains disabled.

## Reproducible boundary

The provider-independent assertion is implemented by
`pnpm test:s3-isolation`. It requires the explicit
`TIMEWEB_S3_ISOLATION_TEST=nonproduction` guard, two distinct credentials and
two distinct buckets. The runner writes only a generated synthetic object,
proves the cross-bucket denial and owner read, and deletes the object in
`finally`.

Resource provisioning and teardown were operator-side actions. Their opaque
provider identifiers and all credentials are intentionally excluded from this
evidence. Exact candidate SHA and task outcome are recorded in the Beads
`EXECUTION_LEDGER_V1` for `adh-dh-09-4`.
