"use client";

import { useTable, type ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { FilteredEmptyState, EmptyState } from "../states/StatePanel.tsx";
import { Pagination } from "../ui/pagination.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { impulseTableFeatures } from "./tanstack.ts";

export function AdminDataTable<TData extends { id: string }>({ ariaLabel, columns, data, mobileRenderer, toolbar, filtersActive, emptyTitle, emptyDescription, filteredEmptyDescription, page, pageCount, previousHref, nextHref, minWidth = "860px" }: { ariaLabel: string; columns: ColumnDef<typeof impulseTableFeatures, TData, unknown>[]; data: TData[]; mobileRenderer: (row: TData) => ReactNode; toolbar?: ReactNode; filtersActive?: boolean; emptyTitle: string; emptyDescription: string; filteredEmptyDescription: string; page: number; pageCount: number; previousHref: string; nextHref: string; minWidth?: string }) {
  const table = useTable({ features: impulseTableFeatures, data, columns });

  if (data.length === 0) {
    return filtersActive
      ? <FilteredEmptyState title="По фильтру ничего не найдено" description={filteredEmptyDescription} />
      : <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <section aria-label={ariaLabel} className="space-y-4">
      {toolbar}
      <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
        <Table className="text-left" style={{ minWidth }}>
          <TableHeader className="sticky top-0 z-10 bg-[var(--muted)]">
            {table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id} scope="col">{header.isPlaceholder ? null : <table.FlexRender header={header} />}</TableHead>)}</TableRow>)}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => <TableRow className="h-[50px] align-middle" key={row.original.id}>{row.getAllCells().map((cell) => <TableCell key={cell.id}><table.FlexRender cell={cell} /></TableCell>)}</TableRow>)}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:hidden">{data.map((row) => <div key={row.id}>{mobileRenderer(row)}</div>)}</div>
      <Pagination page={page} pageCount={pageCount} previousHref={previousHref} nextHref={nextHref} />
    </section>
  );
}
