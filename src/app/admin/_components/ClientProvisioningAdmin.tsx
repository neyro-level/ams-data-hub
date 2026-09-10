"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { Button } from "../../../components/ui/button.tsx";
import { ConfirmActionDialog } from "../../../components/ui/confirm-action-dialog.tsx";
import { FieldGroup } from "../../../components/ui/field.tsx";
import { provisionClientInputSchema, resetUserPasswordInputSchema, tenantRoleSchema, type IdentityAdminUserListItem, type ProvisionClientInput, type ResetUserPasswordInput } from "../../../modules/identity-access/contracts.ts";
import type { TopvisorRegionOption } from "../../../modules/project-registry/contracts.ts";
import { provisionClientAction, resetUserPasswordAction, setUserEnabledAction } from "../_actions/identity.ts";
import { searchTopvisorRegionsAction } from "../_actions/topvisor-regions.ts";
import { applyFieldErrors, AreaInput, feedbackFrom, FormField, SectionCard, SelectInput, SubmitRow, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";

const tenantRoleLabels = {
  ORG_OWNER: "Владелец организации",
  ORG_MEMBER: "Сотрудник организации",
  VIEWER: "Только просмотр",
} as const;
const tenantRoleOptions = tenantRoleSchema.options.map((value) => ({ value, label: tenantRoleLabels[value] }));
const emptySite: ProvisionClientInput["sites"][number] = { name: "", slug: "", url: "https://", timezone: "Europe/Moscow", regionName: "", regionCountryCode: "RU", yandexRegionKey: 0, googleRegionKey: 0, queries: [] };

function parseQueries(value: string) {
  return [...new Set(value.split(/[\r\n;,]+/).map((query) => query.trim()).filter(Boolean))].slice(0, 100);
}

function RegionPicker({ onSelect }: { onSelect: (region: TopvisorRegionOption) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<TopvisorRegionOption[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function findRegions() {
    if (search.trim().length < 2) return;
    setBusy(true);
    const result = await searchTopvisorRegionsAction({ search });
    setBusy(false);
    if (!result.ok) { setFeedback(result.message); setOptions([]); return; }
    setOptions(result.data);
    setFeedback(result.data.length ? null : "Не найден общий регион для Яндекса и Google");
  }

  return <div className="flex flex-col gap-2"><div className="flex gap-2"><TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Россия, область или город" /><Button type="button" variant="outline" onClick={findRegions} disabled={busy || search.trim().length < 2} aria-label="Найти регион продвижения"><Search data-icon="inline-start" aria-hidden />{busy ? "Ищем…" : "Найти"}</Button></div>{feedback ? <p className="text-sm text-app-warning" role="status">{feedback}</p> : null}{options.length ? <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border)] p-1">{options.map((option) => <Button className="h-auto justify-start whitespace-normal text-left" key={`${option.countryCode}:${option.yandexKey}:${option.googleKey}`} type="button" variant="ghost" onClick={() => { onSelect(option); setOptions([]); setSearch(option.name); }}>{option.name}{option.parentName ? ` · ${option.parentName}` : ""}</Button>)}</div> : null}</div>;
}

function SiteFields({ form, index, canRemove, onRemove }: { form: UseFormReturn<ProvisionClientInput>; index: number; canRemove: boolean; onRemove: () => void }) {
  const queries = form.watch(`sites.${index}.queries`) ?? [];
  const regionName = form.watch(`sites.${index}.regionName`);
  const errors = form.formState.errors.sites?.[index];

  function selectRegion(region: TopvisorRegionOption) {
    form.setValue(`sites.${index}.regionName`, region.name, { shouldValidate: true });
    form.setValue(`sites.${index}.regionCountryCode`, region.countryCode, { shouldValidate: true });
    form.setValue(`sites.${index}.yandexRegionKey`, region.yandexKey, { shouldValidate: true });
    form.setValue(`sites.${index}.googleRegionKey`, region.googleKey, { shouldValidate: true });
  }

  async function loadQueries(file: File | undefined) {
    if (!file) return;
    const queriesFromFile = parseQueries(await file.text());
    form.setValue(`sites.${index}.queries`, queriesFromFile, { shouldDirty: true, shouldValidate: true });
  }

  return <SectionCard title={`Сайт ${index + 1}`} description="Для каждого сайта задаются свои поисковые запросы и проверки позиций в Яндексе и Google на компьютерах и телефонах."><FieldGroup><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><FormField label="Название сайта" required error={errors?.name?.message}><TextInput {...form.register(`sites.${index}.name`)} /></FormField><FormField label="Адрес в кабинете" helper="Короткое имя для адреса страницы." required error={errors?.slug?.message}><TextInput {...form.register(`sites.${index}.slug`)} /></FormField><FormField label="Адрес сайта" required error={errors?.url?.message}><TextInput inputMode="url" {...form.register(`sites.${index}.url`)} /></FormField><FormField label="Часовой пояс" required error={errors?.timezone?.message}><TextInput placeholder="Europe/Moscow" {...form.register(`sites.${index}.timezone`)} /></FormField><div className="sm:col-span-2"><FormField label="Регион продвижения" required error={errors?.regionName?.message} helper={regionName ? `Выбран: ${regionName}` : "Поиск сверяет регион отдельно для Яндекса и Google."}><RegionPicker onSelect={selectRegion} /></FormField></div><div className="sm:col-span-2 xl:col-span-3"><FormField label="Поисковые запросы" required error={errors?.queries?.message} helper={`${queries.length}/100 запросов, минимум 20. По одному запросу в строке.`}><AreaInput rows={8} value={queries.join("\n")} onChange={(event) => form.setValue(`sites.${index}.queries`, parseQueries(event.target.value), { shouldDirty: true, shouldValidate: true })} /><label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium"><Upload className="size-4" aria-hidden />Загрузить файл с запросами<input className="sr-only" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => void loadQueries(event.target.files?.[0])} /></label></FormField></div></div>{canRemove ? <Button className="self-start" type="button" variant="outline" onClick={onRemove}><Trash2 data-icon="inline-start" aria-hidden />Удалить сайт</Button> : null}</FieldGroup></SectionCard>;
}

function UserAccessCard({ user }: { user: IdentityAdminUserListItem }) {
  const router = useRouter(); const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<ResetUserPasswordInput>({ resolver: zodResolver(resetUserPasswordInputSchema) as Resolver<ResetUserPasswordInput>, defaultValues: { userId: user.id, password: "" } });
  const resetPassword = form.handleSubmit(async (values) => { const result = await resetUserPasswordAction(values); if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; } form.reset({ userId: user.id, password: "" }); setFeedback({ kind: "success", message: "Пароль изменён, старые сессии отозваны" }); });
  async function toggleEnabled() { const result = await setUserEnabledAction({ userId: user.id, enabled: user.disabled }); setFeedback(result.ok ? { kind: "success", message: user.disabled ? "Пользователь включён" : "Пользователь отключён" } : feedbackFrom(result)); if (result.ok) router.refresh(); }
  return <SectionCard title={user.name} description={`${user.username} · ${user.disabled ? "отключён" : "активен"}`}><div className="flex flex-col gap-4"><p className="text-sm text-app-secondary">{user.memberships.length ? user.memberships.map((item) => `${item.organizationName}: ${tenantRoleLabels[item.tenantRole]}`).join(" · ") : "Нет доступа к организациям"}</p><form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={resetPassword}><input type="hidden" {...form.register("userId")} /><FormField error={form.formState.errors.password?.message} label="Новый пароль"><TextInput autoComplete="new-password" maxLength={8} minLength={8} type="password" {...form.register("password")} /></FormField><div className="self-end"><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Назначить пароль" pendingLabel="Сохраняем…" variant="outline" /></div></form><ConfirmActionDialog triggerLabel={user.disabled ? "Включить пользователя" : "Отключить пользователя"} title={user.disabled ? "Включить доступ" : "Отключить доступ"} description={user.disabled ? "Пользователь снова сможет войти в кабинет." : "Активные сеансы пользователя будут завершены."} confirmationName={user.username} onConfirm={toggleEnabled} /></div></SectionCard>;
}

export function ClientProvisioningAdmin({ users, thresholdProfiles, clusterProfiles }: { users: IdentityAdminUserListItem[]; thresholdProfiles: Array<{ id: string; label: string }>; clusterProfiles: Array<{ id: string; label: string }> }) {
  const router = useRouter(); const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<ProvisionClientInput>({ resolver: zodResolver(provisionClientInputSchema) as Resolver<ProvisionClientInput>, defaultValues: { organizationName: "", organizationSlug: "", projectName: "", projectSlug: "", thresholdProfileId: thresholdProfiles[0]?.id ?? "", clusterProfileId: clusterProfiles[0]?.id ?? "", userName: "", username: "", password: "", tenantRole: "VIEWER", sites: [{ ...emptySite }] } });
  const sites = useFieldArray({ control: form.control, name: "sites" });
  const submit = form.handleSubmit(async (values) => { const result = await provisionClientAction(values); if (!result.ok) { applyFieldErrors(result.fieldErrors, form.setError); setFeedback(feedbackFrom(result)); return; } form.reset({ ...form.getValues(), organizationName: "", organizationSlug: "", projectName: "", projectSlug: "", userName: "", username: "", password: "", sites: [{ ...emptySite }] }); setFeedback({ kind: "success", message: `${result.data.siteIds.length} сайт(ов) создано, подключения поставлены в очередь` }); router.refresh(); });
  return <div className="flex flex-col gap-6"><SectionCard title="Создать клиента" description="Организация, проект, сайты и пользователь будут созданы вместе, без повторного заполнения данных."><form className="flex flex-col gap-6" onSubmit={submit}><FieldGroup><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><FormField error={form.formState.errors.organizationName?.message} label="Организация" required><TextInput {...form.register("organizationName")} /></FormField><FormField error={form.formState.errors.organizationSlug?.message} label="Адрес организации" helper="Короткое имя для адреса страницы." required><TextInput {...form.register("organizationSlug")} /></FormField><FormField error={form.formState.errors.projectName?.message} label="Проект" required><TextInput {...form.register("projectName")} /></FormField><FormField error={form.formState.errors.projectSlug?.message} label="Адрес проекта" helper="Короткое имя для адреса страницы." required><TextInput {...form.register("projectSlug")} /></FormField><FormField error={form.formState.errors.thresholdProfileId?.message} label="Правила оценки" required><SelectInput options={thresholdProfiles.map((item) => ({ value: item.id, label: item.label }))} {...form.register("thresholdProfileId")} /></FormField><FormField error={form.formState.errors.clusterProfileId?.message} label="Группы запросов" required><SelectInput options={clusterProfiles.map((item) => ({ value: item.id, label: item.label }))} {...form.register("clusterProfileId")} /></FormField><FormField error={form.formState.errors.userName?.message} label="Имя пользователя" required><TextInput {...form.register("userName")} /></FormField><FormField error={form.formState.errors.username?.message} label="Логин" required><TextInput autoCapitalize="none" autoComplete="off" {...form.register("username")} /></FormField><FormField error={form.formState.errors.password?.message} helper="Ровно 8 печатных символов без пробелов." label="Пароль" required><TextInput autoComplete="new-password" maxLength={8} minLength={8} type="password" {...form.register("password")} /></FormField><FormField error={form.formState.errors.tenantRole?.message} label="Уровень доступа" required><SelectInput options={tenantRoleOptions} {...form.register("tenantRole")} /></FormField></div></FieldGroup>{sites.fields.map((site, index) => <SiteFields form={form} index={index} key={site.id} canRemove={sites.fields.length > 1} onRemove={() => sites.remove(index)} />)}<Button className="self-start" type="button" variant="outline" disabled={sites.fields.length >= 50} onClick={() => sites.append({ ...emptySite })}><Plus data-icon="inline-start" aria-hidden />Добавить сайт</Button><SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать клиента и настроить сайты" onRefresh={() => router.refresh()} pendingLabel="Создаём…" /></form></SectionCard><div className="grid gap-4 xl:grid-cols-2">{users.map((user) => <UserAccessCard key={user.id} user={user} />)}</div></div>;
}
