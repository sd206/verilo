/**
 * Extractor interface (8.1) and the validate-and-retry engine shared by every provider.
 * Results are proposals: nothing here touches the database.
 */
import type { z } from "zod";
import { timesheetPrompt, TIMESHEET_PROMPT_VERSION } from "./prompts";
import {
  describeIssues,
  timesheetExtractionSchema,
  timesheetJsonSchema,
  type RemittanceExtractionResult,
  type TimesheetExtractionResult,
  type VendorInvoiceExtractionResult,
} from "./schema";

export interface FileRef {
  fileId: string;
  /** sha256 of the original upload. */
  sha256: string | null;
  mimeType: string;
  /** Normalized JPEG page images (8.1: HEIC converted, PDF pages rendered, at most 10). */
  pages: Buffer[];
}

export interface TimesheetHints {
  consultantName?: string;
  periodStart?: string;
  periodEnd?: string;
}

export type AttemptKind = "OK" | "INVALID" | "PROVIDER_ERROR";

export interface Attempt {
  kind: AttemptKind;
  /** The model's raw text (stored as raw_json, 8.1). */
  raw: string | null;
  errors: string[];
  inputTokens: number;
  outputTokens: number;
  /** Provider cost in millionths of a dollar. */
  costMicros: number;
  /** Did this attempt count as an AI read (22.4)? */
  billable: boolean;
  nonBillableReason: "VALIDATION_RETRY" | "PROVIDER_ERROR" | null;
}

export interface ExtractionOutcome<T> {
  ok: boolean;
  result: T | null;
  error: string | null;
  model: string;
  promptVersion: string;
  attempts: Attempt[];
  costCents: number;
}

export interface Extractor {
  readonly model: string;
  extractTimesheet(file: FileRef, hints: TimesheetHints): Promise<ExtractionOutcome<TimesheetExtractionResult>>;
  extractVendorInvoice(file: FileRef, hints: { vendorName?: string }): Promise<ExtractionOutcome<VendorInvoiceExtractionResult>>;
  extractRemittance(file: FileRef, hints: { payerName?: string }): Promise<ExtractionOutcome<RemittanceExtractionResult>>;
}

/** One model call: prompt + page images → JSON text. Providers implement this. */
export interface ModelClient {
  readonly model: string;
  generate(req: { file: FileRef; prompt: string; jsonSchema: unknown }): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
  }>;
}

export class ProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export class NotImplementedExtraction extends Error {}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, error: `not valid JSON (${(e as Error).message})` };
  }
}

/**
 * 8.1: validate with Zod; on a validation failure retry once with the errors appended; then FAILED.
 * A provider error is retried once as well; provider-error attempts never count as reads (22.4).
 */
export async function runExtraction<T>(
  client: ModelClient,
  file: FileRef,
  schema: z.ZodType<T>,
  jsonSchema: unknown,
  prompt: (errors: string[]) => string,
  promptVersion: string,
  opts: { providerRetryDelayMs?: number } = {},
): Promise<ExtractionOutcome<T>> {
  const attempts: Attempt[] = [];
  let validationErrors: string[] = [];
  let validationRetried = false;
  let providerRetried = false;
  let billed = false;

  for (;;) {
    let res: Awaited<ReturnType<ModelClient["generate"]>>;
    try {
      res = await client.generate({ file, prompt: prompt(validationErrors), jsonSchema });
    } catch (e) {
      attempts.push({
        kind: "PROVIDER_ERROR",
        raw: null,
        errors: [String((e as Error)?.message ?? e)],
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        billable: false,
        nonBillableReason: "PROVIDER_ERROR",
      });
      if (!providerRetried) {
        providerRetried = true;
        await new Promise((r) => setTimeout(r, opts.providerRetryDelayMs ?? 2000));
        continue;
      }
      return finish<T>(client, promptVersion, attempts, null, "The AI provider couldn't read the file. Enter the hours by hand.");
    }

    const isRetry = validationRetried;
    const billable = !billed && !isRetry;
    if (billable) billed = true;
    const base = {
      raw: res.text,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costMicros: res.costMicros,
      billable,
      nonBillableReason: billable ? null : ("VALIDATION_RETRY" as const),
    };
    const parsed = parseJson(res.text);
    const checked = parsed.ok ? schema.safeParse(parsed.value) : null;
    if (checked?.success) {
      attempts.push({ ...base, kind: "OK", errors: [] });
      return finish(client, promptVersion, attempts, checked.data, null);
    }
    const errors = parsed.ok ? describeIssues(checked!.error) : [parsed.error];
    attempts.push({ ...base, kind: "INVALID", errors });
    if (validationRetried) {
      return finish<T>(client, promptVersion, attempts, null, `The AI output didn't match the schema: ${errors.slice(0, 5).join("; ")}`);
    }
    validationRetried = true;
    validationErrors = errors;
  }
}

function finish<T>(client: ModelClient, promptVersion: string, attempts: Attempt[], result: T | null, error: string | null): ExtractionOutcome<T> {
  const micros = attempts.reduce((s, a) => s + a.costMicros, 0);
  return {
    ok: result !== null,
    result,
    error,
    model: client.model,
    promptVersion,
    attempts,
    costCents: Math.round(micros / 10_000),
  };
}

/** An Extractor over any ModelClient. Vendor invoices (M4) and remittances (M5) get prompts later. */
export class ModelExtractor implements Extractor {
  constructor(
    private readonly client: ModelClient,
    private readonly opts: { providerRetryDelayMs?: number } = {},
  ) {}

  get model() {
    return this.client.model;
  }

  extractTimesheet(file: FileRef, hints: TimesheetHints) {
    return runExtraction(
      this.client,
      file,
      timesheetExtractionSchema,
      timesheetJsonSchema(),
      (errors) => timesheetPrompt(hints, errors),
      TIMESHEET_PROMPT_VERSION,
      this.opts,
    );
  }

  async extractVendorInvoice(): Promise<ExtractionOutcome<VendorInvoiceExtractionResult>> {
    throw new NotImplementedExtraction("Vendor invoice extraction arrives with vendor bills (M4)");
  }

  async extractRemittance(): Promise<ExtractionOutcome<RemittanceExtractionResult>> {
    throw new NotImplementedExtraction("Remittance extraction arrives with receipts (M5)");
  }
}
