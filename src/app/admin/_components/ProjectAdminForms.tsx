"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import {
  createProjectInputSchema,
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
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createProjectAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    form.reset({ organizationId: options.organizations[0]?.id ?? "", slug: "", name: "", description: "", status: "ACTIVE" });
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
