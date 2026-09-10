import { IdentityAdminError } from "../../../modules/identity-access/contracts.ts";
import { PlatformOperationsAdminError } from "../../../modules/platform-operations/contracts.ts";
import { ProjectRegistryAdminError } from "../../../modules/project-registry/contracts.ts";
import { defineAction } from "../../../platform/actions/define-action.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";

function mapError(error: unknown) {
  const code =
    error instanceof IdentityAdminError
      ? error.code
      : error instanceof ProjectRegistryAdminError
        ? error.code
        : error instanceof PlatformOperationsAdminError
          ? error.code
          : "PLATFORM_ADMIN_ACTION_FAILED";

  const messages: Record<string, string> = {
    IDENTITY_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
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
    PROJECT_REFERENCE_INVALID: "Выбранные профили проекта недоступны.",
    SITE_SLUG_CONFLICT: "Такой адрес сайта уже занят в этом проекте.",
    PROJECT_REGISTRY_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
    SITE_CONFLICT: "Такой адрес сайта уже занят в этом проекте.",
    SITE_NOT_FOUND_OR_FORBIDDEN: "Сайт недоступен или уже удалён.",
    SITE_REFERENCE_INVALID: "Выбранный проект недоступен.",
    SITE_STALE: "Сайт уже изменён. Обновите страницу.",
    PROVIDER_CONNECTION_CONFLICT: "Подключение этого источника для сайта уже существует.",
    PROVIDER_CONNECTION_NOT_FOUND_OR_FORBIDDEN: "Подключение источника недоступно.",
    PROVIDER_CONNECTION_REFERENCE_INVALID: "Выбранный сайт недоступен.",
    PROVIDER_CONNECTION_STALE: "Подключение уже изменено. Обновите страницу.",
    METRIKA_GOAL_MAPPING_INVALID: "Выбранные цели не найдены в актуальном списке Метрики.",
    GOAL_DEFINITION_CONFLICT: "Цель с таким номером Метрики уже существует в проекте.",
    GOAL_DEFINITION_NOT_FOUND_OR_FORBIDDEN: "Цель недоступна.",
    GOAL_DEFINITION_REFERENCE_INVALID: "Проект или выбранные сайты недоступны.",
    GOAL_DEFINITION_STALE: "Цель уже изменена. Обновите страницу.",
    TRACKED_QUERY_SET_CONFLICT: "Для сайта уже существует набор запросов.",
    TRACKED_QUERY_SET_NOT_FOUND_OR_FORBIDDEN: "Набор запросов недоступен.",
    TRACKED_QUERY_SET_REFERENCE_INVALID: "Выбранный сайт недоступен.",
    TRACKED_QUERY_SET_STALE: "Набор запросов уже изменён. Обновите страницу.",
    THRESHOLD_PROFILE_NOT_FOUND_OR_FORBIDDEN: "Пороговый профиль недоступен.",
    THRESHOLD_PROFILE_REFERENCE_INVALID: "Пороговый профиль недоступен.",
    THRESHOLD_PROFILE_SLUG_CONFLICT: "Правила оценки с таким коротким названием уже существуют.",
    THRESHOLD_PROFILE_STALE: "Пороговый профиль уже изменён. Обновите страницу.",
    QUERY_CLUSTER_PROFILE_NOT_FOUND_OR_FORBIDDEN: "Кластерный профиль недоступен.",
    QUERY_CLUSTER_PROFILE_REFERENCE_INVALID: "Кластерный профиль недоступен.",
    QUERY_CLUSTER_PROFILE_SLUG_CONFLICT: "Набор групп с таким коротким названием уже существует.",
    QUERY_CLUSTER_PROFILE_STALE: "Кластерный профиль уже изменён. Обновите страницу.",
    PLATFORM_OPERATIONS_ADMIN_ACCESS_DENIED: "Недостаточно прав для этого действия.",
    PROJECT_SYNC_NOT_FOUND: "Проект для обновления данных не найден.",
    PROJECT_SYNC_INVALID_SCOPE: "Проект недоступен для этого действия.",
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
