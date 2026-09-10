"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type Resolver, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import { Checkbox } from "../../../components/ui/checkbox.tsx";
import {
  createGoalDefinitionAction,
  updateGoalDefinitionAction,
} from "../_actions/goals.ts";
import {
  AreaInput,
  applyFieldErrors,
  feedbackFrom,
  FormField,
  SectionCard,
  SelectInput,
  SubmitRow,
  TextInput,
  type Feedback,
} from "./platform-admin-form-primitives.tsx";
import {
  goalCategorySchema,
  goalDirectionSchema,
  type CreateGoalDefinitionInput,
  type GoalDefinitionListItem,
  type ProjectRegistryAdminFormOptions,
  type UpdateGoalDefinitionInput,
} from "../../../modules/project-registry/contracts.ts";

const goalFormSchema = z.object({
  projectId: z.string().min(1),
  externalGoalId: z.string().trim().min(1),
  label: z.string().trim().min(2),
  category: goalCategorySchema,
  direction: goalDirectionSchema,
  includeInSeoConversion: z.boolean(),
  siteIdsText: z.string().max(20000),
});
const updateGoalFormSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  label: z.string().trim().min(2),
  category: goalCategorySchema,
  direction: goalDirectionSchema,
  includeInSeoConversion: z.boolean(),
  siteIdsText: z.string().max(20000),
});
const goalCategoryLabels = {
  LEAD_SUBMIT: "Отправка заявки",
  PHONE_CLICK: "Раскрытие телефона",
  MESSENGER_CLICK: "Переход в мессенджер",
  FORM_START: "Начало заполнения формы",
  FILE_DOWNLOAD: "Скачивание файла",
  OTHER: "Другое действие",
} as const;
const goalDirectionLabels = {
  PRIMARY: "Основная цель",
  SECONDARY: "Дополнительная цель",
} as const;
const goalCategoryOptions = goalCategorySchema.options.map((value) => ({ value, label: goalCategoryLabels[value] }));
const goalDirectionOptions = goalDirectionSchema.options.map((value) => ({ value, label: goalDirectionLabels[value] }));
function parseList(value: string) {
  return [...new Set(value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function applyGoalFieldErrors<TValues extends FieldValues>(
  fieldErrors: Record<string, string[]>,
  setError: UseFormSetError<TValues>,
) {
  applyFieldErrors(
    fieldErrors.siteIds ? { ...fieldErrors, siteIdsText: fieldErrors.siteIds } : fieldErrors,
    setError,
  );
}
function GoalDefinitionEditCard({ item }: { item: GoalDefinitionListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof updateGoalFormSchema>>({
    resolver: zodResolver(updateGoalFormSchema) as Resolver<z.infer<typeof updateGoalFormSchema>>,
    defaultValues: {
      id: item.id,
      version: item.version,
      label: item.label,
      category: item.category,
      direction: item.direction,
      includeInSeoConversion: item.includeInSeoConversion,
      siteIdsText: item.siteIds.join("\n"),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await updateGoalDefinitionAction({
      id: values.id,
      version: values.version,
      label: values.label,
      category: values.category,
      direction: values.direction,
      includeInSeoConversion: values.includeInSeoConversion,
      siteIds: parseList(values.siteIdsText),
    } satisfies UpdateGoalDefinitionInput);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Цель обновлена" });
    router.refresh();
  });

  return (
    <SectionCard title={item.label} description={`${item.projectName} · ${item.externalGoalId}`}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <input type="hidden" {...form.register("id")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.label?.message} label="Название" required>
          <TextInput {...form.register("label")} />
        </FormField>
        <FormField error={form.formState.errors.category?.message} label="Категория" required>
          <SelectInput options={goalCategoryOptions} {...form.register("category")} />
        </FormField>
        <FormField error={form.formState.errors.direction?.message} label="Направление" required>
          <SelectInput options={goalDirectionOptions} {...form.register("direction")} />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground xl:self-end">
          <Controller control={form.control} name="includeInSeoConversion" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
          Учитывать в SEO-конверсии
        </label>
        <div className="sm:col-span-2">
          <FormField error={form.formState.errors.siteIdsText?.message} helper="Необязательно. Укажите внутренние номера сайтов по одному в строке." label="Связанные сайты">
            <AreaInput rows={5} {...form.register("siteIdsText")} />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить цель" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" />
        </div>
      </form>
    </SectionCard>
  );
}

export function GoalDefinitionsAdminForms({ items, options }: { items: GoalDefinitionListItem[]; options: ProjectRegistryAdminFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof goalFormSchema>>({
    resolver: zodResolver(goalFormSchema) as Resolver<z.infer<typeof goalFormSchema>>,
    defaultValues: {
      projectId: options.projects[0]?.id ?? "",
      externalGoalId: "",
      label: "",
      category: "LEAD_SUBMIT",
      direction: "PRIMARY",
      includeInSeoConversion: true,
      siteIdsText: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createGoalDefinitionAction({
      projectId: values.projectId,
      externalGoalId: values.externalGoalId,
      label: values.label,
      category: values.category,
      direction: values.direction,
      includeInSeoConversion: values.includeInSeoConversion,
      siteIds: parseList(values.siteIdsText),
    } satisfies CreateGoalDefinitionInput);
    if (!result.ok) {
      applyGoalFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Цель создана" });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать цель" description="Цель будет доступна только в выбранном проекте и на связанных сайтах.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <FormField error={form.formState.errors.projectId?.message} label="Проект" required>
            <SelectInput options={options.projects.map((option) => ({ value: option.id, label: option.label }))} {...form.register("projectId")} />
          </FormField>
          <FormField error={form.formState.errors.externalGoalId?.message} label="Номер цели в Метрике" required>
            <TextInput {...form.register("externalGoalId")} />
          </FormField>
          <FormField error={form.formState.errors.label?.message} label="Название" required>
            <TextInput {...form.register("label")} />
          </FormField>
          <FormField error={form.formState.errors.category?.message} label="Категория" required>
            <SelectInput options={goalCategoryOptions} {...form.register("category")} />
          </FormField>
          <FormField error={form.formState.errors.direction?.message} label="Направление" required>
            <SelectInput options={goalDirectionOptions} {...form.register("direction")} />
          </FormField>
          <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground xl:self-end">
            <Controller control={form.control} name="includeInSeoConversion" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
            Учитывать в SEO-конверсии
          </label>
          <div className="sm:col-span-2">
            <FormField error={form.formState.errors.siteIdsText?.message} helper="Необязательно. Укажите внутренние номера сайтов по одному в строке." label="Связанные сайты">
              <AreaInput rows={5} {...form.register("siteIdsText")} />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать цель" onRefresh={() => router.refresh()} pendingLabel="Создаём…" />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <GoalDefinitionEditCard item={item} key={item.id} />)}</div>
    </div>
  );
}

