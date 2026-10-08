"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { Button } from "../../../components/ui/button.tsx";
import {
  freezeJobsInputSchema,
  requestOperationalActionInputSchema,
  type FleetProjectView,
  type FreezeJobsInput,
  type RequestOperationalActionInput,
} from "../../../modules/operations-control/contracts.ts";
import {
  freezeJobsAction,
  requestOperationalActionAction,
  unfreezeJobsAction,
} from "../_actions/operations-control.ts";
import {
  applyFieldErrors,
  AreaInput,
  feedbackFrom,
  FeedbackMessage,
  FormField,
  SectionCard,
  SelectInput,
  SubmitRow,
  TextInput,
  type Feedback,
} from "./platform-admin-form-primitives.tsx";

const actionOptions = [
  { value: "RUN_SOURCE", label: "Запросить запуск источника" },
  { value: "SUSPICIOUS_APPROVE", label: "Запросить подтверждение SUSPICIOUS" },
  { value: "SUSPICIOUS_REJECT", label: "Запросить отклонение SUSPICIOUS" },
  { value: "SNAPSHOT_BUILD", label: "Запросить Build Snapshot" },
  { value: "SNAPSHOT_PUBLISH", label: "Запросить Publish Snapshot" },
  { value: "SNAPSHOT_ROLLBACK", label: "Запросить rollback новым sequence" },
  { value: "ACK_ROTATE", label: "Запросить ротацию ACK-токена" },
] as const;

function newIdempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function OperationalRequestForm({ projects, initialIdempotencyKey }: { projects: FleetProjectView[]; initialIdempotencyKey: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const firstProject = projects[0];
  const form = useForm<RequestOperationalActionInput>({
    resolver: zodResolver(requestOperationalActionInputSchema) as Resolver<RequestOperationalActionInput>,
    shouldUnregister: true,
    defaultValues: {
      action: "RUN_SOURCE",
      organizationId: firstProject?.organizationId ?? "",
      projectId: firstProject?.projectId ?? "",
      sourceId: firstProject?.sources[0]?.sourceId ?? "",
      sourceRevisionId: "",
      buildInputId: "",
      reason: "",
      idempotencyKey: initialIdempotencyKey,
    },
  });
  const action = useWatch({ control: form.control, name: "action" });
  const projectId = useWatch({ control: form.control, name: "projectId" });
  const currentProject = projects.find((project) => project.projectId === projectId);
  const projectOptions = projects.map((project) => ({
    value: project.projectId,
    label: `${project.organizationName} · ${project.projectName}`,
  }));
  const sourceOptions = useMemo(() => [
    { value: "", label: "Выберите источник" },
    ...(currentProject?.sources.map((source) => ({ value: source.sourceId, label: source.name })) ?? []),
  ], [currentProject]);
  const needsSource = ["RUN_SOURCE", "SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"].includes(action);
  const needsSuspiciousEvidence = ["SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"].includes(action);
  const needsSequence = action === "SNAPSHOT_ROLLBACK";

  const submit = form.handleSubmit(async (values) => {
    const project = projects.find((item) => item.projectId === values.projectId);
    if (!project) return;
    const result = await requestOperationalActionAction({ ...values, organizationId: project.organizationId });
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({
      kind: "success",
      message: `${result.data.duplicate ? "Повторный запрос найден" : "Запрос принят"}: ${result.data.requestId}. Это не подтверждение выполнения; ${values.action === "RUN_SOURCE" ? "проверяйте состояние источника и jobs" : "состояние смотрите в истории операций проекта"}.`,
    });
    form.setValue("idempotencyKey", newIdempotencyKey("operation"));
    router.refresh();
  });

  return (
    <SectionCard title="Операционное действие" description="Запрос передаётся исполнителю общей очереди. Принятие запроса не означает завершения: результат показывается в истории операций. Выключенные server capabilities ждут включения; этот экран не выполняет production rollout.">
      {projects.length === 0 ? <p className="text-sm text-app-secondary">Сначала создайте проект.</p> : (
        <form className="grid gap-4" onSubmit={submit}>
          <input type="hidden" {...form.register("organizationId")} />
          <div className="grid gap-4 lg:grid-cols-2">
            <FormField error={form.formState.errors.action?.message} label="Действие" required>
              <SelectInput options={[...actionOptions]} {...form.register("action")} />
            </FormField>
            <FormField error={form.formState.errors.projectId?.message} label="Проект" required>
              <SelectInput options={projectOptions} {...form.register("projectId", {
                onChange: (event) => {
                  const next = projects.find((project) => project.projectId === event.target.value);
                  form.setValue("organizationId", next?.organizationId ?? "");
                  form.setValue("sourceId", next?.sources[0]?.sourceId ?? "");
                  form.setValue("buildInputId", "");
                  form.resetField("ackCredentialVersion");
                },
              })} />
            </FormField>
            {needsSource ? (
              <FormField error={form.formState.errors.sourceId?.message} label="Источник" required>
                <SelectInput options={sourceOptions} {...form.register("sourceId")} />
              </FormField>
            ) : null}
            {needsSuspiciousEvidence ? (
              <FormField error={form.formState.errors.sourceRevisionId?.message} label="Source revision" helper="Revision, для которой фиксируется ручное решение." required>
                <TextInput {...form.register("sourceRevisionId")} />
              </FormField>
            ) : null}
            {needsSequence ? (
              <FormField error={form.formState.errors.sourcePublishSequence?.message} label="Исходный publish sequence" helper="Старое содержимое будет опубликовано только отдельным executor как новый больший sequence." required>
                <TextInput min={1} type="number" {...form.register("sourcePublishSequence")} />
              </FormField>
            ) : null}
            {action === "SNAPSHOT_PUBLISH" ? (
              <FormField error={form.formState.errors.buildInputId?.message} label="ID завершённой сборки" helper="Точный buildInputId из результата BUILD; последняя сборка автоматически не выбирается." required>
                <TextInput {...form.register("buildInputId")} />
              </FormField>
            ) : null}
            {action === "ACK_ROTATE" ? (
              <>
                <FormField error={form.formState.errors.ackRotationPhase?.message} label="Фаза ACK rotation" helper="STAGE сохраняет оба токена; PROMOTE отдельным запросом завершает overlap и отключает старый." required>
                  <SelectInput options={[{ value: "", label: "Выберите фазу" }, { value: "STAGE", label: "STAGE — current + next" }, { value: "PROMOTE", label: "PROMOTE — только next" }]} {...form.register("ackRotationPhase")} />
                </FormField>
                <FormField error={form.formState.errors.ackCredentialVersion?.message} label="Ожидаемая версия ACK credential" helper={`Наблюдаемая версия: ${currentProject?.ackCredentialVersion ?? "credential не настроена"}. Токен задаётся сервером через SecretRef и не вводится в форму.`} required>
                  <TextInput min={1} max={2_147_483_646} type="number" {...form.register("ackCredentialVersion", { valueAsNumber: true })} />
                </FormField>
              </>
            ) : null}
            <FormField error={form.formState.errors.idempotencyKey?.message} label="Ключ запроса" helper="Защищает от повторной отправки." required>
              <TextInput {...form.register("idempotencyKey")} />
            </FormField>
          </div>
          {needsSuspiciousEvidence ? (
            <FormField error={form.formState.errors.reason?.message} label="Обоснование" helper="Не вводите секреты или персональные данные." required>
              <AreaInput rows={3} {...form.register("reason")} />
            </FormField>
          ) : null}
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Записать запрос" onRefresh={() => router.refresh()} pendingLabel="Записываем..." />
        </form>
      )}
    </SectionCard>
  );
}

function DataSafetyForms({ jobsFrozen }: { jobsFrozen: boolean }) {
  const router = useRouter();
  const [unfreezeBusy, setUnfreezeBusy] = useState(false);
  const [unfreezeFeedback, setUnfreezeFeedback] = useState<Feedback>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const form = useForm<FreezeJobsInput>({
    resolver: zodResolver(freezeJobsInputSchema) as Resolver<FreezeJobsInput>,
    defaultValues: { reason: "" },
  });
  const freeze = form.handleSubmit(async (values) => {
    const result = await freezeJobsAction(values);
    if (!result.ok) {
      applyFieldErrors(result.fieldErrors, form.setError);
      setFeedback(feedbackFrom(result));
      return;
    }
    setFeedback({ kind: "success", message: "Mutating jobs остановлены; событие записано в аудит" });
    router.refresh();
  });
  const unfreeze = async () => {
    setUnfreezeBusy(true);
    const result = await unfreezeJobsAction({});
    setUnfreezeBusy(false);
    if (!result.ok) {
      setUnfreezeFeedback(feedbackFrom(result));
      return;
    }
    setUnfreezeFeedback({ kind: "success", message: "Mutating jobs разрешены после проверенного reconcile" });
    router.refresh();
  };

  return (
    <SectionCard title="Safety state jobs" description={`Текущее состояние: ${jobsFrozen ? "FROZEN" : "ACTIVE"}. Unfreeze не обходит обязательный reconcile после последней остановки.`}>
      <div className="grid gap-5 lg:grid-cols-2">
        <form className="grid gap-4" onSubmit={freeze}>
          <FormField error={form.formState.errors.reason?.message} label="Причина остановки" helper="Не вводите секреты или персональные данные." required>
            <AreaInput rows={3} {...form.register("reason")} />
          </FormField>
          <SubmitRow busy={form.formState.isSubmitting} feedback={feedback} label="Freeze jobs" pendingLabel="Останавливаем..." variant="outline" />
        </form>
        <div className="flex flex-col justify-between gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-4">
          <p className="text-sm leading-6 text-app-secondary">Разморозка разрешена только когда `reconciledAt` не старше последнего freeze. Проверка выполняется на сервере в одной транзакции.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={unfreezeBusy} type="button" variant="outline" onClick={unfreeze}>
              {unfreezeBusy ? "Проверяем..." : "Unfreeze jobs"}
            </Button>
            <FeedbackMessage feedback={unfreezeFeedback} onRefresh={() => router.refresh()} />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export function OperationsControlForms({ projects, jobsFrozen, initialIdempotencyKey }: { projects: FleetProjectView[]; jobsFrozen: boolean; initialIdempotencyKey: string }) {
  return (
    <section className="grid gap-4" aria-label="Операционные действия">
      <OperationalRequestForm initialIdempotencyKey={initialIdempotencyKey} projects={projects} />
      <DataSafetyForms jobsFrozen={jobsFrozen} />
    </section>
  );
}
