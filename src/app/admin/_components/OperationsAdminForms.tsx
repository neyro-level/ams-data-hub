"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import {
  requestMaintenanceInputSchema,
  type RequestMaintenanceInput,
} from "../../../modules/platform-operations/contracts.ts";
import { requestMaintenanceAction } from "../_actions/operations.ts";
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
  const form = useForm<RequestMaintenanceInput>({
    resolver: zodResolver(requestMaintenanceInputSchema) as Resolver<RequestMaintenanceInput>,
    defaultValues: {
      idempotencyKey: `manual-${new Date().toISOString().slice(0, 10)}`,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await requestMaintenanceAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({
      kind: "success",
      message: result.data.duplicate ? "Повторный запрос вернул существующее задание" : "Служебная задача поставлена в очередь",
    });
    router.refresh();
  });

  return (
    <SectionCard title="Поставить служебную задачу" description="Нейтральный пример outbox-задачи для будущих фоновых процессов.">
      <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submit}>
        <FormField error={form.formState.errors.idempotencyKey?.message} label="Номер запуска" helper="Нужен, чтобы случайно не поставить одно задание дважды." required>
          <TextInput {...form.register("idempotencyKey")} />
        </FormField>
        <div className="self-end">
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Поставить в очередь" onRefresh={() => router.refresh()} pendingLabel="Ставим..." />
        </div>
      </form>
    </SectionCard>
  );
}
