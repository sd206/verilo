"use client";

import { DataTable } from "@/components/data-table";
import { PARTY_KIND_LABELS } from "@/lib/utils";

type Row = {
  id: string;
  kind: string;
  displayName: string;
  legalName: string;
  code: string | null;
  paymentTermsDays: number | null;
  vendorPayTerms: string | null;
  deduction: string | null;
  qboMapped: boolean;
};

export function PartiesTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      testId="parties-table"
      rows={rows}
      csvName="parties"
      rowHref={(r) => `/app/parties/${r.id}`}
      facet={{ key: "kind", label: "Kinds", options: Object.entries(PARTY_KIND_LABELS).map(([value, label]) => ({ value, label })) }}
      columns={[
        { key: "name", header: "Name", value: (r) => r.displayName },
        { key: "kind", header: "Kind", value: (r) => r.kind, cell: (r) => PARTY_KIND_LABELS[r.kind] },
        { key: "code", header: "Code", value: (r) => r.code, cell: (r) => (r.code ? <code className="font-mono">{r.code}</code> : "—") },
        {
          key: "terms",
          header: "Terms",
          value: (r) => (r.vendorPayTerms === "PAY_WHEN_PAID" ? "Pay when paid" : r.paymentTermsDays !== null ? `Net ${r.paymentTermsDays}` : ""),
        },
        { key: "deduction", header: "Deduction", value: (r) => r.deduction, align: "right" },
        { key: "qbo", header: "QuickBooks", value: (r) => (r.qboMapped ? "Mapped" : "Not mapped") },
      ]}
    />
  );
}
