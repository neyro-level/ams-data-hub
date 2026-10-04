"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { ButtonLink } from "../../../components/ui/button-link.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs.tsx";
import {
  createProjectInputSchema,
  projectServiceStateSchema,
  projectStatusSchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type ProjectFormOptions,
  type ProjectListItem,
  type UpdateProjectInput,
} from "../../../modules/project-registry/index.ts";
import {
  agentListingPresenceStatusSchema,
  agentRoleSchema,
  agentStatusSchema,
  type AgentAdminItem,
  type AgentMediaOption,
  type ProjectPublicContactAdminItem,
} from "../../../modules/project-state/index.ts";
import { confirmAgentConsentBatchAction, createProjectAction, replaceProjectPublicContactAction, saveManualAgentAction, updateProjectAction } from "../_actions/projects.ts";
import { applyFieldErrors, AreaInput, feedbackFrom, FormField, SectionCard, SelectInput, SubmitRow, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";

const statusLabels = {
  ACTIVE: "Активен",
  PLANNED: "Планируется",
  DISABLED: "Отключён",
} as const;
const statusOptions = projectStatusSchema.options.map((value) => ({ value, label: statusLabels[value] }));
const serviceStateLabels = {
  ACTIVE: "Сервис активен",
  SUSPENDED: "Сервис приостановлен",
} as const;
const serviceStateOptions = projectServiceStateSchema.options.map((value) => ({
  value,
  label: serviceStateLabels[value],
}));

const contactFormSchema = z.object({
  phone: z.string().trim().min(5, "Укажите телефон").max(40),
  email: z.union([z.literal(""), z.email("Укажите корректный email")]),
  addressPublic: z.string().trim().max(500),
  messengersText: z.string().trim().superRefine((value, context) => {
    const links = value.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
    if (links.length > 10) context.addIssue({ code: "custom", message: "Не более 10 ссылок" });
    links.forEach((link, index) => {
      try {
        const url = new URL(link);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
      } catch {
        context.addIssue({ code: "custom", message: `Строка ${index + 1}: укажите полный http(s)-адрес` });
      }
    });
  }),
  hours: z.string().trim().max(500),
});
type ContactFormInput = z.infer<typeof contactFormSchema>;

const agentFormSchema = z.object({
  fullName: z.string().trim().min(2, "Укажите имя").max(240),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Используйте латиницу, цифры и дефис"),
  role: agentRoleSchema,
  position: z.string().trim().max(240),
  bio: z.string().trim().max(4000),
  specializationsText: z.string().trim(),
  photoMediaId: z.string(),
  workPhone: z.string().trim().max(40),
  workEmail: z.union([z.literal(""), z.email("Укажите корректный email")]),
  messengersText: z.string().trim(),
  showOnSite: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
  status: agentStatusSchema,
  listingPresenceStatus: agentListingPresenceStatusSchema,
});
type AgentFormInput = z.infer<typeof agentFormSchema>;

const consentBatchFormSchema = z.object({
  agentUids: z.array(z.string()).min(1, "Выберите хотя бы одного агента"),
  confirmedBy: z.string().trim().min(2, "Укажите, кто подтвердил").max(240),
  confirmedAtLocal: z.string().min(1, "Укажите дату и время").refine((value) => !Number.isNaN(Date.parse(value)), "Укажите корректную дату"),
  basis: z.string().trim().min(1, "Укажите основание").max(1000),
  referenceUrl: z.union([z.literal(""), z.url("Укажите полную http(s)-ссылку")]),
  note: z.string().trim().max(2000),
  confirmSuspicious: z.boolean(),
});
type ConsentBatchFormInput = z.infer<typeof consentBatchFormSchema>;

const agentRoleLabels = { AGENT: "Агент", LAWYER: "Юрист", MORTGAGE_BROKER: "Ипотечный брокер", MANAGER: "Менеджер", OTHER: "Другое" } as const;
const agentStatusLabels = { ACTIVE: "Активен", HIDDEN: "Скрыт", DEPARTED: "Ушёл" } as const;
const listingStatusLabels = { HAS_ACTIVE_LISTINGS: "Есть активные объекты", NO_ACTIVE_LISTINGS: "Нет активных объектов", UNKNOWN: "Неизвестно" } as const;

function AgentForm({ project, agent, media }: { project: ProjectListItem; agent?: AgentAdminItem; media: AgentMediaOption[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<AgentFormInput>({
    resolver: zodResolver(agentFormSchema) as Resolver<AgentFormInput>,
    defaultValues: {
      fullName: agent?.fullName ?? "",
      slug: agent?.slug ?? "",
      role: agent?.role ?? "AGENT",
      position: agent?.position ?? "",
      bio: agent?.bio ?? "",
      specializationsText: agent?.specializations.join("\n") ?? "",
      photoMediaId: agent?.photoMediaId ?? "",
      workPhone: agent?.workPhone ?? "",
      workEmail: agent?.workEmail ?? "",
      messengersText: agent?.messengers.join("\n") ?? "",
      showOnSite: agent?.showOnSite ?? false,
      sortOrder: agent?.sortOrder ?? 0,
      status: agent?.status ?? "ACTIVE",
      listingPresenceStatus: agent?.listingPresenceStatus ?? "UNKNOWN",
    },
  });
  const feedOwned = agent?.origin === "FEED";
  const submit = form.handleSubmit(async (values) => {
    const result = await saveManualAgentAction({
      organizationId: project.organizationId,
      projectId: project.id,
      agentUid: agent?.uid,
      version: agent?.version ?? 0,
      origin: agent?.origin ?? "MANUAL",
      fullName: values.fullName,
      slug: values.slug,
      role: values.role,
      position: values.position,
      bio: values.bio,
      specializations: values.specializationsText.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
      photoMediaId: values.photoMediaId || null,
      workPhone: values.workPhone,
      workEmail: values.workEmail,
      messengers: values.messengersText.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
      showOnSite: values.showOnSite,
      sortOrder: values.sortOrder,
      status: values.status,
      listingPresenceStatus: values.listingPresenceStatus,
    });
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: agent ? "Агент обновлён" : "Агент создан" });
    router.refresh();
  });
  return (
    <form className="grid gap-4 rounded-[var(--radius-panel)] border border-app-border p-4 md:grid-cols-2" onSubmit={submit}>
      <div className="md:col-span-2">
        <h4 className="font-semibold text-app-foreground">{agent ? agent.fullName : "Добавить агента"}</h4>
        <p className="text-sm text-app-secondary">{feedOwned ? "ФИО и рабочие контакты принадлежат фиду; ручные поля остаются редактируемыми." : "Ручной профиль проекта."} {agent ? (agent.isPubliclyPublishable ? "Публичная карточка разрешена." : "Публичная карточка скрыта до выполнения всех условий публикации.") : ""}</p>
      </div>
      <FormField error={form.formState.errors.fullName?.message} label="ФИО" required>
        <TextInput readOnly={feedOwned} {...form.register("fullName")} />
      </FormField>
      <FormField error={form.formState.errors.slug?.message} label="Slug" required><TextInput {...form.register("slug")} /></FormField>
      <FormField label="Роль"><SelectInput options={agentRoleSchema.options.map((value) => ({ value, label: agentRoleLabels[value] }))} {...form.register("role")} /></FormField>
      <FormField label="Должность"><TextInput {...form.register("position")} /></FormField>
      <div className="md:col-span-2"><FormField label="Описание"><AreaInput rows={3} {...form.register("bio")} /></FormField></div>
      <FormField helper="Одна специализация в строке." label="Специализации"><AreaInput rows={3} {...form.register("specializationsText")} /></FormField>
      <FormField helper="Выберите фото, ранее прошедшее безопасную загрузку медиа." label="Фото">
        <SelectInput options={[{ value: "", label: "Без фото" }, ...media.map((item) => ({ value: item.id, label: item.originalFileName }))]} {...form.register("photoMediaId")} />
      </FormField>
      <FormField label="Рабочий телефон"><TextInput readOnly={feedOwned} {...form.register("workPhone")} /></FormField>
      <FormField label="Рабочий email"><TextInput readOnly={feedOwned} type="email" {...form.register("workEmail")} /></FormField>
      <FormField helper="Одна полная http(s)-ссылка в строке." label="Мессенджеры"><AreaInput rows={3} {...form.register("messengersText")} /></FormField>
      <FormField label="Наличие объектов"><SelectInput options={agentListingPresenceStatusSchema.options.map((value) => ({ value, label: listingStatusLabels[value] }))} {...form.register("listingPresenceStatus")} /></FormField>
      <FormField label="Статус"><SelectInput options={agentStatusSchema.options.map((value) => ({ value, label: agentStatusLabels[value] }))} {...form.register("status")} /></FormField>
      <FormField label="Порядок"><TextInput type="number" {...form.register("sortOrder", { valueAsNumber: true })} /></FormField>
      <label className="flex items-center gap-2 text-sm font-medium text-app-foreground"><input type="checkbox" {...form.register("showOnSite")} /> Показывать на сайте</label>
      <div className="md:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить агента" onRefresh={() => router.refresh()} pendingLabel="Сохраняем..." /></div>
    </form>
  );
}

function AgentConsentBatchForm({ project, agents }: { project: ProjectListItem; agents: AgentAdminItem[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<ConsentBatchFormInput>({
    resolver: zodResolver(consentBatchFormSchema) as Resolver<ConsentBatchFormInput>,
    defaultValues: { agentUids: [], confirmedBy: "", confirmedAtLocal: "", basis: "", referenceUrl: "", note: "", confirmSuspicious: false },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await confirmAgentConsentBatchAction({
      organizationId: project.organizationId,
      projectId: project.id,
      agentUids: values.agentUids,
      confirmedBy: values.confirmedBy,
      confirmedAt: new Date(values.confirmedAtLocal).toISOString(),
      basis: values.basis,
      referenceUrl: values.referenceUrl,
      note: values.note,
      confirmSuspicious: values.confirmSuspicious,
    });
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    if (result.data.state === "SUSPICIOUS") {
      setFeedback({ kind: "error", message: `Операция затрагивает ${result.data.affected} из ${result.data.total} агентов и требует отдельного подтверждения.` });
      return;
    }
    setFeedback({ kind: "success", message: `Согласие записано для ${result.data.affected} агентов.` });
    form.reset();
    router.refresh();
  });
  if (agents.length === 0) return null;
  return (
    <form className="grid gap-4 rounded-[var(--radius-panel)] border border-app-border p-4 md:grid-cols-2" onSubmit={submit}>
      <div className="md:col-span-2">
        <h4 className="font-semibold text-app-foreground">Пакет подтверждений согласия</h4>
        <p className="text-sm text-app-secondary">Запись фиксирует основание и аудит. Публикация разрешена только активному, включённому агенту с подтверждённым согласием.</p>
      </div>
      <div className="grid gap-2 md:col-span-2">
        {agents.map((agent) => (
          <label className="flex items-center gap-2 text-sm text-app-foreground" key={agent.uid}>
            <input type="checkbox" value={agent.uid} {...form.register("agentUids")} />
            {agent.fullName} · {agent.consentConfirmedAt ? "согласие записано" : "согласия нет"}
          </label>
        ))}
        {form.formState.errors.agentUids?.message ? <p className="text-sm text-app-destructive">{form.formState.errors.agentUids.message}</p> : null}
      </div>
      <FormField error={form.formState.errors.confirmedBy?.message} label="Кто подтвердил" required><TextInput {...form.register("confirmedBy")} /></FormField>
      <FormField error={form.formState.errors.confirmedAtLocal?.message} label="Дата и время" required><TextInput type="datetime-local" {...form.register("confirmedAtLocal")} /></FormField>
      <div className="md:col-span-2"><FormField error={form.formState.errors.basis?.message} label="Основание" required><AreaInput rows={2} {...form.register("basis")} /></FormField></div>
      <FormField error={form.formState.errors.referenceUrl?.message} label="Ссылка на подтверждение"><TextInput type="url" {...form.register("referenceUrl")} /></FormField>
      <FormField error={form.formState.errors.note?.message} label="Примечание"><AreaInput rows={2} {...form.register("note")} /></FormField>
      <label className="flex items-center gap-2 text-sm font-medium text-app-foreground md:col-span-2"><input type="checkbox" {...form.register("confirmSuspicious")} /> Подтверждаю массовую операцию, если она затрагивает более 30% агентов проекта</label>
      <div className="md:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Записать пакет" onRefresh={() => router.refresh()} pendingLabel="Записываем..." /></div>
    </form>
  );
}

function ProjectContactForm({ item, contact }: { item: ProjectListItem; contact?: ProjectPublicContactAdminItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<ContactFormInput>({
    resolver: zodResolver(contactFormSchema) as Resolver<ContactFormInput>,
    defaultValues: {
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      addressPublic: contact?.addressPublic ?? "",
      messengersText: contact?.messengers.join("\n") ?? "",
      hours: contact?.hours ?? "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await replaceProjectPublicContactAction({
      organizationId: item.organizationId,
      projectId: item.id,
      version: contact?.version ?? 0,
      phone: values.phone,
      email: values.email,
      addressPublic: values.addressPublic,
      messengers: values.messengersText.split(/\r?\n/).map((link) => link.trim()).filter(Boolean),
      hours: values.hours,
    });
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Публичный контакт сохранён" });
    router.refresh();
  });
  return (
    <form className="grid gap-4 border-t border-app-border pt-4 md:grid-cols-2" onSubmit={submit}>
      <div className="md:col-span-2">
        <h3 className="font-semibold text-app-foreground">Публичный контакт</h3>
        <p className="text-sm text-app-secondary">Единственный fallback-контакт агентства для публичной выдачи.</p>
      </div>
      <FormField error={form.formState.errors.phone?.message} label="Телефон" required>
        <Controller control={form.control} name="phone" render={({ field }) => <TextInput autoComplete="tel" {...field} />} />
      </FormField>
      <FormField error={form.formState.errors.email?.message} label="Email">
        <Controller control={form.control} name="email" render={({ field }) => <TextInput autoComplete="email" type="email" {...field} />} />
      </FormField>
      <div className="md:col-span-2">
        <FormField error={form.formState.errors.addressPublic?.message} label="Публичный адрес">
          <Controller control={form.control} name="addressPublic" render={({ field }) => <AreaInput rows={2} {...field} />} />
        </FormField>
      </div>
      <FormField error={form.formState.errors.messengersText?.message} helper="Одна полная http(s)-ссылка в строке." label="Мессенджеры">
        <Controller control={form.control} name="messengersText" render={({ field }) => <AreaInput rows={3} placeholder="https://t.me/example" {...field} />} />
      </FormField>
      <FormField error={form.formState.errors.hours?.message} label="Часы работы">
        <Controller control={form.control} name="hours" render={({ field }) => <AreaInput rows={3} placeholder="Пн–Пт, 09:00–18:00" {...field} />} />
      </FormField>
      <div className="md:col-span-2">
        <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить контакт" onRefresh={() => router.refresh()} pendingLabel="Сохраняем..." />
      </div>
    </form>
  );
}

function ProjectModuleState({ title, description, state }: { title: string; description: string; state: "READY" | "FUTURE" }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-app-border bg-[var(--card)] p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-app-foreground">{title}</h3>
        <span className="rounded-full border border-app-border px-2.5 py-1 text-xs font-semibold text-app-secondary">
          {state === "READY" ? "Контракт готов" : "Следующий этап"}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-app-secondary">{description}</p>
    </section>
  );
}

function ProjectEditCard({ item, options, contact, agents, media }: { item: ProjectListItem; options: ProjectFormOptions; contact?: ProjectPublicContactAdminItem; agents: AgentAdminItem[]; media: AgentMediaOption[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<UpdateProjectInput>({
    resolver: zodResolver(updateProjectInputSchema) as Resolver<UpdateProjectInput>,
    defaultValues: {
      projectId: item.id,
      organizationId: item.organizationId,
      version: item.version,
      slug: item.slug,
      name: item.name,
      description: item.description ?? "",
      status: item.status,
      serviceState: item.serviceState,
      siteBaseUrl: item.siteBaseUrl ?? "",
      publicUrlPolicyVersion: item.publicUrlPolicyVersion ?? "",
      notes: item.notes ?? "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await updateProjectAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Проект обновлён" });
    router.refresh();
  });
  return (
    <SectionCard title={item.name} description={`${item.organizationName} · ${statusLabels[item.status]}`}>
      <div className="space-y-4">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <input type="hidden" {...form.register("projectId")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.organizationId?.message} label="Организация" required>
          <SelectInput options={options.organizations.map((option) => ({ value: option.id, label: option.name }))} {...form.register("organizationId")} />
        </FormField>
        <FormField error={form.formState.errors.status?.message} label="Статус" required>
          <SelectInput options={statusOptions} {...form.register("status")} />
        </FormField>
        <FormField error={form.formState.errors.serviceState?.message} label="Состояние сервиса" required>
          <SelectInput options={serviceStateOptions} {...form.register("serviceState")} />
        </FormField>
        <FormField error={form.formState.errors.name?.message} label="Название" required>
          <TextInput {...form.register("name")} />
        </FormField>
        <FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" required>
          <TextInput {...form.register("slug")} />
        </FormField>
        <div className="md:col-span-2">
          <FormField error={form.formState.errors.description?.message} label="Описание">
            <AreaInput rows={3} {...form.register("description")} />
          </FormField>
        </div>
        <FormField error={form.formState.errors.siteBaseUrl?.message} label="Основной URL сайта">
          <TextInput placeholder="https://example.ru" type="url" {...form.register("siteBaseUrl")} />
        </FormField>
        <FormField error={form.formState.errors.publicUrlPolicyVersion?.message} label="Версия URL-политики">
          <TextInput placeholder="v1" {...form.register("publicUrlPolicyVersion")} />
        </FormField>
        <div className="md:col-span-2">
          <FormField error={form.formState.errors.notes?.message} label="Операционные заметки">
            <AreaInput rows={3} {...form.register("notes")} />
          </FormField>
        </div>
        <div className="md:col-span-2">
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить" onRefresh={() => router.refresh()} pendingLabel="Сохраняем..." />
        </div>
      </form>
      <Tabs defaultValue="contacts">
        <TabsList aria-label={`Разделы проекта ${item.name}`}>
          <TabsTrigger value="contacts">Контакты</TabsTrigger>
          <TabsTrigger value="agents">Агенты</TabsTrigger>
          <TabsTrigger value="editorial">Редактура</TabsTrigger>
          <TabsTrigger value="urls">URL и редиректы</TabsTrigger>
          <TabsTrigger value="catalog">Подписка на каталог</TabsTrigger>
          <TabsTrigger value="sources">Источники</TabsTrigger>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <ProjectContactForm contact={contact} item={item} key={`${item.id}:${contact?.version ?? 0}`} />
        </TabsContent>
        <TabsContent value="agents">
          <div className="space-y-3">
            <AgentConsentBatchForm agents={agents} project={item} />
            {agents.map((agent) => <AgentForm agent={agent} key={`${agent.uid}:${agent.version}`} media={media} project={item} />)}
            <AgentForm key={`new:${item.id}`} media={media} project={item} />
          </div>
        </TabsContent>
        <TabsContent value="editorial">
          <ProjectModuleState description="Серверный контракт редакционных полей и безопасного порядка медиа подключён к проекту. Раздел не переносит сюда логику будущего снимка данных." state="READY" title="Редактура проекта" />
        </TabsContent>
        <TabsContent value="urls">
          <ProjectModuleState description="Политика URL, стабильный публичный идентификатор, история путей и редиректы принадлежат данным проекта. Публикация снимка из этого раздела не запускается." state="READY" title="URL и редиректы" />
        </TabsContent>
        <TabsContent value="catalog">
          <div className="space-y-3">
            <ProjectModuleState description="Общий каталог и выбор проектной подписки остаются отдельной областью продукта. Откройте каталог для проверки доступных городов, застройщиков и ЖК." state="READY" title="Подписка на общий каталог" />
            <ButtonLink href="/admin/catalog/" variant="outline">Открыть каталог</ButtonLink>
          </div>
        </TabsContent>
        <TabsContent value="sources">
          <ProjectModuleState description="Источники появятся после выполнения DH-06. До этого раздел не создаёт источник данных, не запускает импорт и не показывает фиктивные элементы управления." state="FUTURE" title="Источники пока недоступны" />
        </TabsContent>
        <TabsContent value="snapshot">
          <ProjectModuleState description="Snapshot появится после выполнения DH-05. Текущий экран не собирает, не подписывает и не доставляет снимки данных." state="FUTURE" title="Snapshot пока недоступен" />
        </TabsContent>
      </Tabs>
      </div>
    </SectionCard>
  );
}

export function ProjectsAdminForms({ items, options, contacts, agents, media }: { items: ProjectListItem[]; options: ProjectFormOptions; contacts: ProjectPublicContactAdminItem[]; agents: AgentAdminItem[]; media: AgentMediaOption[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectInputSchema) as Resolver<CreateProjectInput>,
    defaultValues: {
      organizationId: options.organizations[0]?.id ?? "",
      slug: "",
      name: "",
      description: "",
      status: "ACTIVE",
      serviceState: "ACTIVE",
      siteBaseUrl: "",
      publicUrlPolicyVersion: "",
      notes: "",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createProjectAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    form.reset({
      organizationId: options.organizations[0]?.id ?? "",
      slug: "",
      name: "",
      description: "",
      status: "ACTIVE",
      serviceState: "ACTIVE",
      siteBaseUrl: "",
      publicUrlPolicyVersion: "",
      notes: "",
    });
    setFeedback({ kind: "success", message: "Проект создан" });
    router.refresh();
  });
  return (
    <div className="space-y-4">
      <SectionCard title="Создать проект" description="Нейтральная рабочая сущность для будущего продукта.">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          <FormField error={form.formState.errors.organizationId?.message} label="Организация" required>
            <SelectInput options={options.organizations.map((option) => ({ value: option.id, label: option.name }))} {...form.register("organizationId")} />
          </FormField>
          <FormField error={form.formState.errors.status?.message} label="Статус" required>
            <SelectInput options={statusOptions} {...form.register("status")} />
          </FormField>
          <FormField error={form.formState.errors.serviceState?.message} label="Состояние сервиса" required>
            <SelectInput options={serviceStateOptions} {...form.register("serviceState")} />
          </FormField>
          <FormField error={form.formState.errors.name?.message} label="Название" required>
            <TextInput {...form.register("name")} />
          </FormField>
          <FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" helper="Короткое имя для адреса страницы: латинские буквы, цифры и дефис." required>
            <TextInput placeholder="first-project" {...form.register("slug")} />
          </FormField>
          <div className="md:col-span-2">
            <FormField error={form.formState.errors.description?.message} label="Описание">
              <AreaInput rows={3} {...form.register("description")} />
            </FormField>
          </div>
          <FormField error={form.formState.errors.siteBaseUrl?.message} label="Основной URL сайта">
            <TextInput placeholder="https://example.ru" type="url" {...form.register("siteBaseUrl")} />
          </FormField>
          <FormField error={form.formState.errors.publicUrlPolicyVersion?.message} label="Версия URL-политики">
            <TextInput placeholder="v1" {...form.register("publicUrlPolicyVersion")} />
          </FormField>
          <div className="md:col-span-2">
            <FormField error={form.formState.errors.notes?.message} label="Операционные заметки">
              <AreaInput rows={3} {...form.register("notes")} />
            </FormField>
          </div>
          <div className="md:col-span-2">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать проект" onRefresh={() => router.refresh()} pendingLabel="Создаём..." />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => <ProjectEditCard agents={agents.filter((agent) => agent.projectId === item.id)} contact={contacts.find((contact) => contact.projectId === item.id)} item={item} key={item.id} media={media.filter((asset) => asset.projectId === item.id)} options={options} />)}
      </div>
    </div>
  );
}
