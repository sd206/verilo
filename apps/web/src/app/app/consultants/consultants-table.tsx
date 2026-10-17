"use client";

import { DataTable } from "@/components/data-table";
import { StatusChip } from "@/components/status-chip";
import { formatDate } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  emails: string[];
  employmentType: string;
  subVendorName: string | null;
  status: string;
  workAuthExpiry: string | null;
  activeEngagements: number;
};

export function ConsultantsTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      testId="consultants-table"
      rows={rows}
      csvName="consultants"
      rowHref={(r) => `/app/consultants/${r.id}`}
      facet={{
        key: "type",
        label: "Types",
        options: [
          { value: "W2", label: "W-2" },
          { value: "CONTRACTOR", label: "Contractor" },
        ],
      }}
      columns={[
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "type", header: "Type", value: (r) => r.employmentType, cell: (r) => (r.employmentType === "W2" ? "W-2" : "Contractor") },
        { key: "sub", header: "Sub-vendor", value: (r) => r.subVendorName },
        { key: "email", header: "Email", value: (r) => r.emails[0] ?? "" },
        { key: "engagements", header: "Active engagements", value: (r) => r.activeEngagements, align: "right" },
        { key: "auth", header: "Work auth expiry", value: (r) => r.workAuthExpiry, cell: (r) => formatDate(r.workAuthExpiry) },
        { key: "status", header: "Status", value: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
      ]}
    />
  );
}
