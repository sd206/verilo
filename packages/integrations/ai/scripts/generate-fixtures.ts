/**
 * Builds the synthetic fixture set (8.7) until pilot firms provide anonymized screenshots (open
 * decision 8): VMS-style timesheets rendered with Chromium, then degraded like real uploads
 * (phone photos, low resolution, partial crops, PDF exports). Every fixture gets
 * `<name>.expected.json` — the 8.2 answer a perfect reader would give — and manifest.json says
 * which fixtures count as "clear" for the ≥ 98 % target.
 *
 *   pnpm --filter @verilo/ai fixtures:generate      (PW_CHROMIUM_PATH optional)
 *
 * All names, IDs and companies are invented.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

type Status = "APPROVED" | "SUBMITTED" | "REJECTED" | "DRAFT";
type Template = "fieldglass" | "beeline" | "calendar" | "email";
type Variant = "clean" | "phone" | "lowres" | "crop-header" | "crop-total" | "pdf";

interface Spec {
  name: string;
  template: Template;
  consultant: string;
  workerId: string | null;
  tsId: string | null;
  start: string;
  end: string;
  /** Hours per date (regular, overtime). Missing dates are 0. */
  days: Record<string, { reg: number; ot?: number }>;
  status: Status;
  approver: string | null;
  approvedAt: string | null;
  variant: Variant;
  clear: boolean;
  notes: string;
}

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

// --- date helpers ---------------------------------------------------------------------------------
const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const range = (a: string, b: string) => {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
};
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const weekday = (d: string) => dow(d) !== 0 && dow(d) !== 6;
const us = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const fmt = (h: number) => h.toFixed(2);

function workweek(start: string, end: string, hours = 8, overrides: Record<string, { reg: number; ot?: number }> = {}) {
  const days: Spec["days"] = {};
  for (const d of range(start, end)) if (weekday(d)) days[d] = { reg: hours };
  return { ...days, ...overrides };
}

const total = (s: Spec) => Object.values(s.days).reduce((t, x) => t + x.reg + (x.ot ?? 0), 0);

// --- templates ------------------------------------------------------------------------------------
const STATUS_STYLE: Record<Status, { label: string; bg: string; fg: string }> = {
  APPROVED: { label: "Approved", bg: "#dcfce7", fg: "#166534" },
  SUBMITTED: { label: "Submitted", bg: "#fef3c7", fg: "#92400e" },
  REJECTED: { label: "Rejected", bg: "#fee2e2", fg: "#991b1b" },
  DRAFT: { label: "Draft", bg: "#e5e7eb", fg: "#374151" },
};

function fieldglass(s: Spec, opts: { hideHeader: boolean; hideTotal: boolean }) {
  const dates = range(s.start, s.end);
  const st = STATUS_STYLE[s.status];
  const anyOt = Object.values(s.days).some((x) => x.ot);
  const cell = (v: number) => `<td style="text-align:right;padding:6px 10px;border:1px solid #d1d5db">${v ? fmt(v) : ""}</td>`;
  return `
<div id="doc" style="width:1100px;font-family:Arial,Helvetica,sans-serif;font-size:13px;background:#fff;color:#111">
  <div style="background:#0a3d62;color:#fff;padding:10px 16px;font-size:16px"><b>SAP Fieldglass</b> &nbsp;|&nbsp; Time Sheet</div>
  ${
    opts.hideHeader
      ? ""
      : `<div style="padding:12px 16px;display:grid;grid-template-columns:200px 1fr 200px 1fr;gap:6px 12px">
    <div style="color:#6b7280">Time Sheet ID</div><div>${s.tsId}</div>
    <div style="color:#6b7280">Status</div><div><span style="background:${st.bg};color:${st.fg};padding:2px 10px;border-radius:10px;font-weight:bold">${st.label}</span></div>
    <div style="color:#6b7280">Worker</div><div>${s.consultant}</div>
    <div style="color:#6b7280">Worker ID</div><div>${s.workerId}</div>
    <div style="color:#6b7280">Time Period</div><div>${us(s.start)} - ${us(s.end)}</div>
    <div style="color:#6b7280">Buyer</div><div>Initrode Holdings</div>
  </div>`
  }
  <table style="border-collapse:collapse;margin:8px 16px">
    <tr style="background:#f3f4f6"><th style="padding:6px 10px;border:1px solid #d1d5db;text-align:left">Rate Category</th>
      ${dates.map((d) => `<th style="padding:6px 10px;border:1px solid #d1d5db">${DAY[dow(d)]}<br>${d.slice(5, 7)}/${d.slice(8)}</th>`).join("")}
      ${opts.hideTotal ? "" : `<th style="padding:6px 10px;border:1px solid #d1d5db">Total</th>`}</tr>
    <tr><td style="padding:6px 10px;border:1px solid #d1d5db">ST/Hr</td>${dates.map((d) => cell(s.days[d]?.reg ?? 0)).join("")}
      ${opts.hideTotal ? "" : cell(dates.reduce((t, d) => t + (s.days[d]?.reg ?? 0), 0))}</tr>
    ${anyOt ? `<tr><td style="padding:6px 10px;border:1px solid #d1d5db">OT/Hr</td>${dates.map((d) => cell(s.days[d]?.ot ?? 0)).join("")}${opts.hideTotal ? "" : cell(dates.reduce((t, d) => t + (s.days[d]?.ot ?? 0), 0))}</tr>` : ""}
  </table>
  ${opts.hideTotal ? "" : `<div style="padding:4px 16px 12px;font-size:15px"><b>Total Hours: ${fmt(total(s))}</b></div>`}
  ${s.status === "APPROVED" && !opts.hideHeader ? `<div style="padding:0 16px 16px;color:#166534">Approved by ${s.approver} on ${us(s.approvedAt!)}</div>` : ""}
</div>`;
}

function beeline(s: Spec, opts: { hideHeader: boolean; hideTotal: boolean }) {
  const dates = range(s.start, s.end);
  const st = STATUS_STYLE[s.status];
  return `
<div id="doc" style="width:560px;font-family:'Segoe UI',Roboto,sans-serif;font-size:14px;background:#fafafa;color:#1f2937;padding-bottom:12px">
  <div style="background:#ff6a13;color:#fff;padding:12px 16px;font-weight:600">Beeline &nbsp;·&nbsp; Timesheet</div>
  ${
    opts.hideHeader
      ? ""
      : `<div style="padding:12px 16px">
    <div style="font-size:18px;font-weight:600">${s.consultant}</div>
    <div style="color:#6b7280">Week ending ${MON[Number(s.end.slice(5, 7)) - 1]} ${Number(s.end.slice(8))}, ${s.end.slice(0, 4)} &nbsp;·&nbsp; ${us(s.start)} – ${us(s.end)}</div>
    <div style="margin-top:6px"><span style="border:1px solid ${st.fg};color:${st.fg};padding:2px 8px;border-radius:4px">${st.label.toUpperCase()}</span>
    ${s.workerId ? `<span style="margin-left:10px;color:#6b7280">Resource # ${s.workerId}</span>` : ""}</div>
  </div>`
  }
  <div style="margin:0 16px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
    ${dates
      .map(
        (d) => `<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f3f4f6">
      <span>${DAY[dow(d)]}, ${MON[Number(d.slice(5, 7)) - 1]!.slice(0, 3)} ${Number(d.slice(8))}</span>
      <span>${(s.days[d]?.reg ?? 0) ? hhmm(s.days[d]!.reg) : "—"}${s.days[d]?.ot ? ` <small style="color:#b45309">+${hhmm(s.days[d]!.ot!)} OT</small>` : ""}</span></div>`,
      )
      .join("")}
    ${opts.hideTotal ? "" : `<div style="display:flex;justify-content:space-between;padding:10px 12px;font-weight:700"><span>Total</span><span>${hhmm(total(s))}</span></div>`}
  </div>
  ${s.status === "APPROVED" && !opts.hideHeader ? `<div style="margin:10px 16px;color:#166534">✔ Approved by ${s.approver} · ${us(s.approvedAt!)}</div>` : ""}
</div>`;
}

function calendar(s: Spec, opts: { hideHeader: boolean; hideTotal: boolean }) {
  const first = s.start;
  const lead = (dow(first) + 6) % 7; // Monday-first grid
  const cells: string[] = Array.from({ length: lead }, () => `<td style="border:1px solid #e5e7eb;height:58px"></td>`);
  for (const d of range(s.start, s.end)) {
    const h = (s.days[d]?.reg ?? 0) + (s.days[d]?.ot ?? 0);
    cells.push(`<td style="border:1px solid #e5e7eb;height:58px;vertical-align:top;padding:4px;width:110px">
      <div style="color:#9ca3af;font-size:11px">${Number(d.slice(8))}</div><div style="font-size:16px;text-align:center">${h ? fmt(h) : ""}</div></td>`);
  }
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);
  const st = STATUS_STYLE[s.status];
  return `
<div id="doc" style="width:860px;font-family:Georgia,serif;background:#fff;color:#111;padding:16px">
  ${
    opts.hideHeader
      ? ""
      : `<div style="display:flex;justify-content:space-between;align-items:baseline">
    <div><div style="font-size:20px">TimeTrack Pro — Monthly Timesheet</div>
      <div style="color:#4b5563">${s.consultant}${s.workerId ? ` · Contractor ID ${s.workerId}` : ""}</div></div>
    <div style="text-align:right"><div style="font-size:18px">${MON[Number(s.start.slice(5, 7)) - 1]} ${s.start.slice(0, 4)}</div>
      <div style="color:${st.fg};font-weight:bold">${st.label}</div></div>
  </div>`
  }
  <table style="border-collapse:collapse;margin-top:10px">
    <tr>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => `<th style="padding:4px;color:#6b7280;font-weight:normal">${x}</th>`).join("")}</tr>
    ${rows.join("")}
  </table>
  ${opts.hideTotal ? "" : `<div style="margin-top:10px;font-size:16px">Month total: <b>${fmt(total(s))}</b> hours</div>`}
  ${s.status === "APPROVED" && !opts.hideHeader ? `<div style="color:#166534">Client approval: ${s.approver}, ${us(s.approvedAt!)}</div>` : ""}
</div>`;
}

function email(s: Spec) {
  const month = `${MON[Number(s.start.slice(5, 7)) - 1]} ${s.start.slice(0, 4)}`;
  return `
<div id="doc" style="width:760px;font-family:-apple-system,Helvetica,sans-serif;font-size:14px;background:#fff;color:#111;border:1px solid #e5e7eb">
  <div style="padding:12px 16px;border-bottom:1px solid #e5e7eb">
    <div style="font-size:18px;font-weight:600">RE: Timesheet approval — ${s.consultant} — ${month}</div>
    <div style="color:#6b7280;margin-top:4px">From: ${s.approver} &lt;${s.approver!.toLowerCase().replace(/[^a-z]+/g, ".")}@initrode.example&gt;</div>
    <div style="color:#6b7280">Sent: ${us(s.approvedAt!)} 4:12 PM</div>
  </div>
  <div style="padding:16px;line-height:1.5">
    <p>Hi team,</p>
    <p>${s.status === "APPROVED" ? "I approve" : "I have not yet approved"} ${s.consultant}'s hours for ${us(s.start)} through ${us(s.end)}: <b>${fmt(total(s))} hours</b>.</p>
    <p>Thanks,<br>${s.approver}<br>Engineering Manager, Initrode Holdings</p>
  </div>
</div>`;
}

// --- expected answer (8.2) --------------------------------------------------------------------------
function expected(s: Spec) {
  const hideHeader = s.variant === "crop-header";
  // With the total cropped off, the prompt asks for the sum of the daily hours: the same number.
  const showsDaily = s.template !== "email";
  const daily = showsDaily
    ? range(s.start, s.end).flatMap((d) => {
        const x = s.days[d];
        if (!x) return [];
        const out = [{ date: d, hours: x.reg, rate_kind: s.template === "calendar" ? "UNKNOWN" : "REGULAR" }];
        if (x.ot) out.push({ date: d, hours: x.ot, rate_kind: "OVERTIME" });
        return s.template === "calendar" ? [{ date: d, hours: x.reg + (x.ot ?? 0), rate_kind: "UNKNOWN" }] : out;
      })
    : [];
  const one = 1;
  return {
    document_type: s.template === "email" ? "EMAIL_APPROVAL" : "VMS_TIMESHEET",
    vms_name: { fieldglass: "SAP Fieldglass", beeline: "Beeline", calendar: "TimeTrack Pro", email: null }[s.template],
    consultant_name: hideHeader ? null : s.consultant,
    worker_id: hideHeader ? null : s.template === "email" ? null : s.workerId,
    timesheet_id: hideHeader ? null : s.template === "fieldglass" ? s.tsId : null,
    period_start: hideHeader && s.template !== "beeline" ? null : s.start,
    period_end: hideHeader && s.template !== "beeline" ? null : s.end,
    daily_hours: daily,
    total_hours: total(s),
    approval_status: hideHeader ? "UNKNOWN" : s.status,
    approver_name: s.status === "APPROVED" && !hideHeader ? s.approver : null,
    approved_at: s.status === "APPROVED" && !hideHeader ? s.approvedAt : null,
    confidence: { overall: one, period: one, total_hours: one, daily_hours: one, approval_status: one },
    notes: null,
  };
}

// --- the set ---------------------------------------------------------------------------------------
const people = [
  ["Ravi Kumar", "FG-W-20417"],
  ["Meera Shah", "FG-W-20533"],
  ["Daniel Ortiz", "FG-W-19876"],
  ["Priya Nair", "BL-88213"],
  ["Wei Chen", "BL-88301"],
  ["Anita Desai", "TT-5521"],
  ["Tomás Rivera", "TT-5602"],
  ["Grace Okafor", "FG-W-21102"],
] as const;

function specs(): Spec[] {
  const out: Spec[] = [];
  const base = (over: Partial<Spec> & Pick<Spec, "name" | "template" | "start" | "end">): Spec => ({
    consultant: "Ravi Kumar",
    workerId: "FG-W-20417",
    tsId: `TS-${100000 + out.length * 37}`,
    days: workweek(over.start, over.end),
    status: "APPROVED",
    approver: "Jordan Ellis",
    approvedAt: addDays(over.end, 1),
    variant: "clean",
    clear: true,
    notes: "",
    ...over,
  });
  // Fieldglass weekly (Mon–Sun)
  const weeks = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
  weeks.forEach((w, i) => {
    const [name, id] = people[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]!;
    const end = addDays(w, 6);
    out.push(
      base({
        name: `fieldglass-week-${i + 1}`,
        template: "fieldglass",
        consultant: name,
        workerId: id,
        start: w,
        end,
        days:
          i === 2
            ? workweek(w, end, 8, { [addDays(w, 2)]: { reg: 8, ot: 2 }, [addDays(w, 3)]: { reg: 8, ot: 1.5 } })
            : i === 5
              ? workweek(w, end, 8, { [addDays(w, 4)]: { reg: 0 } })
              : workweek(w, end, i === 6 ? 9 : 8),
        status: i === 3 ? "SUBMITTED" : i === 7 ? "REJECTED" : "APPROVED",
        notes: i === 2 ? "overtime rows" : i === 3 ? "not yet approved" : i === 7 ? "rejected" : i === 5 ? "a day off" : "",
      }),
    );
  });
  // Beeline weekly with H:MM hours
  ["2026-09-14", "2026-09-21", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].forEach((w, i) => {
    const [name, id] = people[3 + (i % 2)]!;
    const end = addDays(w, 6);
    out.push(
      base({
        name: `beeline-week-${i + 1}`,
        template: "beeline",
        consultant: name,
        workerId: id,
        tsId: null,
        start: w,
        end,
        days: i === 1 ? workweek(w, end, 7.5) : i === 3 ? workweek(w, end, 8, { [addDays(w, 1)]: { reg: 8, ot: 2.25 } }) : workweek(w, end, 8),
        status: i === 4 ? "SUBMITTED" : "APPROVED",
        notes: i === 1 ? "7:30 days" : i === 3 ? "overtime as +H:MM" : i === 4 ? "not yet approved" : "",
      }),
    );
  });
  // Monthly calendar
  const months = [
    ["2026-08-01", "2026-08-31"],
    ["2026-09-01", "2026-09-30"],
    ["2026-10-01", "2026-10-31"],
    ["2026-11-01", "2026-11-30"],
    ["2026-09-01", "2026-09-30"],
    ["2026-10-01", "2026-10-31"],
  ] as const;
  months.forEach(([a, b], i) => {
    const [name, id] = people[5 + (i % 2)]!;
    out.push(
      base({
        name: `calendar-month-${i + 1}`,
        template: "calendar",
        consultant: i >= 4 ? "Ravi Kumar" : name,
        workerId: i >= 4 ? null : id,
        tsId: null,
        start: a,
        end: b,
        days: i === 3 ? workweek(a, b, 8, { "2026-11-26": { reg: 0 }, "2026-11-27": { reg: 0 } }) : workweek(a, b, 8),
        notes: i === 3 ? "holiday days off" : "",
      }),
    );
  });
  // Ravi's October with a day off: 168 hours (the E2E's T3-style mismatch against 176 entered)
  out.push(
    base({
      name: "calendar-month-7",
      template: "calendar",
      consultant: "Ravi Kumar",
      workerId: null,
      tsId: null,
      start: "2026-10-01",
      end: "2026-10-31",
      days: workweek("2026-10-01", "2026-10-31", 8, { "2026-10-30": { reg: 0 } }),
      notes: "one weekday off",
    }),
  );
  // Approval emails (no daily breakdown)
  [
    ["2026-09-01", "2026-09-30", "Ravi Kumar", "APPROVED"],
    ["2026-10-01", "2026-10-31", "Meera Shah", "APPROVED"],
    ["2026-10-05", "2026-10-11", "Daniel Ortiz", "APPROVED"],
    ["2026-10-01", "2026-10-31", "Grace Okafor", "SUBMITTED"],
  ].forEach(([a, b, name, status], i) => {
    out.push(
      base({
        name: `email-approval-${i + 1}`,
        template: "email",
        consultant: name!,
        workerId: null,
        tsId: null,
        start: a!,
        end: b!,
        status: status as Status,
        approver: "Jordan Ellis",
        approvedAt: addDays(b!, 2),
        notes: status === "SUBMITTED" ? "email that doesn't approve" : "",
      }),
    );
  });
  // Degraded copies (not "clear")
  const degrade = (src: string, variant: Variant, note: string) => {
    const s = out.find((x) => x.name === src)!;
    out.push({ ...s, name: `${src}-${variant}`, variant, clear: variant === "pdf", notes: note });
  };
  degrade("fieldglass-week-1", "phone", "phone photo of a monitor: tilted, soft, darker");
  degrade("beeline-week-1", "phone", "phone photo");
  degrade("calendar-month-3", "phone", "phone photo of a monthly grid");
  degrade("fieldglass-week-5", "phone", "phone photo");
  degrade("fieldglass-week-2", "lowres", "downscaled screenshot");
  degrade("calendar-month-2", "lowres", "downscaled screenshot");
  degrade("fieldglass-week-6", "crop-header", "header cropped off: no name, period or status");
  degrade("beeline-week-3", "crop-total", "total cropped off");
  degrade("fieldglass-week-4", "pdf", "PDF export");
  degrade("calendar-month-5", "pdf", "PDF export");
  return out;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  const manifest: {
    name: string;
    file: string;
    clear: boolean;
    template: Template;
    variant: Variant;
    notes: string;
    /** What production would pass as hints: the timesheet's consultant and period (8.1). */
    hints: { consultantName: string; periodStart: string; periodEnd: string };
  }[] = [];
  for (const s of specs()) {
    const opts = { hideHeader: s.variant === "crop-header", hideTotal: s.variant === "crop-total" };
    const html = s.template === "fieldglass" ? fieldglass(s, opts) : s.template === "beeline" ? beeline(s, opts) : s.template === "calendar" ? calendar(s, opts) : email(s);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#e5e7eb;padding:20px">${html}</body></html>`);
    let file: string;
    if (s.variant === "pdf") {
      file = `${s.name}.pdf`;
      writeFileSync(path.join(OUT, file), await page.pdf({ format: "Letter", landscape: s.template === "fieldglass", printBackground: true }));
    } else {
      const shot = await page.locator("#doc").screenshot({ type: "png" });
      let img = sharp(shot);
      if (s.variant === "phone") {
        img = sharp(
          await sharp(shot)
            .extend({ top: 60, bottom: 60, left: 60, right: 60, background: "#2b2b2b" })
            .rotate(1.8, { background: "#2b2b2b" })
            .blur(1.1)
            .modulate({ brightness: 0.88, saturation: 0.9 })
            .toBuffer(),
        ).jpeg({ quality: 62 });
        file = `${s.name}.jpg`;
      } else if (s.variant === "lowres") {
        const meta = await sharp(shot).metadata();
        img = sharp(await sharp(shot).resize(Math.round(meta.width! * 0.42)).toBuffer()).jpeg({ quality: 55 });
        file = `${s.name}.jpg`;
      } else {
        file = `${s.name}.png`;
      }
      writeFileSync(path.join(OUT, file), await img.toBuffer());
    }
    writeFileSync(path.join(OUT, `${s.name}.expected.json`), JSON.stringify(expected(s), null, 2) + "\n");
    manifest.push({
      name: s.name,
      file,
      clear: s.clear,
      template: s.template,
      variant: s.variant,
      notes: s.notes,
      hints: { consultantName: s.consultant, periodStart: s.start, periodEnd: s.end },
    });
  }
  await browser.close();
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifest.length} fixtures to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
