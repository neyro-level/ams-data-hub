"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { createOrganizationInputSchema, updateOrganizationInputSchema, type CreateOrganizationInput, type OrganizationListItem, type UpdateOrganizationInput } from "../../../modules/identity-access/contracts.ts";
import { createOrganizationAction, updateOrganizationAction } from "../_actions/identity.ts";
import { applyFieldErrors, feedbackFrom, FormField, SectionCard, SubmitRow, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";

function OrganizationEditCard({ item }: { item: OrganizationListItem }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<UpdateOrganizationInput>({ resolver: zodResolver(updateOrganizationInputSchema) as Resolver<UpdateOrganizationInput>, defaultValues: { organizationId: item.id, version: item.version, slug: item.slug, name: item.name } });
  const submit = form.handleSubmit(async (values) => {
    const result = await updateOrganizationAction(values);
    if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; }
    setFeedback({ kind: "success", message: "Организация обновлена" });
    router.refresh();
  });
  return <SectionCard title={item.name} description={`${item.projectCount} проектов · ${item.membershipCount} участников`}><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}><input type="hidden" {...form.register("organizationId")} /><input type="hidden" {...form.register("version", { valueAsNumber: true })} /><FormField error={form.formState.errors.name?.message} label="Название" required><TextInput {...form.register("name")} /></FormField><FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" helper="Короткое имя для адреса страницы: латинские буквы, цифры и дефис." required><TextInput {...form.register("slug")} /></FormField><div className="sm:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Сохранить" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" /></div></form></SectionCard>;
}

export function OrganizationsAdminForms({ items }: { items: OrganizationListItem[] }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<CreateOrganizationInput>({ resolver: zodResolver(createOrganizationInputSchema) as Resolver<CreateOrganizationInput>, defaultValues: { slug: "", name: "" } });
  const submit = form.handleSubmit(async (values) => {
    const result = await createOrganizationAction(values);
    if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; }
    form.reset({ slug: "", name: "" }); setFeedback({ kind: "success", message: "Организация создана" }); router.refresh();
  });
  return <div className="space-y-4"><SectionCard title="Создать организацию" description="После создания можно добавить проекты, сайты и открыть доступ сотрудникам."><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}><FormField error={form.formState.errors.name?.message} label="Название" required><TextInput {...form.register("name")} /></FormField><FormField error={form.formState.errors.slug?.message} label="Адрес в кабинете" helper="Короткое имя для адреса страницы: латинские буквы, цифры и дефис." required><TextInput placeholder="client-name" {...form.register("slug")} /></FormField><div className="sm:col-span-2"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать организацию" onRefresh={() => router.refresh()} pendingLabel="Создаём…" /></div></form></SectionCard><div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <OrganizationEditCard item={item} key={item.id} />)}</div></div>;
}
