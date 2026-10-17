import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hammingDistanceHex } from "@verilo/domain";
import { ModelExtractor, ProviderError, type FileRef } from "./extractor";
import { ScriptedClient } from "./fakes";
import { differenceHash, imageSize, toPages } from "./preprocess";
import { TIMESHEET_PROMPT_VERSION } from "./prompts";
import { timesheetExtractionSchema } from "./schema";

const file: FileRef = { fileId: "f", sha256: "s", mimeType: "image/png", pages: [Buffer.from("x")] };

const good = {
  document_type: "VMS_TIMESHEET",
  vms_name: "SAP Fieldglass",
  consultant_name: "Ravi Kumar",
  worker_id: null,
  timesheet_id: "TS-1",
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  daily_hours: [{ date: "2026-10-01", hours: 8, rate_kind: "REGULAR" }],
  total_hours: 168,
  approval_status: "APPROVED",
  approver_name: "Pat",
  approved_at: "2026-11-01",
  confidence: { overall: 0.9, period: 0.9, total_hours: 0.9, daily_hours: 0.9, approval_status: 0.9 },
  notes: null,
};

const extractor = (c: ScriptedClient) => new ModelExtractor(c, { providerRetryDelayMs: 0 });

describe("timesheet extraction schema (8.2)", () => {
  it("accepts a valid result", () => {
    expect(timesheetExtractionSchema.safeParse(good).success).toBe(true);
  });
  it("rejects impossible dates, negative or over-24 daily hours and bad enums", () => {
    expect(timesheetExtractionSchema.safeParse({ ...good, period_start: "2026-02-30" }).success).toBe(false);
    expect(timesheetExtractionSchema.safeParse({ ...good, daily_hours: [{ date: "2026-10-01", hours: 25, rate_kind: "REGULAR" }] }).success).toBe(false);
    expect(timesheetExtractionSchema.safeParse({ ...good, approval_status: "OK" }).success).toBe(false);
    expect(timesheetExtractionSchema.safeParse({ ...good, period_start: "2026-11-01", period_end: "2026-10-01" }).success).toBe(false);
  });
  it("turns empty strings into null", () => {
    expect(timesheetExtractionSchema.parse({ ...good, consultant_name: " " }).consultant_name).toBeNull();
  });
});

describe("ModelExtractor (8.1)", () => {
  it("returns a validated proposal and logs model, prompt version and cost; one billable read", async () => {
    const c = new ScriptedClient().push(good);
    const out = await extractor(c).extractTimesheet(file, { consultantName: "Ravi Kumar" });
    expect(out.ok).toBe(true);
    expect(out.result?.total_hours).toBe(168);
    expect(out.model).toBe("scripted");
    expect(out.promptVersion).toBe(TIMESHEET_PROMPT_VERSION);
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]).toMatchObject({ kind: "OK", billable: true, nonBillableReason: null });
    expect(c.calls[0]!.prompt).toContain('"consultantName":"Ravi Kumar"');
  });

  it("strips a markdown code fence", async () => {
    const out = await extractor(new ScriptedClient().push("```json\n" + JSON.stringify(good) + "\n```")).extractTimesheet(file, {});
    expect(out.ok).toBe(true);
  });

  it("retries once with the validation errors appended; the retry isn't billable", async () => {
    const c = new ScriptedClient().push({ ...good, total_hours: "lots" }, good);
    const out = await extractor(c).extractTimesheet(file, {});
    expect(out.ok).toBe(true);
    expect(c.calls).toHaveLength(2);
    expect(c.calls[1]!.prompt).toMatch(/previous answer did not match/);
    expect(c.calls[1]!.prompt).toContain("total_hours");
    expect(out.attempts.map((a) => [a.kind, a.billable, a.nonBillableReason])).toEqual([
      ["INVALID", true, null],
      ["OK", false, "VALIDATION_RETRY"],
    ]);
  });

  it("fails after the second invalid answer (route to manual entry), keeping both raw answers", async () => {
    const c = new ScriptedClient().push("not json", { nope: 1 });
    const out = await extractor(c).extractTimesheet(file, {});
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/schema/);
    expect(out.attempts.map((a) => a.raw)).toEqual(["not json", '{"nope":1}']);
    expect(c.calls).toHaveLength(2);
  });

  it("retries a provider error once; provider errors are never billable", async () => {
    const c = new ScriptedClient().push(new ProviderError("503"), good);
    const out = await extractor(c).extractTimesheet(file, {});
    expect(out.ok).toBe(true);
    expect(out.attempts.map((a) => [a.kind, a.billable, a.nonBillableReason])).toEqual([
      ["PROVIDER_ERROR", false, "PROVIDER_ERROR"],
      ["OK", true, null],
    ]);
  });

  it("fails after two provider errors", async () => {
    const out = await extractor(new ScriptedClient().push(new Error("down"), new Error("down"))).extractTimesheet(file, {});
    expect(out.ok).toBe(false);
    expect(out.attempts.every((a) => !a.billable)).toBe(true);
  });

  it("vendor invoice and remittance extraction aren't part of M2", async () => {
    await expect(extractor(new ScriptedClient()).extractVendorInvoice()).rejects.toThrow(/M4/);
    await expect(extractor(new ScriptedClient()).extractRemittance()).rejects.toThrow(/M5/);
  });
});

/** A one-page PDF with a filled rectangle, built by hand with a correct xref table. */
function tinyPdf(): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>",
  ];
  const stream = "0 0 1 rg 20 20 260 160 re f";
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  offsets.push(body.length);
  body += `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const xref = body.length;
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("preprocessing (8.1)", () => {
  const png = (w: number, h: number, color = { r: 200, g: 30, b: 30 }) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

  it("normalizes an image to one JPEG page and caps its size", async () => {
    const out = await toPages(await png(4000, 1000), "image/png");
    expect(out.sourcePages).toBe(1);
    const meta = await sharp(out.pages[0]!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2000);
  });

  it("renders PDF pages to images", async () => {
    const out = await toPages(tinyPdf(), "application/pdf");
    expect(out.sourcePages).toBe(1);
    expect(out.pages).toHaveLength(1);
    const meta = await sharp(out.pages[0]!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(900); // 300 pt at the 3× cap
    // The page's blue rectangle was drawn (centre pixel).
    const { data } = await sharp(out.pages[0]!).extract({ left: 450, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(200);
    expect(data[0]).toBeLessThan(60);
  });

  it("rejects bytes that aren't the declared type", async () => {
    await expect(toPages(Buffer.from("hello"), "image/png")).rejects.toThrow();
  });

  it("reads image dimensions", async () => {
    expect(await imageSize(await png(300, 150))).toEqual({ width: 300, height: 150 });
    expect(await imageSize(Buffer.from("x"))).toBeNull();
  });

  it("dHash: identical and re-encoded images are close; different images are far", async () => {
    const gradient = await sharp(
      Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (Math.floor(i / 3) % 64) * 4)),
      { raw: { width: 64, height: 64, channels: 3 } },
    )
      .png()
      .toBuffer();
    const reencoded = await sharp(gradient).jpeg({ quality: 60 }).toBuffer();
    const flipped = await sharp(gradient).flop().png().toBuffer();
    const a = await differenceHash(gradient);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistanceHex(a, await differenceHash(reencoded))).toBeLessThanOrEqual(5);
    expect(hammingDistanceHex(a, await differenceHash(flipped))).toBeGreaterThan(5);
  });
});

describe("fixture set (8.7)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { FIXTURES_DIR } = await import("./index");
  const manifest = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "manifest.json"), "utf8")) as { name: string; file: string; clear: boolean }[];
  it("has at least 30 fixtures, each with a file and a schema-valid expected answer", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(30);
    const files = new Set(readdirSync(FIXTURES_DIR));
    for (const m of manifest) {
      expect(files.has(m.file), m.file).toBe(true);
      const expected = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${m.name}.expected.json`), "utf8"));
      const r = timesheetExtractionSchema.safeParse(expected);
      expect(r.success, `${m.name}: ${r.success ? "" : r.error.issues[0]?.message}`).toBe(true);
    }
    expect(manifest.filter((m) => !m.clear).length).toBeGreaterThan(0);
  });
});
