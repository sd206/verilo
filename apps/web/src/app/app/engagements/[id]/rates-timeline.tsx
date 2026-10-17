import { daysBetween, addDays } from "@verilo/domain";
import { formatDate } from "@/lib/utils";
import { EndRateButton } from "./engagement-actions";

type R = { id: string; side: "BILL" | "PAY"; rateKind: string; effectiveFrom: string; effectiveTo: string | null; rate: string };

/**
 * Rates on a shared time axis: one lane per side and kind. Bars are inclusive ranges;
 * open-ended rates run to the right edge.
 */
export function RatesTimeline({
  rates,
  start,
  end,
  today,
  sides,
  canEdit,
}: {
  rates: R[];
  start: string;
  end: string | null;
  today: string;
  sides: ("BILL" | "PAY")[];
  canEdit: boolean;
}) {
  const lastStart = rates.reduce((m, r) => (r.effectiveFrom > m ? r.effectiveFrom : m), start);
  const axisStart = rates.reduce((m, r) => (r.effectiveFrom < m ? r.effectiveFrom : m), start);
  const axisEnd = end ?? [addDays(today, 90), addDays(lastStart, 90)].sort().at(-1)!;
  const span = Math.max(1, daysBetween(axisStart, axisEnd) + 1);
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(axisStart, d) / span) * 100));
  const lanes = sides.flatMap((side) => {
    const kinds = [...new Set(rates.filter((r) => r.side === side).map((r) => r.rateKind))];
    return (kinds.length ? kinds : ["REGULAR"]).map((kind) => ({ side, kind, rates: rates.filter((r) => r.side === side && r.rateKind === kind) }));
  });

  return (
    <div className="grid gap-4" data-testid="rates-timeline">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatDate(axisStart)}</span>
        <span>{end ? formatDate(axisEnd) : `${formatDate(axisEnd)} →`}</span>
      </div>
      {lanes.map((lane) => (
        <div key={`${lane.side}-${lane.kind}`} className="grid gap-2 md:grid-cols-[9rem_1fr] md:items-start">
          <div className="text-sm font-medium">
            {lane.side === "BILL" ? "Bill" : "Pay"} · <span className="text-muted-foreground">{lane.kind.toLowerCase()}</span>
          </div>
          <div className="grid gap-2">
            <div className="relative h-8 rounded-md bg-muted">
              {today >= axisStart && today <= axisEnd && (
                <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${pos(today)}%` }} title="Today" />
              )}
              {lane.rates.map((r) => {
                const left = pos(r.effectiveFrom);
                const right = r.effectiveTo ? pos(addDays(r.effectiveTo, 1)) : 100;
                return (
                  <div
                    key={r.id}
                    className={`absolute inset-y-1 flex items-center overflow-hidden rounded px-2 text-xs font-medium tabular-nums ${lane.side === "BILL" ? "bg-primary text-primary-foreground" : "bg-[#7c5c2e] text-white"}`}
                    style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }}
                    title={`${r.rate}/h ${formatDate(r.effectiveFrom)} – ${r.effectiveTo ? formatDate(r.effectiveTo) : "open"}`}
                  >
                    {r.rate}
                  </div>
                );
              })}
              {lane.rates.length === 0 && <span className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground">No rate — invoicing is blocked (NO_RATE)</span>}
            </div>
            <ul className="grid gap-1 text-sm">
              {lane.rates.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="rate-row">
                  <span className="w-20 text-right font-medium tabular-nums">{r.rate}</span>
                  <span className="text-muted-foreground">
                    {formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : "open-ended"}
                  </span>
                  {canEdit && !r.effectiveTo && <EndRateButton rateId={r.id} label={`${lane.side === "BILL" ? "bill" : "pay"} rate ${r.rate}`} from={r.effectiveFrom} />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
