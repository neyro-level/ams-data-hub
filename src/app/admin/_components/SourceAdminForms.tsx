"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import {
  createSourceInputSchema,
  sourceDatasetTypeSchema,
  type SourceAdminData,
  type SourceAdminDto,
  type SourceSchedulePolicy,
  updateSourceInputSchema,
} from "../../../modules/ingestion-core/index.ts";
import {
  createSourceAction,
  requestManualSourceRunAction,
  setSourceEnabledAction,
  updateSourceAction,
} from "../_actions/sources.ts";
import { applyFieldErrors, AreaInput, feedbackFrom, FormField, SectionCard, SelectInput, SubmitRow, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";

const datasetLabels = {
  MIXED_REALTY: "Смешанная недвижимость",
  RESALE: "Вторичная недвижимость",
  NEW_BUILD: "Новостройки",
  HOUSE: "Дома",
  LAND: "Земля",
  COMMERCIAL: "Коммерческая недвижимость",
  AGENT: "Агенты",
} as const;
const datasetOptions = sourceDatasetTypeSchema.options.map((value) => ({ value, label: datasetLabels[value] }));
const scheduleOptions = [
  { value: "MANUAL_ONLY", label: "Только вручную" },
  { value: "SCHEDULED", label: "По расписанию" },
];

const sourceFormSchema = z.object({
  projectId: z.string().min(1, "Выберите проект"),
  sourceKey: z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/u, "Латиница, цифры и дефис"),
  name: z.string().trim().min(1).max(200),
  endpointCredentialRef: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,127}$/u, "Имя переменной окружения в UPPER_SNAKE_CASE"),
  adapterKey: z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/u),
  adapterVersion: z.string().trim().min(1).max(64),
  profileKey: z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/u),
  profileVersion: z.string().trim().min(1).max(64),
  datasetType: sourceDatasetTypeSchema,
  scheduleMode: z.enum(["MANUAL_ONLY", "SCHEDULED"]),
  cadenceMinutes: z.coerce.number().int().min(5).max(10_080),
  expectedNamespace: z.string().trim().max(500),
  expectedProducer: z.string().trim().max(300),
});
type SourceFormValues = z.infer<typeof sourceFormSchema>;

function schedulePolicy(values: SourceFormValues): SourceSchedulePolicy {
  return values.scheduleMode === "SCHEDULED"
    ? { mode: "SCHEDULED", cadenceMinutes: values.cadenceMinutes }
    : { mode: "MANUAL_ONLY" };
}

function SourceFields({ form, projects, edit }: {
  form: ReturnType<typeof useForm<SourceFormValues>>;
  projects: SourceAdminData["projects"];
  edit?: boolean;
}) {
  const scheduled = form.watch("scheduleMode") === "SCHEDULED";
  return (
    <>
      <FormField error={form.formState.errors.projectId?.message} label="Проект" required>
        <SelectInput disabled={edit} options={projects.map((project) => ({ value: project.id, label: `${project.organizationName} · ${project.name}` }))} {...form.register("projectId")} />
      </FormField>
      {!edit ? <FormField error={form.formState.errors.sourceKey?.message} label="Ключ источника" required><TextInput placeholder="mixed-realty" {...form.register("sourceKey")} /></FormField> : null}
      <FormField error={form.formState.errors.name?.message} label="Название" required><TextInput {...form.register("name")} /></FormField>
      <FormField error={form.formState.errors.endpointCredentialRef?.message} helper={edit ? "Оставьте пустым, чтобы сохранить текущую ссылку." : "Только имя переменной окружения; URL и секрет сюда не вводятся."} label="Endpoint SecretRef" required={!edit}>
        <TextInput autoComplete="off" placeholder={edit ? "Без изменения" : "PROJECT_FEED_ENDPOINT"} {...form.register("endpointCredentialRef")} />
      </FormField>
      <FormField error={form.formState.errors.adapterKey?.message} label="Adapter key" required><TextInput placeholder="yrl-realty-2010" {...form.register("adapterKey")} /></FormField>
      <FormField error={form.formState.errors.adapterVersion?.message} label="Adapter version" required><TextInput placeholder="1.0.0" {...form.register("adapterVersion")} /></FormField>
      <FormField error={form.formState.errors.profileKey?.message} label="Profile key" required><TextInput placeholder="default-v1" {...form.register("profileKey")} /></FormField>
      <FormField error={form.formState.errors.profileVersion?.message} label="Profile version" required><TextInput placeholder="1.0.0" {...form.register("profileVersion")} /></FormField>
      <FormField error={form.formState.errors.datasetType?.message} label="Dataset" required><SelectInput options={datasetOptions} {...form.register("datasetType")} /></FormField>
      <FormField error={form.formState.errors.scheduleMode?.message} label="Запуск" required><SelectInput options={scheduleOptions} {...form.register("scheduleMode")} /></FormField>
      {scheduled ? <FormField error={form.formState.errors.cadenceMinutes?.message} label="Интервал, минут" required><TextInput min={5} type="number" {...form.register("cadenceMinutes", { valueAsNumber: true })} /></FormField> : null}
      <FormField error={form.formState.errors.expectedNamespace?.message} label="Ожидаемый XML namespace"><TextInput {...form.register("expectedNamespace")} /></FormField>
      <div className="md:col-span-2"><FormField error={form.formState.errors.expectedProducer?.message} label="Ожидаемый producer"><AreaInput rows={2} {...form.register("expectedProducer")} /></FormField></div>
    </>
  );
}

function SourceEditCard({ source, projects }: { source: SourceAdminDto; projects: SourceAdminData["projects"] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema.extend({ endpointCredentialRef: z.union([z.literal(""), sourceFormSchema.shape.endpointCredentialRef]) })) as Resolver<SourceFormValues>,
    defaultValues: {
      projectId: source.projectId, sourceKey: source.sourceKey, name: source.name, endpointCredentialRef: "",
      adapterKey: source.adapterKey, adapterVersion: source.adapterVersion, profileKey: source.profileKey, profileVersion: source.profileVersion,
      datasetType: source.datasetType, scheduleMode: source.schedulePolicy.mode,
      cadenceMinutes: source.schedulePolicy.mode === "SCHEDULED" ? source.schedulePolicy.cadenceMinutes : 60,
      expectedNamespace: source.expectedNamespace ?? "", expectedProducer: source.expectedProducer ?? "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const raw = {
      organizationId: source.organizationId, projectId: source.projectId, sourceId: source.sourceId, version: source.version,
      name: values.name, adapterKey: values.adapterKey, adapterVersion: values.adapterVersion, profileKey: values.profileKey,
      profileVersion: values.profileVersion, datasetType: values.datasetType, schedulePolicy: schedulePolicy(values), safetyPolicyId: "",
      expectedNamespace: values.expectedNamespace, expectedProducer: values.expectedProducer,
      ...(values.endpointCredentialRef ? { endpointCredentialRef: values.endpointCredentialRef } : {}),
    };
    const result = await updateSourceAction(updateSourceInputSchema.parse(raw));
    if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; }
    setFeedback({ kind: "success", message: "Источник обновлён" }); router.refresh();
  });
  const toggle = async () => {
    const result = await setSourceEnabledAction({ organizationId: source.organizationId, projectId: source.projectId, sourceId: source.sourceId, version: source.version, enabled: !source.enabled });
    setFeedback(result.ok ? { kind: "success", message: source.enabled ? "Источник отключён" : "Источник включён" } : feedbackFrom(result));
    if (result.ok) router.refresh();
  };
  const requestRun = async () => {
    const result = await requestManualSourceRunAction({ organizationId: source.organizationId, projectId: source.projectId, sourceId: source.sourceId, idempotencyKey: crypto.randomUUID() });
    setFeedback(result.ok ? { kind: "success", message: result.data.duplicate ? "Запрос уже был зарегистрирован" : "Запрос ручного запуска зарегистрирован" } : feedbackFrom(result));
    if (result.ok) router.refresh();
  };
  const project = projects.find((item) => item.id === source.projectId);
  return (
    <SectionCard title={source.name} description={`${project?.organizationName ?? "Организация"} · ${project?.name ?? "Проект"} · ${source.enabled ? "включён" : "отключён"}`}>
      <div className="mb-4 grid gap-2 text-sm text-app-secondary sm:grid-cols-2">
        <p>Credential: {source.credential.displayValue} · {source.credential.configured ? "настроен" : "не настроен"}</p>
        <p>Ручных запусков в ожидании: {source.pendingManualRuns}</p>
        <p>Последняя попытка: {source.lastAttemptAt ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(source.lastAttemptAt) : "ещё не было"}</p>
        <p>Последний GOOD: {source.lastGoodRevisionId ? "зафиксирован" : "ещё не сформирован"}</p>
      </div>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <SourceFields edit form={form} projects={projects} />
        <div className="md:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить конфигурацию" onRefresh={() => router.refresh()} pendingLabel="Сохраняем..." /></div>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="min-h-11 rounded-[var(--radius)] border border-app-border px-4 text-sm font-semibold" onClick={toggle} type="button">{source.enabled ? "Отключить" : "Включить"}</button>
        <button className="min-h-11 rounded-[var(--radius)] border border-app-border px-4 text-sm font-semibold" onClick={requestRun} type="button">Запустить вручную</button>
      </div>
    </SectionCard>
  );
}

export function SourceAdminForms({ data }: { data: SourceAdminData }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema) as Resolver<SourceFormValues>,
    defaultValues: {
      projectId: data.projects[0]?.id ?? "", sourceKey: "", name: "", endpointCredentialRef: "", adapterKey: "", adapterVersion: "1.0.0",
      profileKey: "", profileVersion: "1.0.0", datasetType: "MIXED_REALTY", scheduleMode: "MANUAL_ONLY", cadenceMinutes: 60,
      expectedNamespace: "", expectedProducer: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const project = data.projects.find((item) => item.id === values.projectId);
    if (!project) { form.setError("projectId", { message: "Проект недоступен" }); return; }
    const result = await createSourceAction(createSourceInputSchema.parse({
      organizationId: project.organizationId, projectId: project.id, sourceKey: values.sourceKey, name: values.name,
      endpointCredentialRef: values.endpointCredentialRef, adapterKey: values.adapterKey, adapterVersion: values.adapterVersion,
      profileKey: values.profileKey, profileVersion: values.profileVersion, datasetType: values.datasetType,
      transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: schedulePolicy(values), safetyPolicyId: "",
      expectedNamespace: values.expectedNamespace, expectedProducer: values.expectedProducer,
    }));
    if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; }
    setFeedback({ kind: "success", message: "Источник создан отключённым" }); router.refresh();
  });
  return (
    <div className="space-y-4">
      <SectionCard title="Создать источник" description="Endpoint передаётся только через SecretRef; новый источник всегда создаётся отключённым.">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          <SourceFields form={form} projects={data.projects} />
          <div className="md:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать источник" onRefresh={() => router.refresh()} pendingLabel="Создаём..." /></div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{data.sources.map((source) => <SourceEditCard key={source.sourceId} projects={data.projects} source={source} />)}</div>
    </div>
  );
}
