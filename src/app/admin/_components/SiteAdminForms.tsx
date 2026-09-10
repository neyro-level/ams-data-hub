"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { Checkbox } from "../../../components/ui/checkbox.tsx";
import { createSiteAction, updateSiteAction } from "../_actions/sites.ts";
import {
  applyFieldErrors,
  feedbackFrom,
  FormField,
  SectionCard,
  SelectInput,
  SubmitRow,
  TextInput,
  type Feedback,
} from "./platform-admin-form-primitives.tsx";
import type {
  CreateSiteInput,
  ProjectRegistryAdminFormOptions,
  SiteListItem,
  UpdateSiteInput,
} from "../../../modules/project-registry/contracts.ts";

const siteFormSchema = z.object({
  projectId: z.string().min(1),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(2),
  url: z.url(),
  timezone: z.string().trim().min(1),
  enabled: z.boolean(),
});
const updateSiteFormSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(2),
  url: z.url(),
  timezone: z.string().trim().min(1),
  enabled: z.boolean(),
});
function SiteEditCard({ item }: { item: SiteListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof updateSiteFormSchema>>({
    resolver: zodResolver(updateSiteFormSchema) as Resolver<z.infer<typeof updateSiteFormSchema>>,
    defaultValues: {
      id: item.id,
      version: item.version,
      slug: item.slug,
      name: item.name,
      url: item.url,
      timezone: item.timezone,
      enabled: item.enabled,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await updateSiteAction(values satisfies UpdateSiteInput);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Сайт обновлён" });
    router.refresh();
  });

  return (
    <SectionCard title={item.name} description={`${item.projectName} · ${item.url}`}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <input type="hidden" {...form.register("id")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.name?.message} label="Название" required>
          <TextInput {...form.register("name")} />
        </FormField>
        <FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" helper="Короткое имя для адреса страницы." required>
          <TextInput {...form.register("slug")} />
        </FormField>
        <FormField error={form.formState.errors.url?.message} label="Адрес сайта" required>
          <TextInput {...form.register("url")} />
        </FormField>
        <FormField error={form.formState.errors.timezone?.message} label="Часовой пояс" required>
          <TextInput {...form.register("timezone")} />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground sm:col-span-2">
          <Controller control={form.control} name="enabled" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
          Сбор данных включён
        </label>
        <div className="sm:col-span-2">
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить сайт" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" />
        </div>
      </form>
    </SectionCard>
  );
}
export function SitesAdminForms({ items, options }: { items: SiteListItem[]; options: ProjectRegistryAdminFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<CreateSiteInput>({
    resolver: zodResolver(siteFormSchema) as Resolver<CreateSiteInput>,
    defaultValues: {
      projectId: options.projects[0]?.id ?? "",
      slug: "",
      name: "",
      url: "https://",
      timezone: "Europe/Moscow",
      enabled: true,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createSiteAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Сайт создан" });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать сайт" description="Сайт будет автоматически привязан к выбранному проекту и организации.">
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
          <FormField error={form.formState.errors.projectId?.message} label="Проект" required>
            <SelectInput options={options.projects.map((option) => ({ value: option.id, label: option.label }))} {...form.register("projectId")} />
          </FormField>
          <FormField error={form.formState.errors.name?.message} label="Название" required>
            <TextInput {...form.register("name")} />
          </FormField>
          <FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" helper="Короткое имя для адреса страницы." required>
            <TextInput {...form.register("slug")} />
          </FormField>
          <FormField error={form.formState.errors.url?.message} label="Адрес сайта" required>
            <TextInput {...form.register("url")} />
          </FormField>
          <FormField error={form.formState.errors.timezone?.message} label="Часовой пояс" required>
            <TextInput {...form.register("timezone")} />
          </FormField>
          <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium text-app-foreground xl:self-end">
            <Controller control={form.control} name="enabled" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={field.onChange} />} />
            Сбор данных включён
          </label>
          <div className="sm:col-span-2 xl:col-span-3">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать сайт" onRefresh={() => router.refresh()} pendingLabel="Создаём…" />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <SiteEditCard item={item} key={item.id} />)}</div>
    </div>
  );
}

