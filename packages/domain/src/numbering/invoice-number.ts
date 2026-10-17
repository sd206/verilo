import { isIsoDate, type IsoDate } from "../dates";

/** Section 7.4. Formatting only; sequence allocation arrives with invoicing (M3). */
export const MAX_INVOICE_NUMBER_LENGTH = 30;

type Token =
  | { kind: "literal"; text: string }
  | { kind: "CLIENT" | "YYYY" | "YY" | "MM" }
  | { kind: "SEQ"; width: number };

const TOKEN_RE = /\{(CLIENT|YYYY|YY|MM|SEQ:([1-9]))\}/g;

export function parseNumberPattern(pattern: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of pattern.matchAll(TOKEN_RE)) {
    if (m.index! > last) tokens.push({ kind: "literal", text: pattern.slice(last, m.index) });
    if (m[2]) tokens.push({ kind: "SEQ", width: Number(m[2]) });
    else tokens.push({ kind: m[1] as "CLIENT" | "YYYY" | "YY" | "MM" });
    last = m.index! + m[0].length;
  }
  if (last < pattern.length) tokens.push({ kind: "literal", text: pattern.slice(last) });
  return tokens;
}

export type PatternCheck =
  | { ok: true }
  | { ok: false; code: "EMPTY" | "WHITESPACE" | "MISSING_SEQ" | "DUPLICATE_SEQ" | "TOO_LONG"; message: string };

/** Longest code allowed for a party (party.code). Used to bound the worst-case number length. */
export const MAX_CLIENT_CODE_LENGTH = 10;

export function validateNumberPattern(pattern: string): PatternCheck {
  if (pattern.length === 0) return { ok: false, code: "EMPTY", message: "Enter a pattern" };
  if (/\s/.test(pattern)) return { ok: false, code: "WHITESPACE", message: "Invoice numbers can't contain spaces" };
  const tokens = parseNumberPattern(pattern);
  const seqs = tokens.filter((t) => t.kind === "SEQ");
  if (seqs.length === 0) return { ok: false, code: "MISSING_SEQ", message: "The pattern must contain {SEQ:n} with n from 1 to 9" };
  if (seqs.length > 1) return { ok: false, code: "DUPLICATE_SEQ", message: "Use {SEQ:n} only once" };
  // Worst case with a maximum-length client code and the sequence at its padded width.
  const worst = tokens.reduce((n, t) => {
    switch (t.kind) {
      case "literal":
        return n + t.text.length;
      case "CLIENT":
        return n + MAX_CLIENT_CODE_LENGTH;
      case "YYYY":
        return n + 4;
      case "YY":
      case "MM":
        return n + 2;
      case "SEQ":
        return n + t.width;
    }
  }, 0);
  if (worst > MAX_INVOICE_NUMBER_LENGTH) {
    return { ok: false, code: "TOO_LONG", message: `Numbers from this pattern can exceed ${MAX_INVOICE_NUMBER_LENGTH} characters` };
  }
  return { ok: true };
}

export type FormatResult =
  | { ok: true; number: string }
  | { ok: false; code: "MISSING_CLIENT_CODE" | "TOO_LONG" | "INVALID_INPUT"; message: string };

export function formatInvoiceNumber(
  pattern: string,
  input: { clientCode: string | null; invoiceDate: IsoDate; seq: number },
): FormatResult {
  if (!isIsoDate(input.invoiceDate)) return { ok: false, code: "INVALID_INPUT", message: "Invalid invoice date" };
  if (!Number.isSafeInteger(input.seq) || input.seq < 1) return { ok: false, code: "INVALID_INPUT", message: "Invalid sequence" };
  const [yyyy, mm] = input.invoiceDate.split("-") as [string, string];
  let out = "";
  for (const t of parseNumberPattern(pattern)) {
    switch (t.kind) {
      case "literal":
        out += t.text;
        break;
      case "CLIENT":
        if (!input.clientCode) return { ok: false, code: "MISSING_CLIENT_CODE", message: "The bill-to party has no code" };
        out += input.clientCode;
        break;
      case "YYYY":
        out += yyyy;
        break;
      case "YY":
        out += yyyy.slice(2);
        break;
      case "MM":
        out += mm;
        break;
      case "SEQ":
        out += String(input.seq).padStart(t.width, "0");
        break;
    }
  }
  if (out.length > MAX_INVOICE_NUMBER_LENGTH) {
    return { ok: false, code: "TOO_LONG", message: `"${out}" is longer than ${MAX_INVOICE_NUMBER_LENGTH} characters` };
  }
  return { ok: true, number: out };
}

/** previewInvoiceNumber (section 16): the first number a pattern would produce. */
export function previewInvoiceNumber(
  pattern: string,
  clientCode: string | null,
  invoiceDate: IsoDate,
): FormatResult | Extract<PatternCheck, { ok: false }> {
  const check = validateNumberPattern(pattern);
  if (!check.ok) return check;
  return formatInvoiceNumber(pattern, { clientCode, invoiceDate, seq: 1 });
}
