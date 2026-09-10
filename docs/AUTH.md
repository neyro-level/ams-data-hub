# AUTH

## Контракт

Better Auth `1.7.2` владеет identity, credential password и session lifecycle. AMS владеет Organization, Membership, tenant role, permissions, resource authorization и AuditEvent. Better Auth Organization Plugin и public signup выключены.

Единственный authorization contract — server-generated `PrincipalContext`:

```text
platform-admin   → PLATFORM_ADMIN без organizationId
platform-analyst → SEO_ANALYST без фиктивного tenant
tenant-user      → userId + membershipId + organizationId + tenantRole
job              → jobName + явный organizationId
```

Browser, URL, form и cookie не создают tenant scope. На каждом приватном запросе сервер перечитывает session, активного User и Membership. Отключённый пользователь не входит; удалённый Membership перестаёт давать доступ со следующего запроса.

## Вход

- вход — по уникальному lowercase-логину и паролю;
- пароль содержит ровно 8 печатных ASCII-символов без пробелов;
- пароль назначает и меняет только Platform Admin;
- первый успешный вход сразу ведёт в `/dashboard/`;
- самостоятельная регистрация, восстановление пароля и изменение пароля пользователем отсутствуют;
- после смены пароля все существующие sessions пользователя отзываются;
- password hash хранится только в Better Auth `Account`; открытый пароль не возвращается, не логируется и не попадает в AuditEvent.

Решение работать без дополнительного фактора подтверждено владельцем как `APPROVED_PROJECT_EXCEPTION`. Компенсирующие меры: HTTPS, встроенный Better Auth rate limiting, закрытая регистрация, server-side authorization, отключение пользователей, отзыв sessions и аудит административных операций.

## Создание клиента

В `/admin/` Platform Admin выполняет одну атомарную команду:

```text
Organization
→ Project
→ User
→ Better Auth credential Account
→ Membership
→ AuditEvent
```

При любой ошибке транзакция откатывается целиком. Начальная tenant role — `VIEWER`; допустимы `ORG_OWNER`, `ORG_MEMBER`, `VIEWER`. Duplicate login или slug возвращает безопасную ошибку без раскрытия данных.

Platform Admin также может:

- просмотреть пользователей и memberships;
- назначить новый пароль с отзывом sessions;
- включить или отключить пользователя;
- изменить tenant role;
- отозвать доступ к organization.

## Operator CLI

```bash
pnpm user:create -- --username <name> --name <display-name> --system-role CLIENT_VIEWER
pnpm user:reset-password -- --username <name>
pnpm user:disable -- --username <name>
pnpm user:set-system-role -- --username <name> --system-role SEO_ANALYST
pnpm user:add-to-organization -- --username <name> --organization <slug> --tenant-role VIEWER
pnpm user:remove-from-organization -- --username <name> --organization <slug>
```

`user:create` и `user:reset-password` принимают пароль только через stdin. `--password`, environment, URL и документация для передачи пароля запрещены.

## Точки входа и proof

- `src/platform/auth/auth.ts` — Better Auth server adapter;
- `src/platform/auth/principal-session.ts` — fresh session → PrincipalContext;
- `src/platform/authorization/*` — principal types, permissions и factories;
- `src/modules/identity-access/*` — AMS identity administration;
- `src/app/admin/_actions/users.ts` — thin action adapter;
- `scripts/auth-admin.ts` — bounded operator CLI.

Проверки покрывают Platform Admin/analyst/tenant/disabled-user matrix, direct action call, atomic provisioning, exact password length, duplicate login/slug, session revocation, tenant isolation, закрытый signup и прямой переход первого входа в кабинет.
