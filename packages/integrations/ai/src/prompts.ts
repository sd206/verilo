/** Versioned prompts (8.3). Changing the text means a new version; the version is logged on each extraction. */
export const TIMESHEET_PROMPT_VERSION = "ts-v1";

export const TIMESHEET_PROMPT_V1 = `You read images of timesheets exported from vendor management systems (SAP Fieldglass, Beeline, others)
or emails approving timesheets. Extract only what is visible. Do not guess.

Return JSON that matches the schema exactly.
- Dates: ISO format YYYY-MM-DD. If the year is not shown, use the hint period year.
- Hours: decimal numbers (7:30 = 7.5). Do not include breaks if shown separately.
- total_hours: the total shown on the document if visible; otherwise the sum of daily_hours.
- approval_status: APPROVED only if the document explicitly shows an approved state
  (e.g. "Approved", a green approved badge, or an approval email from a client manager).
- If a field is not visible, return null. Set its confidence low.
- Confidence: 0.0–1.0 reflecting how clearly the value is visible.

Hints (may be wrong; never override visible content): {hints_json}`;

export function timesheetPrompt(hints: object, validationErrors: string[] = []): string {
  const base = TIMESHEET_PROMPT_V1.replace("{hints_json}", JSON.stringify(hints));
  if (validationErrors.length === 0) return base;
  return `${base}

Your previous answer did not match the schema. Fix these problems and return the whole JSON again:
${validationErrors.map((e) => `- ${e}`).join("\n")}`;
}
