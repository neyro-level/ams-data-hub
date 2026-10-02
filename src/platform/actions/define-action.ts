import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PrincipalContext } from "../authorization/principal.ts";
import { createCorrelationId } from "../http/correlation.ts";
import {
  CabinetPrincipalError,
  requireCurrentCabinetPrincipal,
} from "../auth/principal-session.ts";

export interface ActionResult<TResult> {
  ok: true;
  data: TResult;
}

export interface ActionFailure {
  ok: false;
  code: string;
  message: string;
  correlationId: string;
  fieldErrors: Record<string, string[]>;
}

export type DefinedAction<TResult> = ActionResult<TResult> | ActionFailure;

export interface ActionErrorMapping {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

interface ActionExecution<TInput> {
  input: TInput;
  principal: PrincipalContext;
}

interface ActionRevalidation {
  path: string;
  type?: "layout" | "page";
}

export interface ActionDefinition<TInput, TResult> {
  execute: (execution: ActionExecution<TInput>) => Promise<TResult>;
  mapError?: (error: unknown) => ActionErrorMapping | null;
  inputError?: Pick<ActionErrorMapping, "code" | "message">;
  revalidate?: readonly ActionRevalidation[];
}

export interface ActionBoundaryDependencies {
  requireCabinetPrincipal(): Promise<PrincipalContext>;
  revalidate(path: string, type?: "layout" | "page"): void;
}

const defaultDependencies: ActionBoundaryDependencies = {
  requireCabinetPrincipal: requireCurrentCabinetPrincipal,
  revalidate: (path, type) => {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  },
};

function zodFailure(error: z.ZodError, mapping?: Pick<ActionErrorMapping, "code" | "message">) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return {
    code: mapping?.code ?? "ACTION_INPUT_INVALID",
    message: mapping?.message ?? "Проверьте заполненные поля.",
    fieldErrors,
  };
}

function principalFailure(error: CabinetPrincipalError): ActionErrorMapping {
  const messages: Record<CabinetPrincipalError["code"], string> = {
    AUTHENTICATION_REQUIRED: "Требуется повторный вход.",
    CABINET_USER_INACTIVE: "Доступ к кабинету отключён.",
  };
  return { code: error.code, message: messages[error.code] };
}

export function createActionBoundary(dependencies: ActionBoundaryDependencies) {
  return function defineBoundAction<TInput, TResult>(
    definition: ActionDefinition<TInput, TResult>,
  ) {
    return async (input: TInput): Promise<DefinedAction<TResult>> => {
      let principal: PrincipalContext | null = null;
      let correlationId = createCorrelationId();
      try {
        principal = await dependencies.requireCabinetPrincipal();
        correlationId = principal.correlationId;
        const data = await definition.execute({ input, principal });
        for (const target of definition.revalidate ?? []) {
          dependencies.revalidate(target.path, target.type);
        }
        return { ok: true, data };
      } catch (error) {
        const mapped =
          error instanceof CabinetPrincipalError
            ? principalFailure(error)
            : error instanceof z.ZodError
              ? zodFailure(error, definition.inputError)
              : definition.mapError?.(error) ?? {
                  code: "ACTION_FAILED",
                  message: "Не удалось выполнить действие.",
                };
        return {
          ok: false,
          code: mapped.code,
          message: mapped.message,
          correlationId,
          fieldErrors: mapped.fieldErrors ?? {},
        };
      }
    };
  };
}

export const defineAction = createActionBoundary(defaultDependencies);
