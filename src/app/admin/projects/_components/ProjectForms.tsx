"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  useForm,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormSetError,
} from "react-hook-form";
import { Button } from "../../../../components/ui/button.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../../../components/ui/accordion.tsx";
import { Input } from "../../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../../components/ui/native-select.tsx";
import {
  changeProjectStatusInputSchema,
  createProjectInputSchema,
  PROJECT_STATUSES,
  updateProjectSettingsInputSchema,
  type ChangeProjectStatusInput,
  type CreateProjectInput,
  type ProjectFormOptions,
  type ProjectListItem,
  type ProjectStatus,
  type UpdateProjectSettingsInput,
} from "../../../../modules/project-registry/contracts.ts";
import {
  changeProjectStatusAction,
  createProjectAction,
  updateProjectSettingsAction,
} from "../actions.ts";

const statusLabels: Record<ProjectStatus, string> = {
  ACTIVE: "Активен",
  PLANNED: "Запланирован",
  DISABLED: "Отключён",
};

type Feedback = { kind: "success" | "error" | "stale"; message: string } | null;

function applyFieldErrors<TValues extends FieldValues>(
  fieldErrors: Record<string, string[]>,
  setError: UseFormSetError<TValues>,
) {
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const message = messages[0];
    if (message) setError(field as Path<TValues>, { message });
  }
}

function FeedbackMessage({ feedback, onRefresh }: { feedback: Feedback; onRefresh?: () => void }) {
  if (!feedback) return null;
  return (
    <div
      className={feedback.kind === "success" ? "text-sm font-medium text-app-success" : "text-sm font-medium text-app-destructive"}
      role={feedback.kind === "success" ? "status" : "alert"}
    >
      <span>{feedback.message}</span>
      {feedback.kind === "stale" && onRefresh ? (
        <Button className="ml-2" variant="link" type="button" onClick={onRefresh}>
          Обновить данные
        </Button>
      ) : null}
    </div>
  );
}

export function ProjectCreateForm({ options }: { options: ProjectFormOptions }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const defaults: CreateProjectInput = {
    organizationId: options.organizations[0]?.id ?? "",
    slug: "",
    name: "",
    status: "PLANNED",
    thresholdProfileId: options.thresholdProfiles[0]?.id ?? "",
    clusterProfileId: options.clusterProfiles[0]?.id ?? "",
  };
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectInputSchema) as Resolver<CreateProjectInput>,
    defaultValues: defaults,
  });

  const submit = handleSubmit(async (values) => {
    setFeedback(null);
    const result = await createProjectAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, setError);
      setFeedback({ kind: "error", message: result.message });
      return;
    }
    reset(defaults);
    setFeedback({ kind: "success", message: "Проект создан" });
    router.refresh();
  });

  return (
    <Accordion className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
      <AccordionItem value="create-project">
      <AccordionTrigger className="px-5">
        Создать проект
      </AccordionTrigger>
      <AccordionContent className="p-0">
      <form className="grid gap-4 border-t border-[var(--border)] p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Организация</span>
          <NativeSelect {...register("organizationId")}>
            {options.organizations.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.name}</NativeSelectOption>)}
          </NativeSelect>
          {errors.organizationId ? <span className="text-xs text-app-destructive">{errors.organizationId.message}</span> : null}
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Название</span>
          <Input {...register("name")} />
          {errors.name ? <span className="text-xs text-app-destructive">{errors.name.message}</span> : null}
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Адрес в кабинете</span>
          <Input placeholder="project-name" {...register("slug")} />
          {errors.slug ? <span className="text-xs text-app-destructive">{errors.slug.message}</span> : null}
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Статус</span>
          <NativeSelect {...register("status")}>
            {PROJECT_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{statusLabels[status]}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Правила оценки</span>
          <NativeSelect {...register("thresholdProfileId")}>
            {options.thresholdProfiles.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-app-foreground">Группы запросов</span>
          <NativeSelect {...register("clusterProfileId")}>
            {options.clusterProfiles.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button disabled={isSubmitting} type="submit">{isSubmitting ? "Создаём…" : "Создать"}</Button>
          <FeedbackMessage feedback={feedback} />
        </div>
      </form>
      </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function ProjectRowActions({ project, options }: { project: ProjectListItem; options: ProjectFormOptions }) {
  const router = useRouter();
  const [statusFeedback, setStatusFeedback] = useState<Feedback>(null);
  const [settingsFeedback, setSettingsFeedback] = useState<Feedback>(null);
  const statusForm = useForm<ChangeProjectStatusInput>({
    resolver: zodResolver(changeProjectStatusInputSchema) as Resolver<ChangeProjectStatusInput>,
    defaultValues: {
      organizationId: project.organizationId,
      projectId: project.id,
      version: project.version,
      status: project.status,
    },
  });
  const settingsForm = useForm<UpdateProjectSettingsInput>({
    resolver: zodResolver(updateProjectSettingsInputSchema) as Resolver<UpdateProjectSettingsInput>,
    defaultValues: {
      organizationId: project.organizationId,
      projectId: project.id,
      version: project.version,
      name: project.name,
      thresholdProfileId: project.thresholdProfileId,
      clusterProfileId: project.clusterProfileId,
    },
  });

  const submitStatus = statusForm.handleSubmit(async (values) => {
    setStatusFeedback(null);
    const result = await changeProjectStatusAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, statusForm.setError);
      setStatusFeedback({ kind: result.code === "PROJECT_STALE" ? "stale" : "error", message: result.message });
      return;
    }
    setStatusFeedback({ kind: "success", message: "Статус сохранён" });
    router.refresh();
  });

  const submitSettings = settingsForm.handleSubmit(async (values) => {
    setSettingsFeedback(null);
    const result = await updateProjectSettingsAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, settingsForm.setError);
      setSettingsFeedback({ kind: result.code === "PROJECT_STALE" ? "stale" : "error", message: result.message });
      return;
    }
    setSettingsFeedback({ kind: "success", message: "Данные сохранены" });
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={submitStatus}>
        <label className="min-w-40 space-y-1">
          <span className="block text-xs font-medium text-app-secondary">Статус</span>
          <NativeSelect {...statusForm.register("status")}>
            {PROJECT_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{statusLabels[status]}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <Button className="min-h-11" disabled={statusForm.formState.isSubmitting} type="submit" variant="outline">
          {statusForm.formState.isSubmitting ? "Сохраняем…" : "Сохранить"}
        </Button>
        <FeedbackMessage feedback={statusFeedback} onRefresh={() => router.refresh()} />
      </form>
      <Accordion className="rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--muted)]/60">
        <AccordionItem value={project.id}>
        <AccordionTrigger className="px-3 font-medium text-app-secondary">
          Настройки
        </AccordionTrigger>
        <AccordionContent className="p-0">
        <form className="grid gap-3 border-t border-[var(--border)] p-3" onSubmit={submitSettings}>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-app-secondary">Название</span>
            <Input {...settingsForm.register("name")} />
            {settingsForm.formState.errors.name ? <span className="text-xs text-app-destructive">{settingsForm.formState.errors.name.message}</span> : null}
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-app-secondary">Правила оценки</span>
            <NativeSelect {...settingsForm.register("thresholdProfileId")}>
              {options.thresholdProfiles.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-app-secondary">Группы запросов</span>
            <NativeSelect {...settingsForm.register("clusterProfileId")}>
              {options.clusterProfiles.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={settingsForm.formState.isSubmitting} type="submit">
              {settingsForm.formState.isSubmitting ? "Сохраняем…" : "Сохранить настройки"}
            </Button>
            <FeedbackMessage feedback={settingsFeedback} onRefresh={() => router.refresh()} />
          </div>
        </form>
        </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
