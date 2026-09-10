"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import {
  createQueryClusterProfileAction,
  updateQueryClusterProfileAction,
} from "../_actions/query-clusters.ts";
import {
  AreaInput,
  applyFieldErrors,
  feedbackFrom,
  FormField,
  SectionCard,
  SubmitRow,
  TextInput,
  type Feedback,
} from "./platform-admin-form-primitives.tsx";
import type {
  CreateQueryClusterProfileInput,
  QueryClusterProfileListItem,
  UpdateQueryClusterProfileInput,
} from "../../../modules/project-registry/contracts.ts";

const clusterFormSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(2),
  groupsJsonText: z.string().trim().min(2),
});
const updateClusterFormSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().trim().min(2),
  groupsJsonText: z.string().trim().min(2),
});

function applyClusterFieldErrors<TValues extends FieldValues>(
  fieldErrors: Record<string, string[]>,
  setError: UseFormSetError<TValues>,
) {
  applyFieldErrors(
    fieldErrors.groups ? { ...fieldErrors, groupsJsonText: fieldErrors.groups } : fieldErrors,
    setError,
  );
}

function parseGroupsJson(text: string) {
  return JSON.parse(text) as CreateQueryClusterProfileInput["groups"];
}

function QueryClusterProfileEditCard({ item }: { item: QueryClusterProfileListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof updateClusterFormSchema>>({
    resolver: zodResolver(updateClusterFormSchema) as Resolver<z.infer<typeof updateClusterFormSchema>>,
    defaultValues: {
      id: item.id,
      version: item.version,
      name: item.name,
      groupsJsonText: JSON.stringify(item.groups, null, 2),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await updateQueryClusterProfileAction({
        id: values.id,
        version: values.version,
        name: values.name,
        groups: parseGroupsJson(values.groupsJsonText),
      } satisfies UpdateQueryClusterProfileInput);
      if (!result.ok) {
        applyClusterFieldErrors(result.fieldErrors, form.setError);
        setFeedback(feedbackFrom(result));
        return;
      }
      setFeedback({ kind: "success", message: "Группы запросов обновлены" });
      router.refresh();
    } catch {
      form.setError("groupsJsonText", { message: "Проверьте формат списка групп" });
      setFeedback({ kind: "error", message: "Проверьте формат списка групп" });
    }
  });

  return (
    <SectionCard title={item.name} description={`${item.groups.length} групп запросов`}>
      <form className="grid gap-4" onSubmit={submit}>
        <input type="hidden" {...form.register("id")} />
        <input type="hidden" {...form.register("version", { valueAsNumber: true })} />
        <FormField error={form.formState.errors.name?.message} label="Название" required>
          <TextInput {...form.register("name")} />
        </FormField>
        <FormField error={form.formState.errors.groupsJsonText?.message} helper="Служебный список групп поисковых запросов." label="Группы запросов" required>
          <AreaInput rows={8} {...form.register("groupsJsonText")} />
        </FormField>
        <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить кластеры" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" />
      </form>
    </SectionCard>
  );
}


export function QueryClusterProfilesAdminForms({ items }: { items: QueryClusterProfileListItem[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<z.infer<typeof clusterFormSchema>>({
    resolver: zodResolver(clusterFormSchema) as Resolver<z.infer<typeof clusterFormSchema>>,
    defaultValues: { slug: "", name: "", groupsJsonText: "[]" },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await createQueryClusterProfileAction({
        slug: values.slug,
        name: values.name,
        groups: parseGroupsJson(values.groupsJsonText),
      } satisfies CreateQueryClusterProfileInput);
      if (!result.ok) {
        applyClusterFieldErrors(result.fieldErrors, form.setError);
        setFeedback(feedbackFrom(result));
        return;
      }
      setFeedback({ kind: "success", message: "Набор групп создан" });
      router.refresh();
    } catch {
      form.setError("groupsJsonText", { message: "Проверьте формат списка групп" });
      setFeedback({ kind: "error", message: "Проверьте формат списка групп" });
    }
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать набор групп" description="Объедините поисковые запросы в понятные смысловые группы.">
        <form className="grid gap-4" onSubmit={submit}>
          <FormField error={form.formState.errors.slug?.message} label="Короткое название" required><TextInput {...form.register("slug")} /></FormField>
          <FormField error={form.formState.errors.name?.message} label="Название" required><TextInput {...form.register("name")} /></FormField>
          <FormField error={form.formState.errors.groupsJsonText?.message} helper="Служебный список групп поисковых запросов." label="Группы запросов" required><AreaInput rows={8} {...form.register("groupsJsonText")} /></FormField>
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать кластеры" onRefresh={() => router.refresh()} pendingLabel="Создаём…" />
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <QueryClusterProfileEditCard item={item} key={item.id} />)}</div>
    </div>
  );
}
