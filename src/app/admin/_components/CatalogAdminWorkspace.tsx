import Link from "next/link";
import { Button } from "../../../components/ui/button.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import type { CatalogAdminData, CatalogAdminQuery } from "../../../modules/shared-catalog/contracts.ts";
import { CatalogAdminForms } from "./CatalogAdminForms.tsx";
import { CatalogEntityTable, type CatalogDisplayRow } from "./CatalogEntityTable.tsx";

const constructionLabels: Record<string, string> = { PLANNED: "запланирован", UNDER_CONSTRUCTION: "строится", COMPLETED: "сдан", SUSPENDED: "приостановлен" };
const entityLabels: Record<string, string> = { DEVELOPER: "Застройщик", DEVELOPMENT: "ЖК", BUILDING: "Корпус" };
const changeLabels: Record<string, string> = { CREATE: "создан", UPDATE: "обновлён", RELINK: "перепривязан", MERGE: "объединён", MERGE_REASSIGN: "перенесён при объединении" };
const historyDate = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function CatalogAdminWorkspace({ data, query }: { data: CatalogAdminData; query: CatalogAdminQuery }) {
  const filtersActive = Boolean(query.q || query.regionUid || query.cityUid || query.developerUid || query.lifecycle !== "ALL");
  const developerRows: CatalogDisplayRow[] = data.developers.map((item) => ({ id: item.uid, primary: item.name, secondary: `${item.developmentCount} ЖК${item.aliases.length ? ` · алиасы: ${item.aliases.join(", ")}` : ""}`, status: item.lifecycle, updatedAt: item.updatedAt }));
  const developmentRows: CatalogDisplayRow[] = data.developments.map((item) => ({ id: item.uid, primary: item.name, secondary: `${item.developerName} · ${item.cityName}${item.districtName ? `, ${item.districtName}` : ""} · ${item.buildingCount} корпусов`, status: item.lifecycle, updatedAt: item.updatedAt }));
  const buildingRows: CatalogDisplayRow[] = data.buildings.map((item) => ({ id: item.uid, primary: item.label, secondary: `${item.developmentName} · ${constructionLabels[item.constructionStatus] ?? item.constructionStatus}${item.floors ? ` · ${item.floors} эт.` : ""}`, status: item.lifecycle, updatedAt: item.updatedAt }));
  return <div className="space-y-8">
    <form className="grid gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-2 xl:grid-cols-3" method="get">
      <label className="space-y-1.5"><span className="block text-sm font-medium text-app-foreground">Поиск</span><Input defaultValue={query.q} name="q" placeholder="Название или алиас" /></label>
      <label className="space-y-1.5"><span className="block text-sm font-medium text-app-foreground">Статус</span><NativeSelect defaultValue={query.lifecycle} name="lifecycle"><NativeSelectOption value="ALL">Все статусы</NativeSelectOption><NativeSelectOption value="ACTIVE">Активные</NativeSelectOption><NativeSelectOption value="INACTIVE">Неактивные</NativeSelectOption><NativeSelectOption value="ARCHIVED">Архив</NativeSelectOption></NativeSelect></label>
      <label className="space-y-1.5"><span className="block text-sm font-medium text-app-foreground">Регион</span><NativeSelect defaultValue={query.regionUid} name="regionUid"><NativeSelectOption value="">Все регионы</NativeSelectOption>{data.options.regions.map((item) => <NativeSelectOption key={item.uid} value={item.uid}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
      <label className="space-y-1.5"><span className="block text-sm font-medium text-app-foreground">Город</span><NativeSelect defaultValue={query.cityUid} name="cityUid"><NativeSelectOption value="">Все города</NativeSelectOption>{data.options.cities.map((item) => <NativeSelectOption key={item.uid} value={item.uid}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
      <label className="space-y-1.5"><span className="block text-sm font-medium text-app-foreground">Застройщик</span><NativeSelect defaultValue={query.developerUid} name="developerUid"><NativeSelectOption value="">Все застройщики</NativeSelectOption>{data.options.developers.map((item) => <NativeSelectOption key={item.uid} value={item.uid}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
      <div className="flex items-end gap-2"><Button type="submit">Применить</Button>{filtersActive ? <Link className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-app-muted-foreground hover:text-app-foreground" href="/admin/catalog/">Сбросить</Link> : null}</div>
    </form>
    <div className="grid gap-8"><CatalogEntityTable filtersActive={filtersActive} rows={developerRows} title="Застройщики" /><CatalogEntityTable filtersActive={filtersActive} rows={developmentRows} title="Жилые комплексы" /><CatalogEntityTable filtersActive={filtersActive} rows={buildingRows} title="Корпуса и литеры" /></div>
    <section aria-labelledby="catalog-history-title" className="space-y-4">
      <div><h2 className="text-xl font-semibold text-app-foreground" id="catalog-history-title">История изменений</h2><p className="mt-1 text-sm text-app-muted-foreground">Неизменяемые версии и источник ручных правок для записей в текущей выборке.</p></div>
      {data.history.length ? <ol className="grid gap-3 lg:grid-cols-2">
        {data.history.map((item) => <li className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4" key={item.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-app-foreground">{entityLabels[item.entityType]} · версия {item.version}</h3><time className="text-xs text-app-muted-foreground" dateTime={item.createdAt}>{historyDate.format(new Date(item.createdAt))}</time></div>
          <p className="mt-2 text-sm text-app-muted-foreground">{changeLabels[item.changeKind]} · Ручной ввод · оператор {item.actorId}</p>
          <p className="mt-2 break-all text-xs text-app-muted-foreground">UID: {item.entityUid}</p>
          <p className="mt-2 text-xs text-app-muted-foreground">Поля: {item.changedFields.join(", ")}</p>
        </li>)}
      </ol> : <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-4 text-sm text-app-muted-foreground">Изменений для текущей выборки пока нет.</p>}
    </section>
    <CatalogAdminForms data={data} />
  </div>;
}
