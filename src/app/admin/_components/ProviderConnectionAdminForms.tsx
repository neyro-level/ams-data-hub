"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type Resolver, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import { Checkbox } from "../../../components/ui/checkbox.tsx";
import { Button } from "../../../components/ui/button.tsx";
import {
  createProviderConnectionAction,
  updateProviderConnectionAction,
} from "../_actions/providers.ts";
import { confirmMetricaGoalsAction } from "../_actions/metrica-goals.ts";
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
  providerSchema,
  type CreateProviderConnectionInput,
  type ProjectRegistryAdminFormOptions,
  type ProviderConnectionListItem,
  type UpdateProviderConnectionInput,
} from "../../../modules/project-registry/contracts.ts";

const providerFormSchema = z.object({
  siteId: z.string().min(1),
  provider: providerSchema,
  externalId: z.string().trim(),
  enabled: z.boolean(),
  settingsJsonText: z.string().max(10000),
});
const updateProviderFormSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  externalId: z.string().trim(),
  enabled: z.boolean(),
  settingsJsonText: z.string().max(10000),
});
const providerLabels = {
  YANDEX_WEBMASTER: "Яндекс.Вебмастер",
  YANDEX_METRIKA: "Яндекс.Метрика",
  TOPVISOR: "Topvisor",
} as const;
const providerOptions = providerSchema.options.map((value) => ({ value, label: providerLabels[value] }));
function parseSettingsJson(text: string) {
  if (!text.trim()) return null;
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SETTINGS_JSON_INVALID");
  }
  if (Object.keys(parsed).some((key) => /(token|secret|password|credential|authorization|api.?key)/i.test(key))) {
    throw new Error("SETTINGS_JSON_SENSITIVE_KEY");
  }
  return parsed as Record<string, string | number | boolean | null>;
}

function applyProviderFieldErrors<TValues extends FieldValues>(
  fieldErrors: Record<string, string[]>,
  setError: UseFormSetError<TValues>,
) {
  applyFieldErrors(
    fieldErrors.settingsJson
      ? { ...fieldErrors, settingsJsonText: fieldErrors.settingsJson }
      : fieldErrors,
    setError,
  );
}
function ProviderConnectionEditCard({ item }: { item: ProviderConnectionListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof updateProviderFormSchema>>({
    resolver: zodResolver(updateProviderFormSchema) as Resolver<z.infer<typeof updateProviderFormSchema>>,
    defaultValues: {
      id: item.id,
      version: item.version,
      externalId: item.externalId ?? "",
      enabled: item.enabled,
      settingsJsonText: item.settingsJson ? JSON.stringify(item.settingsJson, null, 2) : "{}",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await updateProviderConnectionAction({
        id: values.id,
        version: values.version,
        externalId: values.externalId.trim() || null,
        enabled: values.enabled,
        settingsJson: parseSettingsJson(values.settingsJsonText),
      } satisfies UpdateProviderConnectionInput);
      if (!result.ok) {
        applyProviderFieldErrors(result.fieldErrors, form.setError);
        setFeedback(feedbackFrom(result));
        return;
      }
      setFeedback({ kind: "success", message: "Подключение обновлено" });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error && error.message === "SETTINGS_JSON_SENSITIVE_KEY"
        ? "Здесь нельзя хранить пароли, секретные ключи и другие данные для входа"
        : "Проверьте формат дополнительных настроек";
      form.setError("settingsJsonText", { message });
      setFeedback({ kind: "error", message });
    }
  });
  const leadCandidates = item.goalSuggestions.find((suggestion) => suggestion.category === "LEAD_SUBMIT")?.candidates ?? [];
  const phoneCandidates = item.goalSuggestions.find((suggestion) => suggestion.category === "PHONE_CLICK")?.candidates ?? [];
  const [leadGoalId, setLeadGoalId] = useState(leadCandidates.length === 1 ? leadCandidates[0]!.goalId : "");
  const [phoneGoalId, setPhoneGoalId] = useState(phoneCandidates.length === 1 ? phoneCandidates[0]!.goalId : "");
  const [confirmingGoals, setConfirmingGoals] = useState(false);
  async function confirmGoals() {
    setConfirmingGoals(true);
    const result = await confirmMetricaGoalsAction({ siteId: item.siteId, leadGoalId, phoneGoalId });
    setConfirmingGoals(false);
    if (!result.ok) { setFeedback(feedbackFrom(result)); return; }
    setFeedback({ kind: "success", message: "Цели Метрики подтверждены" });
    router.refresh();
  }

  return (
    <SectionCard title={`${item.siteName} · ${providerLabels[item.provider]}`} description={item.projectName}>
      {item.provider === "YANDEX_METRIKA" && item.status === "ACTION_REQUIRED" ? <div className="mb-4 grid gap-3 rounded-[var(--radius-panel)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4">
        <p className="text-sm font-semibold text-app-foreground">Подтвердите две цели Метрики</p>
        <FormField label="Основная заявка" required><SelectInput value={leadGoalId} onChange={(event) => setLeadGoalId(event.target.value)} options={[{ value: "", label: "Выберите цель" }, ...leadCandidates.map((goal) => ({ value: goal.goalId, label: goal.name }))]} /></FormField>
        <FormField label="Раскрытие телефона" required><SelectInput value={phoneGoalId} onChange={(event) => setPhoneGoalId(event.target.value)} options={[{ value: "", label: "Выберите цель" }, ...phoneCandidates.map((goal) => ({ value: goal.goalId, label: goal.name }))]} /></FormField>
        <Button disabled={confirmingGoals || !leadGoalId || !phoneGoalId || leadGoalId === phoneGoalId} onClick={confirmGoals} type="button">{confirmingGoals ? "Подтверждаем…" : "Подтвердить цели"}</Button>
      </div> : null}
      <form className="grid gap-4" onSubmit={submit}>
        <input type="hidden" {...form.register("id")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.externalId?.message} label="Номер в источнике">
          <TextInput {...form.register("externalId")} />
        </FormField>
        <FormField error={form.formState.errors.settingsJsonText?.message} helper="Служебные параметры без паролей и секретных ключей." label="Дополнительные настройки" required>
          <AreaInput rows={6} {...form.register("settingsJsonText")} />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground">
          <Controller control={form.control} name="enabled" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
          Источник включён
        </label>
        <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить подключение" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" />
      </form>
    </SectionCard>
  );
}

export function ProviderConnectionsAdminForms({ items, options }: { items: ProviderConnectionListItem[]; options: ProjectRegistryAdminFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof providerFormSchema>>({
    resolver: zodResolver(providerFormSchema) as Resolver<z.infer<typeof providerFormSchema>>,
    defaultValues: {
      siteId: options.sites[0]?.id ?? "",
      provider: "YANDEX_WEBMASTER",
      externalId: "",
      enabled: true,
      settingsJsonText: "{}",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await createProviderConnectionAction({
        siteId: values.siteId,
        provider: values.provider,
        externalId: values.externalId.trim() || null,
        enabled: values.enabled,
        settingsJson: parseSettingsJson(values.settingsJsonText),
      } satisfies CreateProviderConnectionInput);
      if (!result.ok) {
        applyProviderFieldErrors(result.fieldErrors, form.setError);
        setFeedback(feedbackFrom(result));
        return;
      }
      setFeedback({ kind: "success", message: "Подключение создано" });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error && error.message === "SETTINGS_JSON_SENSITIVE_KEY"
        ? "Здесь нельзя хранить пароли, секретные ключи и другие данные для входа"
        : "Проверьте формат дополнительных настроек";
      form.setError("settingsJsonText", { message });
      setFeedback({ kind: "error", message });
    }
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать подключение" description="Выберите сайт и источник данных. Пароли и секретные ключи здесь не хранятся.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <FormField error={form.formState.errors.siteId?.message} label="Сайт" required>
            <SelectInput options={options.sites.map((option) => ({ value: option.id, label: option.label }))} {...form.register("siteId")} />
          </FormField>
          <FormField error={form.formState.errors.provider?.message} label="Источник" required>
            <SelectInput options={providerOptions} {...form.register("provider")} />
          </FormField>
          <FormField error={form.formState.errors.externalId?.message} label="Номер в источнике">
            <TextInput {...form.register("externalId")} />
          </FormField>
          <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground xl:self-end">
            <Controller control={form.control} name="enabled" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
            Источник включён
          </label>
          <div className="sm:col-span-2">
            <FormField error={form.formState.errors.settingsJsonText?.message} helper="Служебные параметры без паролей и секретных ключей." label="Дополнительные настройки" required>
              <AreaInput rows={6} {...form.register("settingsJsonText")} />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать подключение" onRefresh={() => router.refresh()} pendingLabel="Создаём…" />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <ProviderConnectionEditCard item={item} key={item.id} />)}</div>
    </div>
  );
}

