# SECURITY

Документ фиксирует security boundary canonical `main` для профиля `multi-tenant / pii / own-saas`.

## Trust boundaries

### Browser

Browser получает публичный сайт либо явные DTO кабинета. Он не получает Prisma records, database URL, provider credentials, raw provider payloads, backup credentials, password hashes или внутренние error bodies.

### Next.js application

- Better Auth проверяет identity/password/session;
- `requireCurrentCabinetPrincipal()` перечитывает session без cookie cache и требует активного User;
- tenant scope создаётся только из свежего AMS Membership;
- permission и module-owned resource authorization обязательны одновременно;
- public signup и user-created organizations выключены;
- public errors имеют stable code, safe message и correlation ID;
- readiness доступен только с localhost.

### PostgreSQL

- единственный runtime source of truth;
- listener не публикуется в Internet;
- runtime и migrator identities разделены;
- tenant-owned records имеют `organizationId`, а composite constraints блокируют cross-tenant relations;
- production применяет только новые reviewed migrations;
- backup, checksum, offsite confirmation и isolated restore smoke обязательны перед release.

### Worker и integrations

- provider tokens доступны только worker environment;
- Яндекс.Вебмастер и Яндекс.Метрика только read-only; Topvisor mutations разрешены узкому onboarding/weekly worker contract на exact allowlisted HTTPS origin;
- browser не вызывает provider API;
- provider mapping хранит только nonsecret identifiers/settings;
- price-check обязателен до Topvisor paid rank-check; `ProviderOperation.operationKey` защищает от повторного списания, неоднозначный результат fail-closed в `ACTION_REQUIRED`;
- logs содержат safe IDs/counts/status, но не token/header/raw body/PII;
- outbox использует idempotency, lease, bounded retry и dead-letter.

### Leads API

Публичная форма передаёт заявку в отдельный allowlisted AMS Leads API. Имя и телефон не сохраняются в PostgreSQL AMS IMPULSE и не логируются. `NEXT_PUBLIC_LEADS_SITE_KEY` — публичный site identifier, а delivery credentials остаются во внешнем сервисе.

## Identity и доступ

- вход по уникальному логину и паролю ровно из 8 печатных ASCII-символов;
- пароль назначает только Platform Admin и передаёт вне Git, URL, argv, docs и logs;
- открытый пароль никогда не возвращается после сохранения;
- смена пароля отзывает все старые sessions;
- отключённый User отклоняется на fresh principal boundary;
- Platform Admin — non-tenant principal и всегда указывает целевую organization для cross-tenant операции;
- tenant user видит только organization свежего Membership;
- знание URL, slug или скрытый UI control не дают доступ.

Отсутствие дополнительного фактора — утверждённое владельцем исключение. Компенсирующие меры: HTTPS/HSTS, закрытая регистрация, встроенный Better Auth limiter, server-side authorization, короткая административная поверхность, session revocation, disabled-user boundary и AuditEvent.

## Rate limiting и redaction

- встроенный Better Auth limiter включён независимо от runtime mode;
- `/sign-in/email` и `/sign-in/username` ограничены до 5 попыток за 60 секунд на IP и endpoint;
- отдельный application limiter не создаётся;
- Pino redaction закрывает root и nested `user`, `actor`, `payload`, `headers`, `request/response`, `req/res` поля с password/token/secret/cookie/API key/email/phone;
- serialized-log test проверяет отсутствие исходных sentinel values.

## Секреты

Source of truth — разрешённый Doppler scope и root-owned protected server env. К секретам относятся Better Auth secret, DB credentials, provider tokens и backup credentials. Они запрещены в Git, fixtures, build output, browser, argv, документации и логах. Server-only values не используют `NEXT_PUBLIC_*`.

## PII и retention

- User/Session могут содержать email, IP и user-agent только в auth/server layer;
- lead PII не хранится в этой БД;
- production PII не используется в fixtures;
- raw errors и provider bodies не сохраняются;
- Notification хранит только safe title/message/route; token URL, raw payload и stack trace запрещены;
- удаление/retention identity data — отдельная owner-approved операция;
- release rollback не откатывает schema/data автоматически.

## Security invariants

- public signup off;
- fresh `PrincipalContext` — единственный authorization input;
- foreign tenant read/write denied server-side и PostgreSQL constraints;
- UI не импортирует Prisma/SQL;
- `defineAction → defineCommand → transaction-bound repository` для business mutations;
- Platform Admin provisioning и user operations пишут safe AuditEvent атомарно;
- provider settings отклоняют sensitive key names;
- secret/PII отсутствуют в DTO, logs, AuditEvent и error response;
- integration runner принимает только отдельную `*_test` database;
- production deploy привязан к exact reviewed SHA и immutable image digest.

## Проверка

Auth, PII, provider credentials, migrations, Nginx, backup и release имеют класс `RISKY`. Перед `main` нужен профильный exact-head gate, перед production — `release-check`, backup/restore proof и live smoke изменённого сценария.
