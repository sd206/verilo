"use client";

import { DataTable } from "@/components/data-table";
import { StatusChip } from "@/components/status-chip";
import { formatDate } from "@/lib/utils";

type Row = {
  id: string;
  consultantName: string;
  client: string;
  period: string;
  periodStart: string;
  status: string;
  totalHours: string;
  submittedAt: string | null;
  openBlocks: number;
  openWarnings: number;
  evidenceCount: number;
};

export function InboxTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      testId="timesheet-inbox"
      rows={rows}
      csvName="timesheets"
      rowHref={(r) => `/app/timesheets/${r.id}`}
      columns={[
        { key: "consultant", header: "Consultant", value: (r) => r.consultantName },
        { key: "client", header: "Bill to", value: (r) => r.client },
        { key: "period", header: "Period", value: (r) => r.periodStart, cell: (r) => r.period },
        { key: "hours", header: "Hours", value: (r) => Number(r.totalHours), cell: (r) => r.totalHours, align: "right" },
        {
          key: "checks",
          header: "Checks",
          value: (r) => r.openBlocks * 100 + r.openWarnings,
          cell: (r) =>
            r.openBlocks > 0 ? (
              <span className="text-destructive">{r.openBlocks} blocking</span>
            ) : r.openWarnings > 0 ? (
              <span className="text-warning">{r.openWarnings} warning{r.openWarnings > 1 ? "s" : ""}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        { key: "evidence", header: "Files", value: (r) => r.evidenceCount, align: "right" },
        { key: "submitted", header: "Submitted", value: (r) => r.submittedAt, cell: (r) => formatDate(r.submittedAt?.slice(0, 10)) },
        { key: "status", header: "Status", value: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
      ]}
    />
  );
}
