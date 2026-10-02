import * as React from "react";
import { cn } from "../../shared/lib/cn.ts";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) { return <div data-slot="table-container" className="relative w-full overflow-x-auto"><table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} /></div>; }
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead data-slot="table-header" className={cn("bg-[var(--muted)] [&_tr]:border-b", className)} {...props} />; }
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />; }
export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <tfoot data-slot="table-footer" className={cn("border-t bg-[var(--muted)] font-medium", className)} {...props} />; }
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) { return <tr data-slot="table-row" className={cn("border-b transition-colors hover:bg-[var(--muted)]/60", className)} {...props} />; }
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th data-slot="table-head" className={cn("h-10 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-app-muted-foreground", className)} {...props} />; }
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td data-slot="table-cell" className={cn("p-4 align-middle", className)} {...props} />; }
export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) { return <caption data-slot="table-caption" className={cn("mt-4 text-sm text-app-muted-foreground", className)} {...props} />; }
