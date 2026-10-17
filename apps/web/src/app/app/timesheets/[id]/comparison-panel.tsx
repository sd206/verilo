import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/status-chip";
import { cn, formatDate } from "@/lib/utils";

type Extracted = {
  consultantName: string | null;
  vmsName: string | null;
  period: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalHours: string | null;
  approvalStatus: string;
  approverName: string | null;
  approvedAt: string | null;
  documentType: string;
  confidence: { overall: number; total_hours: number; daily_hours: number };
};

type Evidence = { id: string; filename: string; extraction: { status: string; error: string | null; model?: string | null; result: Extracted | null } | null };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Entered values next to what was read from the evidence; differences highlighted (13.2 item 2). */
export function ComparisonPanel({
  consultantName,
  period,
  periodStart,
  periodEnd,
  comparison,
  evidence,
}: {
  consultantName: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  comparison: {
    enteredTotal: string;
    extractedTotal: string | null;
    totalsDiffer: boolean;
    hasDaily: boolean;
    days: { date: string; entered: string; extracted: string | null; differs: boolean }[];
    notes: string[];
  };
  evidence: Evidence[];
}) {
  const reads = evidence.filter((e) => e.extraction?.result);
  const failed = evidence.filter((e) => e.extraction?.status === "FAILED");
  const first = reads[0]?.extraction?.result ?? null;
  const nameDiffers = !!first?.consultantName && first.consultantName.toLowerCase().replace(/[^a-z]/g, "") !== consultantName.toLowerCase().replace(/[^a-z]/g, "") ? true : false;
  const periodDiffers = !!first && (first.periodStart !== periodStart || first.periodEnd !== periodEnd);
  const rows: [string, string, React.ReactNode, boolean][] = [
    ["Consultant", consultantName, first?.consultantName ?? "—", nameDiffers],
    ["Period", period, first?.period ?? "—", periodDiffers],
    ["Total hours", comparison.enteredTotal, comparison.extractedTotal ?? "—", comparison.totalsDiffer],
    [
      "Approval",
      "Required",
      first ? (
        <span className="inline-flex items-center gap-1">
          <StatusChip status={first.approvalStatus} />
          {first.approverName && <span className="text-xs text-muted-foreground">{first.approverName}{first.approvedAt ? `, ${formatDate(first.approvedAt)}` : ""}</span>}
        </span>
      ) : (
        "—"
      ),
      !!first && first.approvalStatus !== "APPROVED",
    ],
  ];
  // Days that differ first, so they are never below the fold.
  const shown = comparison.days
    .filter((d) => Number(d.entered) > 0 || (d.extracted !== null && Number(d.extracted) > 0) || d.differs)
    .sort((a, b) => Number(b.differs) - Number(a.differs));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Entered vs. screenshot</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {reads.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {failed.length ? `The file couldn't be read automatically${failed[0]?.extraction?.error ? ` (${failed[0].extraction.error})` : ""}. Compare it with the hours by eye.` : "Nothing has been read from the evidence yet."}
          </p>
        )}
        <table className="w-full text-sm" data-testid="comparison">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-normal"></th>
              <th className="py-1 font-normal">Entered</th>
              <th className="py-1 font-normal">Screenshot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b, differs]) => (
              <tr key={k} className={cn("border-t border-border", differs && "bg-destructive/10")} data-differs={differs ? "true" : "false"} data-field={k}>
                <td className="py-1.5 pr-2 text-muted-foreground">{k}</td>
                <td className="py-1.5 pr-2 tabular-nums">{a}</td>
                <td className={cn("py-1.5 tabular-nums", differs && "font-semibold text-destructive")}>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {first && (
          <p className="text-xs text-muted-foreground">
            Read from {first.vmsName ?? first.documentType.toLowerCase().replace("_", " ")} · confidence {Math.round(first.confidence.overall * 100)}%
            {reads.length > 1 ? ` · ${reads.length} documents` : ""}
          </p>
        )}
        {comparison.notes.map((n) => (
          <p key={n} className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {n}
          </p>
        ))}
        {comparison.hasDaily && (
          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm" data-testid="daily-comparison">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-1.5 font-normal">Day</th>
                  <th className="px-3 py-1.5 text-right font-normal">Entered</th>
                  <th className="px-3 py-1.5 text-right font-normal">Screenshot</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.date} className={cn("border-t border-border", d.differs && "bg-destructive/10")} data-differs={d.differs ? "true" : "false"}>
                    <td className="px-3 py-1">
                      {DOW[new Date(`${d.date}T00:00:00Z`).getUTCDay()]} {formatDate(d.date).replace(/, \d{4}$/, "")}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{d.entered}</td>
                    <td className={cn("px-3 py-1 text-right tabular-nums", d.differs && "font-semibold text-destructive")}>{d.extracted ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
