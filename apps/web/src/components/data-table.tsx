"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  /** Plain value used for sorting, filtering and CSV. */
  value: (row: T) => string | number | null;
  /** Optional rendering for the cell. */
  cell?: (row: T) => React.ReactNode;
  align?: "left" | "right";
}

/**
 * Lists are filterable, sortable and exportable to CSV (13 "UI rules"). Money columns are
 * right-aligned with two decimals.
 */
export function DataTable<T>({
  rows,
  columns,
  rowHref,
  facet,
  csvName,
  empty = "Nothing here yet.",
  testId,
}: {
  rows: T[];
  columns: Column<T>[];
  rowHref?: (row: T) => string;
  /** One column offered as a dropdown filter (e.g. party kind). */
  facet?: { key: string; label: string; options: { value: string; label: string }[] };
  csvName: string;
  empty?: string;
  testId?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [facetValue, setFacetValue] = useState("");

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        header: c.header,
        accessorFn: (r: T) => c.value(r) ?? "",
        cell: (info) => (c.cell ? c.cell(info.row.original) : String(info.getValue() ?? "")),
        filterFn: "equalsString",
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: search, columnFilters: facet && facetValue ? [{ id: facet.key, value: facetValue }] : [] },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  function exportCsv() {
    const visible = table.getRowModel().rows.map((r) => r.original);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      // Neutralize spreadsheet formulas and quote everything.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [columns.map((c) => esc(c.header)).join(","), ...visible.map((r) => columns.map((c) => esc(c.value(r))).join(","))];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input aria-label="Search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        {facet && (
          <Select aria-label={facet.label} value={facetValue} onChange={(e) => setFacetValue(e.target.value)} className="sm:max-w-[14rem]">
            <option value="">All {facet.label.toLowerCase()}</option>
            {facet.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <Button type="button" variant="outline" size="sm" className="sm:ml-auto" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm tabular-nums" data-testid={testId}>
          <thead className="border-b border-border">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const col = columns.find((c) => c.key === h.column.id)!;
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={cn("h-10 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground", col.align === "right" ? "text-right" : "text-left")}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    >
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <span aria-hidden className="text-[10px]">
                          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                {r.getVisibleCells().map((cell, i) => {
                  const col = columns.find((c) => c.key === cell.column.id)!;
                  const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                  return (
                    <td key={cell.id} className={cn("px-3 py-2.5 align-middle", col.align === "right" && "text-right")}>
                      {i === 0 && rowHref ? (
                        <Link href={rowHref(r.original)} className="font-medium text-primary hover:underline">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {table.getRowModel().rows.length} of {rows.length}
      </p>
    </div>
  );
}
