"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import {
  createTrackedQuerySetAction,
  updateTrackedQuerySetAction,
} from "../_actions/tracked-queries.ts";
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
  rankingSourceSchema,
  type CreateTrackedQuerySetInput,
  type ProjectRegistryAdminFormOptions,
  type TrackedQuerySetListItem,
  type UpdateTrackedQuerySetInput,
} from "../../../modules/project-registry/contracts.ts";

const trackedQueryFormSchema = z.object({
  siteId: z.string().min(1),
  source: rankingSourceSchema,
  baselineLabel: z.string().trim().min(2),
  queriesText: z.string().trim().min(1),
});
const updateTrackedQueryFormSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  source: rankingSourceSchema,
  baselineLabel: z.string().trim().min(2),
  queriesText: z.string().trim().min(1),
});
const rankingSourceLabels = {
  OWNER_PROVIDED: "Задано вручную",
  TOPVISOR: "Topvisor",
} as const;
const rankingSourceOptions = rankingSourceSchema.options.map((value) => ({ value, label: rankingSourceLabels[value] }));

function parseList(value: string) {
  return [...new Set(value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function applyTrackedQueryFieldErrors<TValues extends FieldValues>(
  fieldErrors: Record<string, string[]>,
  setError: UseFormSetError<TValues>,
) {
  applyFieldErrors(
    fieldErrors.queries ? { ...fieldErrors, queriesText: fieldErrors.queries } : fieldErrors,
    setError,
  );
}
function TrackedQuerySetEditCard({ item }: { item: TrackedQuerySetListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof updateTrackedQueryFormSchema>>({
    resolver: zodResolver(updateTrackedQueryFormSchema) as Resolver<z.infer<typeof updateTrackedQueryFormSchema>>,
    defaultValues: {
      id: item.id,
      version: item.version,
      source: item.source,
      baselineLabel: item.baselineLabel,
      queriesText: item.queries.join("\n"),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await updateTrackedQuerySetAction({
      id: values.id,
      version: values.version,
      source: values.source,
      baselineLabel: values.baselineLabel,
      queries: parseList(values.queriesText),
    } satisfies UpdateTrackedQuerySetInput);
    if (!result.ok) {
      applyTrackedQueryFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Набор запросов обновлён" });
    router.refresh();
  });

  return (
    <SectionCard title={item.siteName} description={`${item.projectName} · ${item.expectedCount} запросов`}>
      <form className="grid gap-4" onSubmit={submit}>
        <input type="hidden" {...form.register("id")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.source?.message} label="Источник исходных данных" required>
          <SelectInput options={rankingSourceOptions} {...form.register("source")} />
        </FormField>
        <FormField error={form.formState.errors.baselineLabel?.message} label="Название исходного замера" required>
          <TextInput {...form.register("baselineLabel")} />
        </FormField>
        <FormField error={form.formState.errors.queriesText?.message} helper="Один запрос на строку." label="Запросы" required>
          <AreaInput rows={7} {...form.register("queriesText")} />
        </FormField>
        <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить набор" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" />
      </form>
    </SectionCard>
  );
}

export function TrackedQuerySetsAdminForms({ items, options }: { items: TrackedQuerySetListItem[]; options: ProjectRegistryAdminFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof trackedQueryFormSchema>>({
    resolver: zodResolver(trackedQueryFormSchema) as Resolver<z.infer<typeof trackedQueryFormSchema>>,
    defaultValues: {
      siteId: options.sites[0]?.id ?? "",
      source: "OWNER_PROVIDED",
      baselineLabel: "",
      queriesText: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createTrackedQuerySetAction({
      siteId: values.siteId,
      source: values.source,
      baselineLabel: values.baselineLabel,
      queries: parseList(values.queriesText),
    } satisfies CreateTrackedQuerySetInput);
    if (!result.ok) {
      applyTrackedQueryFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Набор запросов создан" });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать набор запросов" description="Изменения сохраняются в истории, чтобы результаты за разные периоды оставались сопоставимыми.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <FormField error={form.formState.errors.siteId?.message} label="Сайт" required>
            <SelectInput options={options.sites.map((option) => ({ value: option.id, label: option.label }))} {...form.register("siteId")} />
          </FormField>
          <FormField error={form.formState.errors.source?.message} label="Источник исходных данных" required>
            <SelectInput options={rankingSourceOptions} {...form.register("source")} />
          </FormField>
          <FormField error={form.formState.errors.baselineLabel?.message} label="Название исходного замера" required>
            <TextInput {...form.register("baselineLabel")} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField error={form.formState.errors.queriesText?.message} helper="Один запрос на строку." label="Запросы" required>
              <AreaInput rows={7} {...form.register("queriesText")} />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать набор" onRefresh={() => router.refresh()} pendingLabel="Создаём…" />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <TrackedQuerySetEditCard item={item} key={item.id} />)}</div>
    </div>
  );
}
