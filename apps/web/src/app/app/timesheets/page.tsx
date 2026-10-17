import Link from "next/link";
import { can } from "@verilo/auth";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listMyTimesheets, listTimesheetInbox, listUnmatched } from "@/server/handlers/timesheets";
import { InboxTable } from "./inbox-table";
import { BulkUpload } from "./bulk-upload";

export const metadata = { title: "Timesheets" };

const FILTERS = [
  { key: "review", label: "To review", statuses: ["SUBMITTED", "NEEDS_REVIEW"] },
  { key: "open", label: "Not submitted", statuses: ["NOT_STARTED", "DRAFT", "RETURNED"] },
  { key: "verified", label: "Verified", statuses: ["VERIFIED", "INVOICED"] },
  { key: "all", label: "All", statuses: ["NOT_STARTED", "DRAFT", "SUBMITTED", "NEEDS_REVIEW", "VERIFIED", "RETURNED", "INVOICED"] },
] as const;

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { ctx } = await requireFirmPage();
  if (ctx.role === "CONSULTANT") return <MyTimesheets />;
  if (!can(ctx.role, "REVIEW_TIMESHEETS")) return <Alert>You don't have access to timesheets.</Alert>;
  const wanted = (await searchParams).show;
  const show = FILTERS.find((f) => f.key === wanted) ?? FILTERS[0];
  const [rows, unmatched] = await Promise.all([
    listTimesheetInbox(deps(), ctx, { statuses: [...show.statuses] }),
    listUnmatched(deps(), ctx),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Timesheet inbox"
        description="Submitted timesheets with their screenshots and checks. Open one to compare the image with the entered hours."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/timesheets/unmatched" data-testid="unmatched-link">
                Unmatched {unmatched.items.length > 0 && <span className="rounded-full bg-warning/15 px-2 text-warning">{unmatched.items.length}</span>}
              </Link>
            </Button>
            <BulkUpload />
          </>
        }
      />
      <nav className="flex gap-1 overflow-x-auto" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/app/timesheets?show=${f.key}`}
            className={`rounded-md px-3 py-1.5 text-sm ${f.key === show.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <InboxTable rows={rows.map((r) => ({ ...r, submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null }))} />
    </div>
  );
}

async function MyTimesheets() {
  const { ctx } = await requireFirmPage();
  const data = await listMyTimesheets(deps(), ctx);
  const current = data.timesheets.find((t) => t.id === data.current);
  const returned = data.timesheets.filter((t) => t.status === "RETURNED");
  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">My timesheets</h1>
      {current && data.cta && (
        <Button asChild size="lg" className="h-16 text-lg" data-testid="submit-current">
          <Link href={`/app/timesheets/${current.id}`}>
            {data.cta} <span className="font-normal opacity-80">· {current.period}</span>
          </Link>
        </Button>
      )}
      {returned.map((t) => (
        <Alert key={t.id} variant="destructive">
          <b>{t.period} was returned:</b> {t.returnedReason}{" "}
          <Link className="underline" href={`/app/timesheets/${t.id}`}>
            Fix it
          </Link>
        </Alert>
      ))}
      {data.timesheets.length === 0 && <Alert>You have no timesheets yet. They appear when your engagement starts.</Alert>}
      <div className="grid gap-2" data-testid="my-timesheets">
        {data.timesheets.map((t) => (
          <Link key={t.id} href={`/app/timesheets/${t.id}`} className="block">
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="font-medium">{t.period}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {t.client}
                    {t.roleTitle ? ` · ${t.roleTitle}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={t.status} />
                  <span className="text-sm tabular-nums text-muted-foreground">{t.totalHours} h</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
