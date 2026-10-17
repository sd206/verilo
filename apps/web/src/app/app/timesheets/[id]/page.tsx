import { notFound } from "next/navigation";
import { NotFoundError } from "@verilo/auth";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getTimesheetDetail } from "@/server/handlers/timesheets";
import { HoursEditor } from "./hours-editor";
import { EvidencePanel } from "./evidence-panel";
import { ChecksPanel } from "./checks-panel";
import { ComparisonPanel } from "./comparison-panel";
import { ReviewActions } from "./review-actions";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Timesheet" };

export default async function TimesheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const v = await getTimesheetDetail(deps(), ctx, { timesheetId: (await params).id }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const consultant = ctx.role === "CONSULTANT";
  const reviewing = !consultant && v.timesheet.status !== "NOT_STARTED" && v.timesheet.status !== "DRAFT";

  const header = (
    <PageHeader
      back={{ href: "/app/timesheets", label: consultant ? "My timesheets" : "Timesheet inbox" }}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {consultant ? v.timesheet.period : `${v.consultant.name} · ${v.timesheet.period}`}
          <StatusChip status={v.timesheet.status} />
        </span>
      }
      description={`${v.engagement.client}${v.engagement.roleTitle ? ` · ${v.engagement.roleTitle}` : ""}`}
    />
  );

  const returned = v.timesheet.status === "RETURNED" && v.timesheet.returnedReason && (
    <Alert variant="destructive" data-testid="returned-reason">
      <b>Returned:</b> {v.timesheet.returnedReason}
    </Alert>
  );

  if (!reviewing) {
    // Consultant editor (13.1), mobile first; staff entering on someone's behalf see the same.
    return (
      <div className="mx-auto grid max-w-xl gap-5 pb-24">
        <AutoRefresh active={v.extractionPending || v.timesheet.status === "SUBMITTED"} />
        {header}
        {returned}
        {v.timesheet.status === "SUBMITTED" && <Alert>Submitted. We're checking it against your screenshot.</Alert>}
        {v.timesheet.status === "VERIFIED" && <Alert variant="success">Verified. Nothing more to do.</Alert>}
        <EvidencePanel
          timesheetId={v.timesheet.id}
          evidence={v.evidence}
          canAttach={v.can.attach}
          required={v.engagement.evidenceRequired}
          mode="compact"
        />
        <HoursEditor
          timesheetId={v.timesheet.id}
          days={v.days}
          entries={v.entries}
          editable={v.can.edit}
          canSubmit={v.can.edit && (v.timesheet.status === "DRAFT" || v.timesheet.status === "NOT_STARTED" || v.timesheet.status === "RETURNED")}
          extracted={v.comparison.hasDaily ? Object.fromEntries(v.comparison.days.map((d) => [d.date, d.extracted])) : null}
          extractedTotal={v.comparison.extractedTotal}
        />
        <ChecksPanel checks={v.checks} canResolve={false} />
      </div>
    );
  }

  // Review (13.2 item 2): image and values side by side, differences highlighted.
  return (
    <div className="grid gap-5">
      <AutoRefresh active={v.extractionPending || v.timesheet.status === "SUBMITTED"} />
      {header}
      {returned}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <EvidencePanel timesheetId={v.timesheet.id} evidence={v.evidence} canAttach={v.can.attach} required={v.engagement.evidenceRequired} mode="viewer" />
        <div className="grid content-start gap-5">
          <ComparisonPanel
            consultantName={v.consultant.name}
            period={v.timesheet.period}
            periodStart={v.timesheet.periodStart}
            periodEnd={v.timesheet.periodEnd}
            comparison={v.comparison}
            evidence={v.evidence}
          />
          <ChecksPanel checks={v.checks} canResolve={v.can.review} />
          {(v.can.verify || v.can.return) && <ReviewActions timesheetId={v.timesheet.id} canVerify={v.can.verify} canReturn={v.can.return} status={v.timesheet.status} />}
          {!v.can.verify && v.can.review && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">To verify</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {v.extractionPending ? "Waiting for the screenshot to be read." : "Resolve each blocking check with a reason, then verify."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
