"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import {
  requestProjectSyncInputSchema,
  type RequestProjectSyncInput,
} from "../../../modules/platform-operations/contracts.ts";
import { requestProjectSyncAction } from "../_actions/operations.ts";
import {
  applyFieldErrors,
  feedbackFrom,
  FormField,
  SectionCard,
  SubmitRow,
  TextInput,
  type Feedback,
} from "./platform-admin-form-primitives.tsx";

export function OperationsAdminForms() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<RequestProjectSyncInput>({
    resolver: zodResolver(requestProjectSyncInputSchema) as Resolver<RequestProjectSyncInput>,
    defaultValues: {
      projectSlug: "",
      idempotencyKey: "manual-",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await requestProjectSyncAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({
      kind: "success",
      message: result.data.duplicate ? "Повторный запрос вернул существующее задание" : "Синхронизация поставлена в очередь",
    });
    router.refresh();
  });

  return (
    <SectionCard title="Обновить данные проекта" description="Запустите безопасное обновление данных. Повторное нажатие не создаст одинаковые задания.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <FormField error={form.formState.errors.projectSlug?.message} label="Адрес проекта" required>
          <TextInput {...form.register("projectSlug")} />
        </FormField>
        <FormField error={form.formState.errors.idempotencyKey?.message} label="Номер запуска" helper="Нужен, чтобы случайно не запустить одно обновление дважды." required>
          <TextInput {...form.register("idempotencyKey")} />
        </FormField>
        <div className="sm:col-span-2">
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Запустить обновление" onRefresh={() => router.refresh()} pendingLabel="Запускаем…" />
        </div>
      </form>
    </SectionCard>
  );
}
