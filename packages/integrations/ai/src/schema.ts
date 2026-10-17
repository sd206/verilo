/** Extraction output schemas (8.2, 8.4, 8.5). The model's JSON is validated against these (8.1). */
import { z } from "zod";
import { isIsoDate, type ExtractedTimesheet } from "@verilo/domain";

const isoDate = z.string().refine(isIsoDate, "must be a real date in YYYY-MM-DD form");
const conf = z.number().min(0).max(1);
const nstr = z.string().trim().min(1).nullable().catch(null);

export const timesheetExtractionSchema = z
  .object({
    document_type: z.enum(["VMS_TIMESHEET", "EMAIL_APPROVAL", "OTHER"]),
    vms_name: nstr,
    consultant_name: nstr,
    worker_id: nstr,
    timesheet_id: nstr,
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    daily_hours: z.array(
      z.object({
        date: isoDate,
        hours: z.number().min(0).max(24),
        rate_kind: z.enum(["REGULAR", "OVERTIME", "UNKNOWN"]),
      }),
    ),
    total_hours: z.number().min(0).max(744).nullable(),
    approval_status: z.enum(["APPROVED", "SUBMITTED", "REJECTED", "DRAFT", "UNKNOWN"]),
    approver_name: nstr,
    approved_at: isoDate.nullable(),
    confidence: z.object({
      overall: conf,
      period: conf,
      total_hours: conf,
      daily_hours: conf,
      approval_status: conf,
    }),
    notes: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.period_start && v.period_end && v.period_start > v.period_end) {
      ctx.addIssue({ code: "custom", path: ["period_end"], message: "period_end is before period_start" });
    }
  });

// Compile-time check that the validated shape is what the domain checks consume.
type Validated = z.infer<typeof timesheetExtractionSchema>;
const _sameShape: (v: Validated) => ExtractedTimesheet = (v) => v;
void _sameShape;

const money = z.number().min(0);

export const vendorInvoiceExtractionSchema = z.object({
  vendor_name: nstr,
  invoice_number: nstr,
  invoice_date: isoDate.nullable(),
  bill_to_name: nstr,
  lines: z.array(
    z.object({
      consultant_name: nstr,
      service_start: isoDate.nullable(),
      service_end: isoDate.nullable(),
      hours: z.number().min(0),
      rate: money,
      amount: money,
      description: z.string().nullable(),
    }),
  ),
  subtotal: money,
  total: money,
  currency: z.string(),
  confidence: z.object({ overall: conf, lines: conf, total: conf }),
});

export const remittanceExtractionSchema = z.object({
  payer_name: nstr,
  payment_date: isoDate.nullable(),
  payment_reference: nstr,
  payment_amount: money,
  items: z.array(
    z.object({ invoice_number: nstr, amount_paid: money, deduction: money, deduction_label: z.string().nullable() }),
  ),
  confidence: z.object({ overall: conf }),
});

export type TimesheetExtractionResult = Validated;
export type VendorInvoiceExtractionResult = z.infer<typeof vendorInvoiceExtractionSchema>;
export type RemittanceExtractionResult = z.infer<typeof remittanceExtractionSchema>;

/** JSON Schema handed to the model for structured output. */
export function timesheetJsonSchema(): unknown {
  return z.toJSONSchema(timesheetExtractionSchema, { io: "input", unrepresentable: "any" });
}

/** "Field: message" lines appended to the retry prompt (8.1). */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
