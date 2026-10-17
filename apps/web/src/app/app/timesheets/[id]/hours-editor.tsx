"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveTimesheetEntriesAction, submitTimesheetAction } from "@/server/actions/timesheets";

type Day = { date: string; weekend: boolean; holiday: string | null; inEngagement: boolean };
type Entry = { workDate: string; hours: string; rateKind: string; note: string | null };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  return { dow: DOW[dt.getUTCDay()]!, date: `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}` };
};

/** "7:30" → "7.5"; anything else is passed through for the server to validate. */
function normalize(v: string): string {
  const t = v.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  return m ? String(Number(m[1]) + Number(m[2]) / 60).replace(/(\.\d{2})\d+$/, "$1") : t;
}

const toNum = (v: string) => {
  const n = Number(normalize(v));
  return Number.isFinite(n) ? n : 0;
};

export function HoursEditor({
  timesheetId,
  days,
  entries,
  editable,
  canSubmit,
  extracted,
  extractedTotal,
}: {
  timesheetId: string;
  days: Day[];
  entries: Entry[];
  editable: boolean;
  canSubmit: boolean;
  extracted: Record<string, string | null> | null;
  extractedTotal: string | null;
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    const reg: Record<string, string> = {};
    const ot: Record<string, string> = {};
    for (const e of entries) {
      const v = String(Number(e.hours));
      if (e.rateKind === "OVERTIME") ot[e.workDate] = v;
      else if (e.rateKind === "REGULAR") reg[e.workDate] = v;
    }
    return { reg, ot };
  }, [entries]);
  const passthrough = entries.filter((e) => e.rateKind === "HOLIDAY");
  const [reg, setReg] = useState(initial.reg);
  const [ot, setOt] = useState(initial.ot);
  const [showOt, setShowOt] = useState(Object.keys(initial.ot).length > 0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = days.reduce((s, d) => s + toNum(reg[d.date] ?? "") + toNum(ot[d.date] ?? ""), 0) + passthrough.reduce((s, e) => s + Number(e.hours), 0);
  const dirty = JSON.stringify(reg) !== JSON.stringify(initial.reg) || JSON.stringify(ot) !== JSON.stringify(initial.ot);

  const payload = () => ({
    timesheetId,
    entries: [
      ...Object.entries(reg)
        .filter(([, v]) => v.trim() !== "")
        .map(([workDate, v]) => ({ workDate, hours: normalize(v), rateKind: "REGULAR" })),
      ...Object.entries(ot)
        .filter(([, v]) => v.trim() !== "")
        .map(([workDate, v]) => ({ workDate, hours: normalize(v), rateKind: "OVERTIME" })),
      ...passthrough.map((e) => ({ workDate: e.workDate, hours: e.hours, rateKind: e.rateKind, note: e.note })),
    ],
  });

  function save(then?: () => Promise<void>) {
    setError(null);
    setSaved(null);
    start(async () => {
      const r = await saveTimesheetEntriesAction(payload());
      if (!r.ok) return setError(r.error);
      if (then) await then();
      else setSaved(`Saved · ${r.data.totalHours} hours`);
      router.refresh();
    });
  }

  function submit() {
    save(async () => {
      const r = await submitTimesheetAction({ timesheetId });
      if (!r.ok) setError(r.error);
      else setSaved("Submitted");
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Hours</CardTitle>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums" data-testid="total-hours">
            {total.toFixed(2)}
          </div>
          {extractedTotal !== null && (
            <div className={cn("text-xs", Number(extractedTotal) === Number(total.toFixed(2)) ? "text-success" : "text-destructive")}>
              Screenshot shows {extractedTotal}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-0">
        {editable && (
          <label className="flex items-center gap-2 px-6 text-sm text-muted-foreground">
            <input type="checkbox" checked={showOt} onChange={(e) => setShowOt(e.target.checked)} /> I worked overtime
          </label>
        )}
        <div className="divide-y divide-border" data-testid="hours-grid">
          {days.map((d) => {
            const l = label(d.date);
            const shot = extracted?.[d.date] ?? null;
            const mine = toNum(reg[d.date] ?? "") + toNum(ot[d.date] ?? "");
            const off = shot !== null && Number(shot) !== Number(mine.toFixed(2));
            return (
              <div
                key={d.date}
                className={cn("flex items-center gap-3 px-6 py-2", (d.weekend || !d.inEngagement) && "bg-muted/40", off && "bg-destructive/5")}
              >
                <div className="w-24 shrink-0">
                  <div className={cn("text-sm font-medium", d.weekend && "text-muted-foreground")}>{l.dow}</div>
                  <div className="text-xs text-muted-foreground">{l.date}</div>
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  {d.holiday && <span className="rounded bg-accent px-1.5 py-0.5 text-primary">{d.holiday}</span>}
                  {!d.inEngagement && <span className="text-muted-foreground">Outside engagement</span>}
                  {off && <span className="text-destructive"> Screenshot: {shot}</span>}
                </div>
                <input
                  aria-label={`Hours on ${l.dow} ${l.date}`}
                  data-date={d.date}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!editable || pending}
                  value={reg[d.date] ?? ""}
                  onChange={(e) => setReg({ ...reg, [d.date]: e.target.value })}
                  className="h-11 w-20 rounded-md border border-input bg-card px-2 text-right text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                />
                {showOt && (
                  <input
                    aria-label={`Overtime on ${l.dow} ${l.date}`}
                    inputMode="decimal"
                    placeholder="OT"
                    disabled={!editable || pending}
                    value={ot[d.date] ?? ""}
                    onChange={(e) => setOt({ ...ot, [d.date]: e.target.value })}
                    className="h-11 w-16 rounded-md border border-input bg-card px-2 text-right text-base tabular-nums disabled:opacity-60"
                  />
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <Alert variant="destructive" className="mx-6">
            {error}
          </Alert>
        )}
        {saved && (
          <Alert variant="success" className="mx-6" data-testid="save-result">
            {saved}
          </Alert>
        )}
        {editable && (
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card px-6 py-3">
            <Button type="button" variant="outline" className="flex-1" disabled={pending || !dirty} onClick={() => save()}>
              Save
            </Button>
            {canSubmit && (
              <Button type="button" className="flex-1" disabled={pending} onClick={submit} data-testid="submit-timesheet">
                Submit
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
