import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listUnmatched } from "@/server/handlers/timesheets";
import { AssignForm } from "./assign-form";
import { BulkUpload } from "../bulk-upload";

export const metadata = { title: "Unmatched intake" };

/** 13.2 item 3: files we couldn't match to a consultant or timesheet; assign them by hand. */
export default async function UnmatchedPage() {
  const { ctx } = await requireFirmPage();
  const { items, timesheets } = await listUnmatched(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: "/app/timesheets", label: "Timesheet inbox" }}
        title="Unmatched intake"
        description="Emailed and bulk-uploaded files that couldn't be matched automatically. Assign each to a timesheet."
        actions={<BulkUpload />}
      />
      {items.length === 0 && <Alert>Nothing to match. New emails and uploads appear here only when matching needs a person.</Alert>}
      <div className="grid gap-3" data-testid="unmatched">
        {items.map((i) => (
          <Card key={i.id} data-evidence={i.id}>
            <CardContent className="grid gap-4 p-4 md:grid-cols-[160px_1fr_minmax(280px,360px)]">
              <div className="h-32 overflow-hidden rounded-md border border-border bg-muted">
                {i.thumbnail ? (
                  <img src={i.thumbnail} alt={i.filename} className="h-32 w-full object-cover object-top" />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">{i.filename.split(".").pop()?.toUpperCase()}</div>
                )}
              </div>
              <div className="grid content-start gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.filename}</span>
                  {i.extractionStatus ? <StatusChip status={i.extractionStatus} /> : <StatusChip status="UNKNOWN" />}
                </div>
                <div className="text-muted-foreground">
                  {i.source === "EMAIL" ? `From ${i.fromAddress ?? "unknown"}${i.subject ? ` · “${i.subject}”` : ""}` : "Bulk upload"} · {formatDate(i.createdAt.toISOString().slice(0, 10))}
                </div>
                {i.extracted && (
                  <div className="text-muted-foreground">
                    Reads as: <b className="text-foreground">{i.extracted.consultantName ?? "no name"}</b> · {i.extracted.period ?? "no period"} · {i.extracted.totalHours ?? "?"} h ·{" "}
                    {i.extracted.approvalStatus.toLowerCase()}
                  </div>
                )}
                {i.consultantName && <div>Sender matched: {i.consultantName}</div>}
                {i.reason && <div className="text-warning">{i.reason}</div>}
              </div>
              <AssignForm evidenceId={i.id} timesheets={timesheets} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
