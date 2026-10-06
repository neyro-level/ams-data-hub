# ADR-012: UI, Cache, Error And Observability Safety

**Status:** accepted and amended by DH-00.5

Private, auth, API and operational routes use explicit non-cacheable response headers. DH-00.5 removed the PWA manifest, service worker and offline surface, so browser cache safety no longer depends on client-side caching code.

Every application surface receives applicable `error`, `not-found` and loading states. Public errors use a stable safe code plus correlation ID; raw exception, SQL, provider, token and PII text stays server-side. Structured logs redact secrets, auth material, database URLs and PII-defined fields before output.

The public surface is limited to login, the privacy policy and operational health endpoints. The policy visibly remains pending owner legal review; no public contact form or signup exists. Verification covers static/unit route guards, removed-route 404 checks, headers, responsive screenshots at 375/768/1280/1440 and safe-log inspection.

| Guarantee | Target evidence |
| --- | --- |
| private routes are not cacheable | route-header tests and authenticated-flow checks |
| safe public errors | boundary/error-envelope tests with raw exception fixtures |
| accessible responsive surfaces | 375/768/1280/1440 screenshot proof plus keyboard-safe states |
| no unsafe logs | redaction contract unit tests and log fixture inspection |
| bounded public surface | route inventory, 404 checks and visible legal-review marker |

The product delivery profile is CRITICAL: every merge requires the exact-head
manual RISKY gate in ADR-010. Header, authentication and runtime changes require
their applicable focused security evidence.
