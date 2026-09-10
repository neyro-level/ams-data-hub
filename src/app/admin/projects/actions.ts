"use server";

import { defineAction } from "../../../platform/actions/define-action.ts";
import { ProjectError } from "../../../modules/project-registry/index.ts";
import {
  changeProjectStatus,
  createProject,
  updateProjectSettings,
} from "../../../modules/project-registry/server.ts";
import type {
  ChangeProjectStatusInput,
  CreateProjectInput,
  UpdateProjectSettingsInput,
} from "../../../modules/project-registry/contracts.ts";

function mapProjectError(error: unknown) {
  const code = error instanceof ProjectError ? error.code : "PROJECT_ACTION_FAILED";
  const messages: Record<string, string> = {
    PROJECT_ACCESS_DENIED: "Недостаточно прав для изменения проекта.",
    PROJECT_NOT_FOUND_OR_FORBIDDEN: "Проект недоступен или уже удалён.",
    PROJECT_STALE: "Проект уже изменён. Обновите страницу и повторите действие.",
    PROJECT_SLUG_CONFLICT: "Такой адрес проекта уже занят.",
    PROJECT_REFERENCE_INVALID: "Выбранная организация или профиль недоступны.",
  };
  return { code, message: messages[code] ?? "Не удалось сохранить проект." };
}

function projectAction<TInput, TResult>(
  execute: (principal: Parameters<typeof createProject>[0], input: TInput) => Promise<TResult>,
) {
  return defineAction<TInput, TResult>({
    execute: ({ principal, input }) => execute(principal, input),
    mapError: mapProjectError,
    inputError: {
      code: "PROJECT_INPUT_INVALID",
      message: "Проверьте заполненные поля.",
    },
    revalidate: [{ path: "/admin/projects" }],
  });
}

export const createProjectAction = projectAction<CreateProjectInput, Awaited<ReturnType<typeof createProject>>>(createProject);
export const changeProjectStatusAction = projectAction<ChangeProjectStatusInput, Awaited<ReturnType<typeof changeProjectStatus>>>(changeProjectStatus);
export const updateProjectSettingsAction = projectAction<UpdateProjectSettingsInput, Awaited<ReturnType<typeof updateProjectSettings>>>(updateProjectSettings);
