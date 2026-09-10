import type { ReactNode } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";

type DataTableProps = {
  caption: string;
  columns: string[];
  rows: Array<{
    key: string;
    cells: ReactNode[];
  }>;
};

export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    <div className="min-w-0 w-full max-w-full overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)]">
      <div className="inline-block min-w-full align-top [&_[data-slot=table-container]]:overflow-visible">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="bg-[var(--muted)]">
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column}
                  scope="col"
                  className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-app-muted-foreground"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} className="border-t border-[var(--border)] align-top">
                {row.cells.map((cell, index) => (
                  <TableCell key={`${row.key}-${index}`} className="px-4 py-3 text-app-secondary">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
