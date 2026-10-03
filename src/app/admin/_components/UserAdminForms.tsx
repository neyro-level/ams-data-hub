"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import {
  createUserInputSchema,
  resetUserPasswordInputSchema,
  setUserEnabledInputSchema,
  systemRoleSchema,
  tenantRoleSchema,
  type CreateUserInput,
  type IdentityAdminFormOptions,
  type IdentityAdminUserListItem,
  type ResetUserPasswordInput,
  type SetUserEnabledInput,
} from "../../../modules/identity-access/contracts.ts";
import { createUserAction, resetUserPasswordAction, setUserEnabledAction } from "../_actions/identity.ts";
import { applyFieldErrors, feedbackFrom, FormField, SectionCard, SelectInput, SubmitRow, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";

const systemRoleLabels = {
  PLATFORM_ADMIN: "Супер админ",
  USER: "Пользователь",
} as const;
const tenantRoleLabels = {
  ORG_ADMIN: "Владелец организации",
  ORG_EDITOR: "Сотрудник организации",
  ORG_VIEWER: "Только просмотр",
} as const;

const systemRoleOptions = systemRoleSchema.options.map((value) => ({ value, label: systemRoleLabels[value] }));
const tenantRoleOptions = tenantRoleSchema.options.map((value) => ({ value, label: tenantRoleLabels[value] }));

function UserCard({ item }: { item: IdentityAdminUserListItem }) {
  const router = useRouter();
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [enabledFeedback, setEnabledFeedback] = useState<Feedback>(null);
  const passwordForm = useForm<ResetUserPasswordInput>({
    resolver: zodResolver(resetUserPasswordInputSchema) as Resolver<ResetUserPasswordInput>,
    defaultValues: { userId: item.id, password: "" },
  });
  const enabledForm = useForm<SetUserEnabledInput>({
    resolver: zodResolver(setUserEnabledInputSchema) as Resolver<SetUserEnabledInput>,
    defaultValues: { userId: item.id, enabled: item.disabled },
  });

  const submitPassword = passwordForm.handleSubmit(async (values) => {
    const result = await resetUserPasswordAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, passwordForm.setError);
      setPasswordFeedback(feedbackFrom(result));
      return;
    }
    passwordForm.reset({ userId: item.id, password: "" });
    setPasswordFeedback({ kind: "success", message: "Пароль обновлён, активные сессии завершены" });
    router.refresh();
  });
  const submitEnabled = enabledForm.handleSubmit(async () => {
    const result = await setUserEnabledAction({ userId: item.id, enabled: item.disabled });
    if (!result.ok) {
      setEnabledFeedback(feedbackFrom(result));
      return;
    }
    setEnabledFeedback({ kind: "success", message: item.disabled ? "Пользователь включён" : "Пользователь отключён" });
    router.refresh();
  });

  return (
    <SectionCard title={item.name} description={`${item.username} · ${item.email} · ${systemRoleLabels[item.systemRole]}`}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-app-secondary">
          {item.memberships.length
            ? item.memberships.map((membership) => `${membership.organizationName}: ${tenantRoleLabels[membership.tenantRole]}`).join("; ")
            : "Доступ к организациям не назначен."}
        </p>
        <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitPassword}>
          <input type="hidden" {...passwordForm.register("userId")} />
          <FormField error={passwordForm.formState.errors.password?.message} label="Новый пароль" required>
            <TextInput autoComplete="new-password" type="password" {...passwordForm.register("password")} />
          </FormField>
          <div className="self-end">
            <SubmitRow busy={passwordForm.formState.isSubmitting} feedback={passwordFeedback} label="Сменить пароль" onRefresh={() => router.refresh()} pendingLabel="Сохраняем..." variant="outline" />
          </div>
        </form>
        <form className="border-t border-[var(--border)] pt-4" onSubmit={submitEnabled}>
          <input type="hidden" {...enabledForm.register("userId")} />
          <input type="hidden" value={String(item.disabled)} {...enabledForm.register("enabled")} />
          <SubmitRow busy={enabledForm.formState.isSubmitting} feedback={enabledFeedback} label={item.disabled ? "Включить пользователя" : "Отключить пользователя"} onRefresh={() => router.refresh()} pendingLabel="Обновляем..." variant="ghost" />
        </form>
      </div>
    </SectionCard>
  );
}

export function UsersAdminForms({ users, options }: { users: IdentityAdminUserListItem[]; options: IdentityAdminFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const organizationOptions = [{ value: "", label: "Без организации" }, ...options.organizations.map((option) => ({ value: option.id, label: option.name }))];
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserInputSchema) as Resolver<CreateUserInput>,
    defaultValues: {
      name: "",
      username: "",
      email: "",
      systemRole: "USER",
      organizationId: "",
      tenantRole: "ORG_VIEWER",
    },
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await createUserAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    form.reset({ name: "", username: "", email: "", systemRole: "USER", organizationId: "", tenantRole: "ORG_VIEWER" });
    setFeedback({ kind: "success", message: `Пользователь создан. Передайте setup-материал один раз через защищённый канал: ${result.data.setupToken}` });
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <SectionCard title="Создать пользователя" description="Добавьте оператора, сотрудника платформы или участника организации.">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
          <FormField error={form.formState.errors.name?.message} label="Имя" required>
            <TextInput {...form.register("name")} />
          </FormField>
          <FormField error={form.formState.errors.username?.message} label="Логин" required>
            <TextInput placeholder="manager_1" {...form.register("username")} />
          </FormField>
          <FormField error={form.formState.errors.email?.message} label="Email">
            <TextInput type="email" {...form.register("email")} />
          </FormField>
          <FormField error={form.formState.errors.systemRole?.message} label="Системная роль" required>
            <SelectInput options={systemRoleOptions} {...form.register("systemRole")} />
          </FormField>
          <FormField error={form.formState.errors.organizationId?.message} label="Организация">
            <SelectInput options={organizationOptions} {...form.register("organizationId")} />
          </FormField>
          <FormField error={form.formState.errors.tenantRole?.message} label="Доступ в организации" required>
            <SelectInput options={tenantRoleOptions} {...form.register("tenantRole")} />
          </FormField>
          <div className="md:col-span-2 xl:col-span-3">
            <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Создать пользователя" onRefresh={() => router.refresh()} pendingLabel="Создаём..." />
          </div>
        </form>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">
        {users.map((item) => <UserCard item={item} key={item.id} />)}
      </div>
    </div>
  );
}
