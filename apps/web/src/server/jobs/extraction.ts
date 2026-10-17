/**
 * run_extraction (8.1, section 14). Claims a QUEUED extraction, renders the file to page images,
 * asks the provider, stores the raw response and the validated proposal, records AI usage
 * (22.4), then hands the proposal to matching and the checks. Idempotent: a finished extraction
 * is never redone, and two workers can't claim the same row (R7).
 */
import type { Readable } from "node:stream";
import {
  getConsultant,
  getEngagement,
  getEvidenceByExtraction,
  getExtraction,
  getFile,
  getFirm,
  getTimesheet,
  setExtractionStatus,
  setPerceptualHash,
  withFirm,
  type ExtractionRow,
} from "@verilo/db";
import { extractionStatusMachine } from "@verilo/domain";
import { differenceHash, toPages, type Attempt, type ExtractionOutcome, type TimesheetExtractionResult } from "@verilo/ai";
import type { JobPayloads } from "@verilo/jobs";
import type { Deps } from "../deps";
import { audit, derivedPageKey, matchUnlinkedEvidence, recordUsage, settleInboundEmail, type Actor } from "../timesheets/service";

/** A RUNNING extraction older than this belongs to a crashed worker and may be reclaimed. */
const STALE_MS = 10 * 60_000;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

const rawAttempts = (attempts: Attempt[]) =>
  attempts.map((a) => ({ kind: a.kind, raw: a.raw, errors: a.errors, inputTokens: a.inputTokens, outputTokens: a.outputTokens, costMicros: a.costMicros }));

export async function runExtractionJob(d: Deps, { firmId, extractionId }: JobPayloads["run_extraction"]): Promise<void> {
  const system: Actor = { firmId, userId: null, role: null };

  // 1. Claim (compare-and-set QUEUED → RUNNING, or reclaim a stale RUNNING row).
  const claimed = await withFirm(d.db, firmId, async (tx) => {
    const x = await getExtraction(tx, firmId, extractionId);
    if (!x) return null;
    let from: ExtractionRow["status"] = x.status;
    if (x.status === "RUNNING" && Date.now() - x.updatedAt.getTime() > STALE_MS) {
      extractionStatusMachine.transition("RUNNING", "QUEUED");
      if (!(await setExtractionStatus(tx, firmId, x.id, "RUNNING", "QUEUED"))) return null;
      from = "QUEUED";
    }
    if (from !== "QUEUED") return null;
    const next = extractionStatusMachine.transition("QUEUED", "RUNNING");
    const row = await setExtractionStatus(tx, firmId, x.id, "QUEUED", next, { model: d.extractor.model });
    if (!row) return null;
    const file = (await getFile(tx, firmId, x.fileId))!;
    const firm = (await getFirm(tx, firmId))!;
    // Hints from the timesheet the evidence is on (8.1: may be wrong; never override the image).
    const ev = (await getEvidenceByExtraction(tx, firmId, x.id))[0];
    const ts = ev?.timesheetId ? await getTimesheet(tx, firmId, ev.timesheetId) : null;
    const eng = ts ? await getEngagement(tx, firmId, ts.engagementId) : null;
    const c = eng ? await getConsultant(tx, firmId, eng.consultantId) : ev?.consultantId ? await getConsultant(tx, firmId, ev.consultantId) : null;
    return {
      file,
      firm,
      hints: {
        ...(c ? { consultantName: `${c.firstName} ${c.lastName}` } : {}),
        ...(ts ? { periodStart: ts.periodStart, periodEnd: ts.periodEnd } : {}),
      },
    };
  });
  if (!claimed) return;
  const { file, firm, hints } = claimed;

  // 2. Preprocess. A file we can't open is a system error: FAILED, not billable.
  let pages: Buffer[] = [];
  let sourcePages = 0;
  let phash: string | null = null;
  let outcome: ExtractionOutcome<TimesheetExtractionResult> | null = null;
  let error: string | null = null;
  try {
    if (file.scanStatus !== "CLEAN") throw new Error("File isn't clean");
    const bytes = await readAll(await d.storage.getStream(file.storageKey));
    const r = await toPages(bytes, file.mimeType);
    pages = r.pages;
    sourcePages = r.sourcePages;
    phash = await differenceHash(pages[0]!);
    for (let i = 0; i < pages.length; i++) await d.storage.put(derivedPageKey(firmId, file.id, i), pages[i]!, "image/jpeg");
  } catch (e) {
    d.log.warn({ err: e, firm_id: firmId, extraction_id: extractionId }, "couldn't open file for extraction");
    error = "We couldn't open this file. Enter the hours by hand.";
  }

  // 3. Ask the provider (outside any transaction).
  if (!error) {
    outcome = await d.extractor.extractTimesheet({ fileId: file.id, sha256: file.sha256, mimeType: file.mimeType, pages }, hints);
    if (!outcome.ok) error = outcome.error;
  }

  // 4. Store, record usage, then match and check.
  const jobs = await withFirm(d.db, firmId, async (tx) => {
    const to = extractionStatusMachine.transition("RUNNING", outcome?.ok ? "DONE" : "FAILED");
    const row = await setExtractionStatus(tx, firmId, extractionId, "RUNNING", to, {
      model: outcome?.model ?? d.extractor.model,
      promptVersion: outcome?.promptVersion ?? null,
      rawJson: { fileId: file.id, pages: pages.length, sourcePages, attempts: outcome ? rawAttempts(outcome.attempts) : [] },
      resultJson: outcome?.result ?? null,
      overallConfidence: outcome?.result ? outcome.result.confidence.overall.toFixed(2) : null,
      error,
      costCents: outcome?.costCents ?? 0,
    });
    if (!row) return [];
    if (phash) await setPerceptualHash(tx, firmId, file.id, phash);
    if (outcome) {
      for (const a of outcome.attempts) {
        await recordUsage(tx, firm, {
          extractionId,
          fileId: file.id,
          pages: pages.length,
          billable: a.billable,
          reason: a.nonBillableReason,
          costCents: Math.round(a.costMicros / 10_000),
        });
      }
    } else {
      await recordUsage(tx, firm, { extractionId, fileId: file.id, pages: 0, billable: false, reason: "PROVIDER_ERROR", costCents: null });
    }
    await audit(tx, system, "extraction", extractionId, "status_change", { status: "RUNNING" }, {
      status: to,
      model: row.model,
      promptVersion: row.promptVersion,
      costCents: row.costCents,
      error,
    });

    const followUps: { timesheetId: string }[] = [];
    for (const ev of await getEvidenceByExtraction(tx, firmId, extractionId)) {
      if (ev.timesheetId) {
        followUps.push({ timesheetId: ev.timesheetId });
        continue;
      }
      const m = await matchUnlinkedEvidence(tx, system, ev);
      if (ev.inboundEmailId) await settleInboundEmail(tx, system, ev.inboundEmailId, m.linked ? null : m.reason);
    }
    return followUps;
  });
  for (const f of jobs) {
    await d.jobs.send("run_timesheet_checks", { firmId, timesheetId: f.timesheetId }, { singletonKey: `${f.timesheetId}:${extractionId}` });
  }
}
