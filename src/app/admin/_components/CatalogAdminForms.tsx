"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  CatalogAdminBuilding,
  CatalogAdminData,
  CatalogAdminDeveloper,
  CatalogAdminDevelopment,
  CreateBuildingsBatchInput,
  CreateBuildingInput,
  CreateDeveloperInput,
  CreateDevelopmentInput,
} from "../../../modules/shared-catalog/contracts.ts";
import {
  createCatalogBuildingAction,
  createCatalogBuildingsBatchAction,
  createCatalogDeveloperAction,
  createCatalogDevelopmentAction,
  updateCatalogBuildingAction,
  updateCatalogDeveloperAction,
  updateCatalogDevelopmentAction,
} from "../_actions/catalog.ts";
import { FeedbackMessage, FormField, SectionCard, SelectInput, TextInput, type Feedback } from "./platform-admin-form-primitives.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Textarea } from "../../../components/ui/input.tsx";

const lifecycleOptions = [
  { value: "ACTIVE", label: "Активен" },
  { value: "INACTIVE", label: "Неактивен" },
  { value: "ARCHIVED", label: "Архив" },
];
const constructionOptions = [
  { value: "PLANNED", label: "Запланирован" },
  { value: "UNDER_CONSTRUCTION", label: "Строится" },
  { value: "COMPLETED", label: "Сдан" },
  { value: "SUSPENDED", label: "Приостановлен" },
];

function aliases(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
function optionalNumber(value: FormDataEntryValue | null): number | null {
  return value === null || String(value).trim() === "" ? null : Number(value);
}
function optionalText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function useCatalogSubmit() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const run = async (execute: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    setFeedback(null);
    const result = await execute();
    if (!result.ok) setFeedback({ kind: "error", message: result.message ?? "Не удалось сохранить изменения" });
    else { setFeedback({ kind: "success", message: success }); router.refresh(); }
    return result.ok;
  };
  return { feedback, run, router };
}

function DeveloperForm({ item }: { item?: CatalogAdminDeveloper }) {
  const { feedback, run } = useCatalogSubmit();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input: CreateDeveloperInput = { name: String(data.get("name")), lifecycle: String(data.get("lifecycle")) as CreateDeveloperInput["lifecycle"], aliases: aliases(data.get("aliases")) };
    const ok = await run(
      () => item ? updateCatalogDeveloperAction({ ...input, uid: item.uid, version: item.version }) : createCatalogDeveloperAction(input),
      item ? "Застройщик обновлён" : "Застройщик создан",
    );
    if (ok && !item) event.currentTarget.reset();
  };
  return <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
    <FormField label="Название" required><TextInput defaultValue={item?.name} name="name" required /></FormField>
    <FormField label="Статус" required><SelectInput defaultValue={item?.lifecycle ?? "ACTIVE"} name="lifecycle" options={lifecycleOptions} /></FormField>
    <div className="md:col-span-2"><FormField label="Алиасы" helper="Через запятую: варианты написания для поиска и сопоставления."><TextInput defaultValue={item?.aliases.join(", ")} name="aliases" /></FormField></div>
    <div className="flex flex-wrap items-center gap-3 md:col-span-2"><Button type="submit">{item ? "Сохранить" : "Создать застройщика"}</Button><FeedbackMessage feedback={feedback} /></div>
  </form>;
}

function DevelopmentForm({ item, options }: { item?: CatalogAdminDevelopment; options: CatalogAdminData["options"] }) {
  const { feedback, run } = useCatalogSubmit();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input: CreateDevelopmentInput = { developerUid: String(data.get("developerUid")), cityUid: String(data.get("cityUid")), districtUid: optionalText(data.get("districtUid")), name: String(data.get("name")), lifecycle: String(data.get("lifecycle")) as CreateDevelopmentInput["lifecycle"], aliases: aliases(data.get("aliases")) };
    const ok = await run(
      () => item ? updateCatalogDevelopmentAction({ ...input, uid: item.uid, version: item.version }) : createCatalogDevelopmentAction(input),
      item ? "Жилой комплекс обновлён" : "Жилой комплекс создан",
    );
    if (ok && !item) event.currentTarget.reset();
  };
  const cityNames = new Map(options.cities.map((city) => [city.uid, city.name]));
  return <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
    <FormField label="Название ЖК" required><TextInput defaultValue={item?.name} name="name" required /></FormField>
    <FormField label="Застройщик" required><SelectInput defaultValue={item?.developerUid} name="developerUid" options={options.developers.map((row) => ({ value: row.uid, label: row.name }))} required /></FormField>
    <FormField label="Город" required><SelectInput defaultValue={item?.cityUid} name="cityUid" options={options.cities.map((row) => ({ value: row.uid, label: row.name }))} required /></FormField>
    <FormField label="Район"><SelectInput defaultValue={item?.districtUid ?? ""} name="districtUid" options={[{ value: "", label: "Не выбран" }, ...options.districts.map((row) => ({ value: row.uid, label: `${cityNames.get(row.cityUid) ?? "Город"} · ${row.name}` }))]} /></FormField>
    <FormField label="Статус" required><SelectInput defaultValue={item?.lifecycle ?? "ACTIVE"} name="lifecycle" options={lifecycleOptions} /></FormField>
    <FormField label="Алиасы" helper="Через запятую"><TextInput defaultValue={item?.aliases.join(", ")} name="aliases" /></FormField>
    <div className="flex flex-wrap items-center gap-3 md:col-span-2"><Button type="submit">{item ? "Сохранить" : "Создать ЖК"}</Button><FeedbackMessage feedback={feedback} /></div>
  </form>;
}

function BuildingForm({ item, options }: { item?: CatalogAdminBuilding; options: CatalogAdminData["options"] }) {
  const { feedback, run } = useCatalogSubmit();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input: CreateBuildingInput = { developmentUid: String(data.get("developmentUid")), label: String(data.get("label")), floors: optionalNumber(data.get("floors")), commissioningYear: optionalNumber(data.get("commissioningYear")), commissioningQuarter: optionalNumber(data.get("commissioningQuarter")), constructionStatus: String(data.get("constructionStatus")) as CreateBuildingInput["constructionStatus"], material: optionalText(data.get("material")), housingClass: optionalText(data.get("housingClass")), lifecycle: String(data.get("lifecycle")) as CreateBuildingInput["lifecycle"], aliases: aliases(data.get("aliases")) };
    const ok = await run(
      () => item ? updateCatalogBuildingAction({ ...input, uid: item.uid, version: item.version }) : createCatalogBuildingAction(input),
      item ? "Корпус обновлён" : "Корпус создан",
    );
    if (ok && !item) event.currentTarget.reset();
  };
  return <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
    <FormField label="Жилой комплекс" required><SelectInput defaultValue={item?.developmentUid} name="developmentUid" options={options.developments.map((row) => ({ value: row.uid, label: row.name }))} required /></FormField>
    <FormField label="Корпус или литер" required><TextInput defaultValue={item?.label} name="label" required /></FormField>
    <FormField label="Статус строительства" required><SelectInput defaultValue={item?.constructionStatus ?? "PLANNED"} name="constructionStatus" options={constructionOptions} /></FormField>
    <FormField label="Этажность"><TextInput defaultValue={item?.floors ?? ""} min="1" name="floors" type="number" /></FormField>
    <FormField label="Год сдачи"><TextInput defaultValue={item?.commissioningYear ?? ""} min="2000" name="commissioningYear" type="number" /></FormField>
    <FormField label="Квартал сдачи"><TextInput defaultValue={item?.commissioningQuarter ?? ""} max="4" min="1" name="commissioningQuarter" type="number" /></FormField>
    <FormField label="Материал"><TextInput defaultValue={item?.material ?? ""} name="material" /></FormField>
    <FormField label="Класс жилья"><TextInput defaultValue={item?.housingClass ?? ""} name="housingClass" /></FormField>
    <FormField label="Статус записи"><SelectInput defaultValue={item?.lifecycle ?? "ACTIVE"} name="lifecycle" options={lifecycleOptions} /></FormField>
    <div className="xl:col-span-3"><FormField label="Алиасы" helper="Через запятую"><TextInput defaultValue={item?.aliases.join(", ")} name="aliases" /></FormField></div>
    <div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-3"><Button type="submit">{item ? "Сохранить" : "Создать корпус"}</Button><FeedbackMessage feedback={feedback} /></div>
  </form>;
}

function BuildingBatchForm({ options }: { options: CatalogAdminData["options"] }) {
  const { feedback, run } = useCatalogSubmit();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input: CreateBuildingsBatchInput = {
      developmentUid: String(data.get("developmentUid")),
      labels: String(data.get("labels") ?? "").split(/[\n,]+/).map((value) => value.trim()).filter(Boolean),
      constructionStatus: String(data.get("constructionStatus")) as CreateBuildingsBatchInput["constructionStatus"],
      lifecycle: "ACTIVE",
    };
    const ok = await run(() => createCatalogBuildingsBatchAction(input), `Добавлено корпусов: ${input.labels.length}`);
    if (ok) event.currentTarget.reset();
  };
  return <SectionCard title="Быстро добавить корпуса" description="До 50 корпусов одной транзакцией. Каждая строка или значение через запятую станет отдельным корпусом."><form className="grid gap-4 md:grid-cols-2" onSubmit={submit}><FormField label="Жилой комплекс" required><SelectInput name="developmentUid" options={options.developments.map((row) => ({ value: row.uid, label: row.name }))} required /></FormField><FormField label="Статус строительства"><SelectInput defaultValue="PLANNED" name="constructionStatus" options={constructionOptions} /></FormField><div className="md:col-span-2"><FormField label="Корпуса или литеры" required><Textarea name="labels" placeholder={'Корпус 1\nКорпус 2\nЛитер А'} required rows={4} /></FormField></div><div className="flex flex-wrap items-center gap-3 md:col-span-2"><Button type="submit">Добавить корпуса</Button><FeedbackMessage feedback={feedback} /></div></form></SectionCard>;
}

function EditGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]"><summary className="min-h-11 cursor-pointer px-5 py-3 text-sm font-semibold text-app-foreground">{title}</summary><div className="border-t border-[var(--border)] p-5">{children}</div></details>;
}

export function CatalogAdminForms({ data }: { data: CatalogAdminData }) {
  return <div className="space-y-8">
    <section aria-labelledby="catalog-create-title" className="space-y-4"><h2 className="text-xl font-semibold text-app-foreground" id="catalog-create-title">Добавить запись</h2><div className="grid gap-4 xl:grid-cols-3"><SectionCard title="Застройщик" description="Создайте каноническую запись и варианты написания."><DeveloperForm /></SectionCard><SectionCard title="Жилой комплекс" description="Свяжите ЖК с застройщиком и географией."><DevelopmentForm options={data.options} /></SectionCard><SectionCard title="Корпус" description="Добавьте корпус или литер внутри жилого комплекса."><BuildingForm options={data.options} /></SectionCard></div><BuildingBatchForm options={data.options} /></section>
    <section aria-labelledby="catalog-edit-title" className="space-y-4"><h2 className="text-xl font-semibold text-app-foreground" id="catalog-edit-title">Редактирование</h2><div className="grid gap-3 xl:grid-cols-2">
      {data.developers.map((item) => <EditGroup key={item.uid} title={`Застройщик · ${item.name}`}><DeveloperForm item={item} /></EditGroup>)}
      {data.developments.map((item) => <EditGroup key={item.uid} title={`ЖК · ${item.name}`}><DevelopmentForm item={item} options={data.options} /></EditGroup>)}
      {data.buildings.map((item) => <EditGroup key={item.uid} title={`${item.developmentName} · ${item.label}`}><BuildingForm item={item} options={data.options} /></EditGroup>)}
    </div></section>
  </div>;
}
