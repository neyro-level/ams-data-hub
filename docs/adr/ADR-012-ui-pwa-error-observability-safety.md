# ADR-012: UI, PWA, Error And Observability Safety

**Status:** accepted for E09 implementation

Private, auth, API and operational routes are never service-worker cached. The PWA uses an explicit public static allowlist, versioned old-cache cleanup and skips non-GET requests. Route-aware headers prevent private/auth/API caching and keep public assets cacheable only where safe.

Every application surface receives applicable `error`, `not-found` and loading states. Public errors use a stable safe code plus correlation ID; raw exception, SQL, provider, token and PII text stays server-side. Structured logs redact secrets, auth material, database URLs and PII-defined fields before output.

The legal/public-contact starter state remains visible but fail-closed: missing product legal data blocks production readiness, not local preview; contact delivery is off without complete derived configuration. Verification covers static/unit route guards, Playwright login/logout/offline cache flows, headers, responsive screenshots at 375/768/1280/1440 and safe-log inspection.

| Guarantee | Target evidence |
| --- | --- |
| private routes never cached | service-worker/static route tests and offline/logout Playwright flow |
| safe public errors | boundary/error-envelope tests with raw exception fixtures |
| accessible responsive surfaces | 375/768/1280/1440 screenshot proof plus keyboard-safe states |
| no unsafe logs | redaction contract unit tests and log fixture inspection |
| fail-closed public placeholders | legal/contact config tests and readiness denial |

E09 is `STANDARD` unless headers or runtime configuration change, when it is `RISKY`. It adds no product visual identity or commercial copy.
