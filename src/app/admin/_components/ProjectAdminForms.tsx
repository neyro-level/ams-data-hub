"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
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
import { createProjectAction, updateProjectAction } from "../_actions/projects.ts";
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

function ProjectEditCard({ item, options }: { item: ProjectListItem; options: ProjectFormOptions }) {
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
    </SectionCard>
  );
}

export function ProjectsAdminForms({ items, options }: { items: ProjectListItem[]; options: ProjectFormOptions }) {
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
        {items.map((item) => <ProjectEditCard item={item} key={item.id} options={options} />)}
      </div>
    </div>
  );
}
