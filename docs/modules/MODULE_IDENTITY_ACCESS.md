# Module: Identity Access

## Назначение

Разделяет Better Auth identity/password/session lifecycle и AMS business authorization. Создаёт server-only `PrincipalContext`, управляет пользователями и Membership.

## Ownership

- Better Auth: User identity, Account credential, Session, Verification;
- AMS: Organization, `Member.tenantRole`, permissions, resource authorization и административные операции доступа.

Public signup, self-service password recovery, invitations, impersonation, Organization Plugin и второй auth provider не входят в scope.

## Principal и роли

- `platform-admin`: platform management, явный cross-tenant target;
- `platform-analyst`: project/report/sync read;
- `tenant-user`: свежий Membership и `ORG_OWNER | ORG_MEMBER | VIEWER`;
- `job`: server-owned organization scope;
- `api-client`: зарезервирован до появления внешнего API.

Browser никогда не создаёт PrincipalContext. Disabled User не получает principal; platform roles не имеют fake organization; tenant principal требует свежий Membership.

## User lifecycle

```text
Platform Admin
→ атомарно создаёт Organization + Project + User credential + Membership + AuditEvent
→ передаёт назначенный пароль приватным каналом
→ пользователь входит и сразу открывает /dashboard/
```

Пароль содержит ровно 8 печатных ASCII-символов. Он хранится только как Better Auth hash, не возвращается после сохранения и не попадает в URL, logs или AuditEvent. Назначение нового пароля отзывает sessions. Отключение пользователя также отзывает доступ.

## Commands и queries

Identity-owned commands: provision client, reset password, enable/disable user, change tenant role, add/remove Membership. Business writes проходят `defineCommand` и пишут безопасный AuditEvent в той же транзакции.

Queries возвращают browser-safe user/membership DTO и исключают email, когда он не нужен, session token и password hash.

## Failure и tests

Unauthenticated → login; disabled/no-membership → denial без раскрытия tenant; duplicate login → stable safe error; transaction failure → полный rollback.

Проверяются principal matrix, atomic provisioning, password length, duplicate login/slug, session revocation, disabled user, foreign/no-membership denial, закрытый signup и прямой первый вход в кабинет.
