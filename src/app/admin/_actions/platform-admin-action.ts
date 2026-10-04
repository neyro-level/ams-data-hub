import { IdentityAdminError } from "../../../modules/identity-access/contracts.ts";
import { PlatformOperationsAdminError } from "../../../modules/platform-operations/contracts.ts";
import { ProjectRegistryError } from "../../../modules/project-registry/index.ts";
import { SharedCatalogError } from "../../../modules/shared-catalog/server.ts";
import { ProjectStateError } from "../../../modules/project-state/server.ts";
import { defineAction } from "../../../platform/actions/define-action.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";

function mapError(error: unknown) {
  const code =
    error instanceof IdentityAdminError
      ? error.code
      : error instanceof PlatformOperationsAdminError
        ? error.code
        : error instanceof ProjectRegistryError
          ? error.code
          : error instanceof SharedCatalogError
          ? error.code
          : error instanceof ProjectStateError
            ? error.code
          : "PLATFORM_ADMIN_ACTION_FAILED";

  const messages: Record<string, string> = {
    IDENTITY_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
    CLIENT_ACCESS_DISABLED: "Клиентский доступ отключён настройкой платформы.",
    ORGANIZATION_NOT_FOUND_OR_FORBIDDEN: "Организация недоступна или уже удалена.",
    ORGANIZATION_STALE: "Организация уже изменена. Обновите страницу.",
    ORGANIZATION_SLUG_CONFLICT: "Такой адрес организации уже занят.",
    MEMBERSHIP_NOT_FOUND_OR_FORBIDDEN: "Доступ пользователя недоступен или уже удалён.",
    MEMBERSHIP_STALE: "Запись доступа уже изменена. Обновите страницу.",
    MEMBERSHIP_ALREADY_EXISTS: "У пользователя уже есть доступ в эту организацию.",
    MEMBERSHIP_REFERENCE_INVALID: "Организация или пользователь недоступны.",
    USER_LOGIN_CONFLICT: "Пользователь с таким логином уже существует.",
    USER_NOT_FOUND: "Пользователь не найден.",
    PROJECT_SLUG_CONFLICT: "Такой адрес проекта уже занят.",
    PROJECT_REFERENCE_INVALID: "Выбранная организация недоступна.",
    PROJECT_NOT_FOUND_OR_STALE: "Проект уже изменён. Обновите страницу.",
    PROJECT_REGISTRY_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
    SHARED_CATALOG_ADMIN_ACCESS_DENIED: "Недостаточно прав для изменения общего каталога.",
    SHARED_CATALOG_NOT_FOUND_OR_STALE: "Запись уже изменена. Обновите страницу и повторите действие.",
    SHARED_CATALOG_CONFLICT: "Запись с таким названием или алиасом уже существует.",
    SHARED_CATALOG_REFERENCE_INVALID: "Выбранная связанная запись недоступна.",
    PROJECT_STATE_ADMIN_ACCESS_DENIED: "Недостаточно прав для изменения данных проекта.",
    PROJECT_PUBLIC_CONTACT_REFERENCE_INVALID: "Проект для публичного контакта недоступен.",
    PROJECT_PUBLIC_CONTACT_STALE: "Публичный контакт уже изменён. Обновите страницу.",
    PLATFORM_OPERATIONS_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
    MAINTENANCE_REQUEST_INVALID_SCOPE: "Служебную задачу можно поставить только на уровне платформы.",
  };

  return { code, message: messages[code] ?? "Не удалось сохранить изменения." };
}

export function platformAdminAction<TInput, TResult>(
  resource: string,
  execute: (principal: PrincipalContext, input: TInput) => Promise<TResult>,
) {
  return defineAction<TInput, TResult>({
    execute: ({ principal, input }) => execute(principal, input),
    mapError,
    inputError: {
      code: "PLATFORM_ADMIN_INPUT_INVALID",
      message: "Проверьте заполненные поля.",
    },
    revalidate: [
      { path: "/admin", type: "layout" },
      { path: `/admin/${resource}` },
    ],
  });
}
