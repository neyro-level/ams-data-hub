# ADR-015: Per-Project Snapshot Isolation

**Status:** implementation contract adopted; provider denial proof is
`DEFERRED_TO_PREPRODUCTION` under the owner-approved master plan v4 and is
owned by `dh-09.4`.
**Scope:** DH02.1 object storage and project snapshot access. This ADR creates
no bucket, user, credential, policy or external object.

## Decision

Each project receives one private Timeweb S3 bucket and a separate additional
S3 user whose permissions are limited to that bucket. Snapshot object keys are
still project-scoped as `snapshots/<projectId>/<sha256>` and are immutable:
the final key segment is the lowercase SHA-256 of the stored body.

The Hub never exposes a bucket key to a browser. After the application's
server-side project/resource authorization succeeds, the server may issue a
short-lived presigned URL for the exact immutable key. `ObjectStorage` is the
server-owned port; a provider adapter may not derive a permanent public URL.
`ProjectSnapshotStorage` is an application-side second boundary and rejects a
snapshot key from another project before get, head or presign calls reach the
adapter.

The required namespaces are deliberately fixed:

| Content | Immutable key form |
| --- | --- |
| imported source artifact | `source-artifacts/<sha256>` |
| project snapshot | `snapshots/<projectId>/<sha256>` |
| media | `media/<sha256>` |
| export | `exports/<sha256>` |
| backup | `backups/<sha256>` |

## Timeweb capability check

Timeweb documents additional S3 users with rights on selected buckets and
separate credentials, which supports the selected bucket-per-project model.
It also documents bucket policies (including prefix-limited object reads) and
presigned URLs. Prefix policy is a defense-in-depth option only: it is not
accepted as the sole proof of project isolation while a principal could retain
broader bucket access.

Sources checked on 2026-10-03:

- <https://timeweb.cloud/docs/s3-storage/manage-storage/additional-users>
- <https://timeweb.cloud/docs/s3-storage/supported-features/bucket-policies>
- <https://timeweb.cloud/docs/s3-storage/supported-features>

## Deferred provider proof before enablement

No production or shared credential may enable the S3 adapter until an approved
non-production environment records this exact denial test in `dh-09.4`:

1. create private bucket A and private bucket B, with distinct additional S3
   users A and B;
2. upload a harmless fixture through credential B to bucket B;
3. request that fixture with credential A and record an access-denied result;
4. request the fixture with credential B and record success;
5. retain only secret-free evidence: bucket aliases, object digest, command
   outcome/status and timestamp. Never commit credentials, endpoints containing
   credentials, or presigned URLs.

The repository provides this exact proof as `pnpm test:s3-isolation`. The
runner accepts only an explicitly marked non-production local environment,
requires distinct A/B buckets and credentials, writes a synthetic fixture,
checks A-to-B denial and B success, then deletes the fixture before publishing
only a secret-free result.

The unit test in this change proves the same denial at the Hub's project-key
boundary. It is not represented as provider credential proof. For `dh-02.1`,
that local proof plus the unwired, fail-closed provider adapter is sufficient;
the external A-to-B proof remains explicitly deferred to `dh-09.4` and must
pass before the first real Timeweb S3 enablement.

## Alternatives

| Option | Decision |
| --- | --- |
| One private bucket and one additional S3 user per project | Selected. Clear credential boundary and direct A-to-B denial test. |
| One bucket with prefix policy | Defense in depth only; use only after an explicit provider policy proof and no broad principal remains. |
| Hub-issued short-lived presigned URLs | Required browser-delivery mechanism; not a replacement for provider credential isolation. |

## Consequences and stop conditions

The implemented Timeweb S3-compatible adapter belongs behind `ObjectStorage`;
it uses only put, get, head and exact-key presign requests, validates the
immutable put contract before writing and must not perform external work inside
a database transaction. It is not wired into application runtime. Until
`dh-09.4` records the provider denial proof, development uses only synthetic or
local storage and no real credential or real project artifact may be supplied.
A new bucket, user, secret scope, policy change or live fixture belongs only to
that preproduction proof or to a separate explicit owner command.
If the provider cannot demonstrate A-to-B denial, keep the adapter disabled and
do not substitute a successful application unit test for that evidence.
