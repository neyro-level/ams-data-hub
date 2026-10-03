"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { createMembershipInputSchema, removeMembershipInputSchema, tenantRoleSchema, updateMembershipInputSchema, type CreateMembershipInput, type IdentityAdminFormOptions, type MembershipListItem, type RemoveMembershipInput, type UpdateMembershipInput } from "../../../modules/identity-access/contracts.ts";
import { createMembershipAction, removeMembershipAction, updateMembershipAction } from "../_actions/identity.ts";
import { applyFieldErrors, feedbackFrom, FormField, SectionCard, SelectInput, SubmitRow, type Feedback } from "./platform-admin-form-primitives.tsx";

const tenantRoleLabels = {
  ORG_ADMIN: "Владелец организации",
  ORG_EDITOR: "Сотрудник организации",
  ORG_VIEWER: "Только просмотр",
} as const;
const tenantRoleOptions = tenantRoleSchema.options.map((value) => ({ value, label: tenantRoleLabels[value] }));

function MembershipEditCard({ item }: { item: MembershipListItem }) {
  const router = useRouter();
  const [updateFeedback, setUpdateFeedback] = useState<Feedback>(null);
  const [removeFeedback, setRemoveFeedback] = useState<Feedback>(null);
  const updateForm = useForm<UpdateMembershipInput>({ resolver: zodResolver(updateMembershipInputSchema) as Resolver<UpdateMembershipInput>, defaultValues: { organizationId: item.organizationId, membershipId: item.id, version: item.version, tenantRole: item.tenantRole } });
  const removeForm = useForm<RemoveMembershipInput>({ resolver: zodResolver(removeMembershipInputSchema) as Resolver<RemoveMembershipInput>, defaultValues: { organizationId: item.organizationId, membershipId: item.id, version: item.version } });
  const submitUpdate = updateForm.handleSubmit(async (values) => { const result = await updateMembershipAction(values); if (!result.ok) { applyFieldErrors(result.fieldErrors, updateForm.setError); setUpdateFeedback(feedbackFrom(result)); return; } setUpdateFeedback({ kind: "success", message: "Доступ обновлён" }); router.refresh(); });
  const submitRemove = removeForm.handleSubmit(async (values) => { const result = await removeMembershipAction(values); if (!result.ok) { applyFieldErrors(result.fieldErrors, removeForm.setError); setRemoveFeedback(feedbackFrom(result)); return; } setRemoveFeedback({ kind: "success", message: "Доступ отозван" }); router.refresh(); });
  return <SectionCard title={item.userName} description={`${item.userEmail} · ${item.organizationName}`}><div className="space-y-4"><form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitUpdate}><input type="hidden" {...updateForm.register("organizationId")} /><input type="hidden" {...updateForm.register("membershipId")} /><input type="hidden" {...updateForm.register("version", { valueAsNumber: true })} /><FormField error={updateForm.formState.errors.tenantRole?.message} label="Уровень доступа" required><SelectInput options={tenantRoleOptions} {...updateForm.register("tenantRole")} /></FormField><div className="self-end"><SubmitRow busy={updateForm.formState.isSubmitting} feedback={updateFeedback} label="Сохранить" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" variant="outline" /></div></form><form className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4" onSubmit={submitRemove}><input type="hidden" {...removeForm.register("organizationId")} /><input type="hidden" {...removeForm.register("membershipId")} /><input type="hidden" {...removeForm.register("version", { valueAsNumber: true })} /><SubmitRow busy={removeForm.formState.isSubmitting} feedback={removeFeedback} label={`Отозвать доступ: ${item.organizationName}`} onRefresh={() => router.refresh()} pendingLabel="Отзываем…" variant="ghost" /></form></div></SectionCard>;
}

function EnabledMembershipsAdminForms({ items, options }: {
  items: MembershipListItem[];
  options: IdentityAdminFormOptions;
}) {
  const router = useRouter(); const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<CreateMembershipInput>({ resolver: zodResolver(createMembershipInputSchema) as Resolver<CreateMembershipInput>, defaultValues: { organizationId: options.organizations[0]?.id ?? "", userId: options.users[0]?.id ?? "", tenantRole: "ORG_EDITOR" } });
  const submit = form.handleSubmit(async (values) => { const result = await createMembershipAction(values); if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; } form.reset({ organizationId: options.organizations[0]?.id ?? "", userId: options.users[0]?.id ?? "", tenantRole: "ORG_EDITOR" }); setFeedback({ kind: "success", message: "Доступ создан" }); router.refresh(); });
  return <div className="space-y-4"><SectionCard title="Добавить доступ" description="Выберите организацию, пользователя и разрешённый уровень работы."><form className="grid gap-4 sm:grid-cols-3" onSubmit={submit}><FormField error={form.formState.errors.organizationId?.message} label="Организация" required><SelectInput options={options.organizations.map((option) => ({ value: option.id, label: option.name }))} {...form.register("organizationId")} /></FormField><FormField error={form.formState.errors.userId?.message} label="Пользователь" required><SelectInput options={options.users.map((option) => ({ value: option.id, label: option.label }))} {...form.register("userId")} /></FormField><FormField error={form.formState.errors.tenantRole?.message} label="Уровень доступа" required><SelectInput options={tenantRoleOptions} {...form.register("tenantRole")} /></FormField><div className="sm:col-span-3"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Добавить доступ" onRefresh={() => router.refresh()} pendingLabel="Сохраняем…" /></div></form></SectionCard><div className="grid gap-4 xl:grid-cols-2">{items.map((item) => <MembershipEditCard item={item} key={item.id} />)}</div></div>;
}

export function MembershipsAdminForms({ items, options, clientAccessEnabled }: {
  items: MembershipListItem[];
  options: IdentityAdminFormOptions;
  clientAccessEnabled: boolean;
}) {
  if (!clientAccessEnabled) {
    return (
      <SectionCard
        title="Клиентские роли отключены"
        description="CLIENT_ACCESS_ENABLED=false: создание и редактирование membership скрыто до отдельного решения владельца."
      >
        <p className="text-sm text-app-secondary">
          Существующие записи остаются в журнале и таблице для контроля, но новые клиентские доступы не выдаются.
        </p>
      </SectionCard>
    );
  }

  return <EnabledMembershipsAdminForms items={items} options={options} />;
}
