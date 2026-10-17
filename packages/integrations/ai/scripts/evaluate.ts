/**
 * AI fixture evaluation (8.7). Not run in CI (it costs money). Runs every fixture through the
 * configured extractor and reports:
 *   - total-hours accuracy on clear images (target ≥ 98 %), and on all fixtures
 *   - period, approval, name and daily-hours accuracy
 *   - wrong extractions NOT caught by a BLOCK or WARN check (target: none)
 *
 *   EXTRACTOR=gemini VERTEX_MODEL=gemini-2.5-flash GCP_PROJECT=… VERTEX_LOCATION=… pnpm --filter @verilo/ai eval
 *   EXTRACTOR=fixture pnpm --filter @verilo/ai eval          (dry run: perfect answers)
 *   pnpm --filter @verilo/ai eval -- --only fieldglass        (name filter)  --json report.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  compareHours,
  documentPeriod,
  nameSimilarity,
  runTimesheetChecks,
  type CheckEntry,
  type ExtractedTimesheet,
} from "@verilo/domain";
import { extractorFromEnv, FIXTURES_DIR } from "../src/index";
import { toPages } from "../src/preprocess";

interface ManifestRow {
  name: string;
  file: string;
  clear: boolean;
  template: string;
  variant: string;
  notes: string;
  hints: { consultantName: string; periodStart: string; periodEnd: string };
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf", ".heic": "image/heic" };

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100));

function entriesFrom(truth: ExtractedTimesheet, period: { start: string; end: string }): CheckEntry[] {
  if (truth.daily_hours.length) {
    return truth.daily_hours
      .filter((d) => d.date >= period.start && d.date <= period.end)
      .map((d) => ({ workDate: d.date, hours: Math.round(d.hours * 100), rateKind: d.rate_kind === "OVERTIME" ? ("OVERTIME" as const) : ("REGULAR" as const) }));
  }
  return [{ workDate: period.end, hours: Math.round((truth.total_hours ?? 0) * 100), rateKind: "REGULAR" }];
}

async function main() {
  const manifest = (JSON.parse(readFileSync(path.join(FIXTURES_DIR, "manifest.json"), "utf8")) as ManifestRow[]).filter(
    (m) => !only || m.name.includes(only),
  );
  const extractor = extractorFromEnv();
  console.log(`Evaluating ${manifest.length} fixtures with model "${extractor.model}"\n`);

  const rows: Record<string, unknown>[] = [];
  let costCents = 0;
  for (const m of manifest) {
    const bytes = readFileSync(path.join(FIXTURES_DIR, m.file));
    const truth = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${m.name}.expected.json`), "utf8")) as ExtractedTimesheet;
    const mimeType = MIME[path.extname(m.file).toLowerCase()]!;
    const { pages } = await toPages(bytes, mimeType);
    const started = Date.now();
    const out = await extractor.extractTimesheet(
      { fileId: m.name, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType, pages },
      m.hints,
    );
    costCents += out.costCents;
    const x = out.result;
    const period = { start: m.hints.periodStart, end: m.hints.periodEnd };
    const row: Record<string, unknown> = { name: m.name, clear: m.clear, ms: Date.now() - started, attempts: out.attempts.length, valid: out.ok };
    if (!x) {
      // A failed read is "caught": it routes to manual entry (EXTRACTION_PENDING blocks).
      rows.push({ ...row, total: false, period: false, approval: false, nameMatch: false, daily: false, wrong: true, caught: true, error: out.error });
      continue;
    }
    const tp = documentPeriod(truth);
    const xp = documentPeriod(x);
    const totalOk = round2(x.total_hours) === round2(truth.total_hours);
    const periodOk = (tp === null && xp === null) || (!!tp && !!xp && tp.start === xp.start && tp.end === xp.end);
    const approvalOk = x.approval_status === truth.approval_status;
    const nameOk =
      (truth.consultant_name === null && x.consultant_name === null) ||
      (!!truth.consultant_name && !!x.consultant_name && nameSimilarity(truth.consultant_name, x.consultant_name) >= 0.8);
    const cmp = compareHours(period, entriesFrom(truth, period), [x]);
    const dailyOk = truth.daily_hours.length === 0 ? true : cmp.hasDaily && !cmp.days.some((d) => d.differs);
    const wrong = !totalOk || !periodOk || !approvalOk || !nameOk || !dailyOk;
    // Would the checks stop it? Entered hours = the truth; evidence = this extraction.
    const checks = runTimesheetChecks({
      period,
      entries: entriesFrom(truth, period),
      engagement: { startDate: "2020-01-01", endDate: null, evidenceRequired: true, maxWeeklyHoursWarning: 8000, employmentType: "W2" },
      weekStart: "MON",
      consultantName: m.hints.consultantName,
      evidence: [{ evidenceId: "e", fileId: "f", sha256: null, perceptualHash: null, extraction: { status: "DONE", result: x } }],
      otherEvidence: [],
      rates: [
        { id: "r", side: "BILL", rateKind: "REGULAR", rateCents: 10000, effectiveFrom: "2020-01-01", effectiveTo: null },
        { id: "o", side: "BILL", rateKind: "OVERTIME", rateCents: 15000, effectiveFrom: "2020-01-01", effectiveTo: null },
      ],
      holidays: [],
      purchaseOrder: null,
    });
    const flagged = checks.filter((c) => c.severity !== "INFO").map((c) => c.code);
    rows.push({
      ...row,
      total: totalOk,
      period: periodOk,
      approval: approvalOk,
      nameMatch: nameOk,
      daily: dailyOk,
      wrong,
      caught: !wrong || flagged.length > 0,
      flagged,
      got: { total: x.total_hours, period: xp, approval: x.approval_status, name: x.consultant_name, confidence: x.confidence.overall },
      want: { total: truth.total_hours, period: tp, approval: truth.approval_status, name: truth.consultant_name },
    });
  }

  const pct = (xs: Record<string, unknown>[], k: string) => (xs.length ? (100 * xs.filter((r) => r[k] === true).length) / xs.length : 0);
  const clear = rows.filter((r) => r.clear);
  const uncaught = rows.filter((r) => r.wrong && !r.caught);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("fixture", 34)} valid total period approval name  daily  caught`);
  for (const r of rows) {
    const b = (k: string) => pad(r[k] ? "✓" : "✗", 6);
    console.log(`${pad(String(r.name), 34)} ${b("valid")}${b("total")}${b("period")}${pad(r.approval ? "✓" : "✗", 9)}${b("nameMatch")}${b("daily")}${r.wrong ? (r.caught ? "yes" : "NO") : "-"}`);
  }
  const summary = {
    model: extractor.model,
    fixtures: rows.length,
    clearFixtures: clear.length,
    totalHoursAccuracyClear: pct(clear, "total"),
    totalHoursAccuracyAll: pct(rows, "total"),
    periodAccuracy: pct(rows, "period"),
    approvalAccuracy: pct(rows, "approval"),
    nameAccuracy: pct(rows, "nameMatch"),
    dailyAccuracy: pct(rows, "daily"),
    wrongExtractions: rows.filter((r) => r.wrong).length,
    uncaughtWrongExtractions: uncaught.map((r) => r.name),
    providerCostCents: costCents,
    targets: { totalHoursAccuracyClear: ">= 98", uncaughtWrongExtractions: "none" },
  };
  console.log(`
Total-hours accuracy, clear images: ${summary.totalHoursAccuracyClear.toFixed(1)}% (${clear.length} fixtures; target ≥ 98%)
Total-hours accuracy, all:          ${summary.totalHoursAccuracyAll.toFixed(1)}%
Period ${summary.periodAccuracy.toFixed(1)}% · approval ${summary.approvalAccuracy.toFixed(1)}% · name ${summary.nameAccuracy.toFixed(1)}% · daily ${summary.dailyAccuracy.toFixed(1)}%
Wrong extractions: ${summary.wrongExtractions}; not caught by a BLOCK/WARN check: ${uncaught.length ? uncaught.map((r) => r.name).join(", ") : "none"}
Provider cost: $${(costCents / 100).toFixed(2)}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, rows }, null, 2));
  const pass = summary.totalHoursAccuracyClear >= 98 && uncaught.length === 0;
  console.log(pass ? "\nPASS" : "\nBELOW TARGET");
  process.exit(pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
