# Security

## Trust Boundaries

- browser never receives secrets;
- server actions require authenticated principal context;
- tenant access requires both auth and resource authorization;
- Platform Admin does not use fake tenant identity;
- external HTTP/email/AI/storage calls are outside business transactions.

## PII

The starter contains account data, memberships, notifications and audit events. Derived products must document any additional PII before production.

## Public Contact Form

The visual form is kept, but delivery is disabled by default. It sends only when `NEXT_PUBLIC_CONTACT_API_URL`, `NEXT_PUBLIC_CONTACT_PROJECT_ID` and `NEXT_PUBLIC_CONTACT_SITE_KEY` are configured by the derived product.

## PWA Cache

Service worker skips `/api/*`, `/admin/*`, `/dashboard/*`, `/notifications/*`, auth/session routes and non-GET requests. It caches only public shell/static assets.

## Secrets

Secrets must stay in environment/secret manager, never in Git, docs, browser code, argv or logs.
