import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@verilo/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DefinitionList, PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getEngagementDetail } from "@/server/handlers/engagements";
import { CYCLE_LABELS, formatDate } from "@/lib/utils";
import { BillingChain } from "./billing-chain";
import { RatesTimeline } from "./rates-timeline";
import { AddPurchaseOrderForm, AddRateForm, EngagementStatusActions } from "./engagement-actions";

export const metadata = { title: "Engagement" };

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const { id } = await params;
  const d = await getEngagementDetail(deps(), ctx, { engagementId: id }).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const e = d.engagement;
  const title = e.roleTitle ?? e.projectName ?? "Engagement";
  const contractor = d.consultant.employmentType === "CONTRACTOR";

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: `/app/consultants/${d.consultant.id}`, label: d.consultant.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.consultant.name} · {title} <StatusChip status={e.status} />
          </span>
        }
        description={`${formatDate(e.startDate)} – ${e.endDate ? formatDate(e.endDate) : "open-ended"} · ${CYCLE_LABELS[e.timesheetCycle]} timesheets, ${CYCLE_LABELS[e.invoiceCycle]?.toLowerCase()} invoices`}
        actions={
          d.canEdit &&
          e.status !== "ENDED" && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/engagements/${id}/edit`}>Edit</Link>
              </Button>
              <EngagementStatusActions engagementId={id} status={e.status} endDate={e.endDate} today={d.today} />
            </>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing chain</CardTitle>
          <CardDescription>Who bills whom. Invoices go up the chain (right to left); payments come back down.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingChain nodes={d.chain} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="margin-preview">
          <CardHeader>
            <CardTitle className="text-base">Margin preview</CardTitle>
            <CardDescription>Regular hours at the rates in effect {d.margin ? `on ${formatDate(d.margin.asOf)}` : "today"}.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 tabular-nums">
            {d.margin ? (
              <>
                <Row label="Bill rate" value={`${d.margin.bill}/h`} />
                <Row label="Pay rate" value={`${d.margin.pay}/h`} />
                <div className="border-t border-border pt-3">
                  <Row label="Margin" value={`${d.margin.perHour}/h`} strong />
                  <Row label="Margin %" value={d.margin.percent} strong />
                </div>
                <p className="text-xs text-muted-foreground">Before the {d.deduction} bill-to deduction.</p>
              </>
            ) : d.billOnly ? (
              <>
                <Row label="Bill rate" value={`${d.billOnly.bill}/h`} />
                <p className="text-xs text-muted-foreground">W-2 consultant: pay costs aren&apos;t tracked here, so there&apos;s no margin preview.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Add a regular bill rate to see the margin.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DefinitionList
              items={[
                ["Expected hours", `${Number(e.expectedWeeklyHours)}/week (warn above ${Number(e.maxWeeklyHoursWarning)})`],
                ["Deduction", d.deduction + (e.deductionBpsOverride !== null ? " (override)" : "")],
                ["Evidence required", e.evidenceRequired ? "Yes" : "No"],
                ["Factored", e.factored ? "Yes" : "No"],
                ["Prime work order", e.primeWorkOrderNo],
                ["Prime's consultant ID", e.primeConsultantRef],
                ["VMS worker ID", e.endClientWorkerRef],
                ["Biweekly anchor", e.biweeklyAnchorDate ? formatDate(e.biweeklyAnchorDate) : null],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {d.showRates && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rates</CardTitle>
            <CardDescription>
              Effective-dated and never overlapping. To change a rate, end the current one and add the new one from the next day.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <RatesTimeline
              rates={d.rates}
              start={e.startDate}
              end={e.endDate}
              today={d.today}
              sides={contractor ? ["BILL", "PAY"] : ["BILL"]}
              canEdit={d.canEditRates && e.status !== "ENDED"}
            />
            {d.canEditRates && e.status !== "ENDED" && <AddRateForm engagementId={id} contractor={contractor} defaultFrom={e.startDate} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase orders</CardTitle>
          <CardDescription>Burn fills as invoices are issued (invoicing arrives in a later release).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {d.purchaseOrders.length === 0 && <p className="text-sm text-muted-foreground">No purchase orders.</p>}
          {d.purchaseOrders.map((po) => {
            const pct = po.amountCents ? Math.min(100, (po.burnedCents / po.amountCents) * 100) : 0;
            return (
              <div key={po.id} className="grid gap-2" data-testid="po">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    <code className="font-mono">{po.poNumber}</code>
                    <span className="ml-2 text-muted-foreground">
                      {po.startDate || po.endDate ? `${formatDate(po.startDate)} – ${formatDate(po.endDate)}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    $0.00 of {po.amount ?? "no limit"}
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`PO ${po.poNumber} burn`}>
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  {po.alertThresholdsBps.filter((b) => b <= 10000).map((b) => (
                    <span key={b} className="absolute top-[-3px] h-3.5 w-px bg-warning" style={{ left: `${b / 100}%` }} title={`Alert at ${b / 100}%`} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Alerts at {po.thresholds.join(", ")}</p>
              </div>
            );
          })}
          {d.canEdit && e.status !== "ENDED" && <AddPurchaseOrderForm engagementId={id} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timesheets</CardTitle>
          <CardDescription>Timesheet capture and review arrive in the next release.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-base font-semibold" : ""}>{value}</span>
    </div>
  );
}
