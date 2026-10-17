/** Section 7.4 — invoice number formatting (no sequence allocation in M1). */
import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, previewInvoiceNumber, validateNumberPattern } from "./invoice-number";

describe("validateNumberPattern", () => {
  it("accepts the default pattern", () => {
    expect(validateNumberPattern("{CLIENT}-{YYYY}{MM}-{SEQ:4}")).toEqual({ ok: true });
  });
  it("requires {SEQ:n}", () => {
    expect(validateNumberPattern("{CLIENT}-{YYYY}{MM}")).toMatchObject({ ok: false, code: "MISSING_SEQ" });
    expect(validateNumberPattern("{CLIENT}-{SEQ}")).toMatchObject({ ok: false, code: "MISSING_SEQ" });
  });
  it("allows {SEQ:n} only once and n between 1 and 9", () => {
    expect(validateNumberPattern("{SEQ:3}-{SEQ:3}")).toMatchObject({ ok: false, code: "DUPLICATE_SEQ" });
    expect(validateNumberPattern("INV-{SEQ:0}")).toMatchObject({ ok: false, code: "MISSING_SEQ" });
    expect(validateNumberPattern("INV-{SEQ:10}")).toMatchObject({ ok: false, code: "MISSING_SEQ" });
  });
  it("rejects patterns that can't produce a number of 30 characters or fewer", () => {
    expect(validateNumberPattern("A-VERY-LONG-PREFIX-FOR-INVOICES-{SEQ:4}")).toMatchObject({ ok: false, code: "TOO_LONG" });
  });
  it("rejects empty and whitespace-only patterns", () => {
    expect(validateNumberPattern("")).toMatchObject({ ok: false });
    expect(validateNumberPattern("  {SEQ:4}")).toMatchObject({ ok: false, code: "WHITESPACE" });
  });
});

describe("formatInvoiceNumber", () => {
  it("formats the seed pattern (M1 acceptance: GLBX-202611-0001)", () => {
    expect(
      formatInvoiceNumber("{CLIENT}-{YYYY}{MM}-{SEQ:4}", { clientCode: "GLBX", invoiceDate: "2026-11-01", seq: 1 }),
    ).toEqual({ ok: true, number: "GLBX-202611-0001" });
  });
  it("supports {YY}, literal text and wider sequences", () => {
    expect(formatInvoiceNumber("INV/{YY}/{SEQ:6}", { clientCode: null, invoiceDate: "2027-01-31", seq: 42 })).toEqual({
      ok: true,
      number: "INV/27/000042",
    });
  });
  it("keeps all digits when the sequence outgrows its padding", () => {
    expect(formatInvoiceNumber("{SEQ:2}", { clientCode: null, invoiceDate: "2026-01-01", seq: 123 })).toEqual({ ok: true, number: "123" });
  });
  it("treats unknown {TOKENS} as literal text (section 7.4: any other text is literal)", () => {
    expect(formatInvoiceNumber("{FOO}-{SEQ:1}", { clientCode: null, invoiceDate: "2026-01-01", seq: 7 })).toEqual({ ok: true, number: "{FOO}-7" });
  });
  it("needs a client code when the pattern uses {CLIENT}", () => {
    expect(formatInvoiceNumber("{CLIENT}-{SEQ:4}", { clientCode: null, invoiceDate: "2026-01-01", seq: 1 })).toMatchObject({
      ok: false,
      code: "MISSING_CLIENT_CODE",
    });
  });
  it("rejects a generated number longer than 30 characters", () => {
    expect(
      formatInvoiceNumber("{CLIENT}-{YYYY}{MM}-{SEQ:9}", { clientCode: "ABCDEFGHIJKLMNOPQRST", invoiceDate: "2026-01-01", seq: 1 }),
    ).toMatchObject({ ok: false, code: "TOO_LONG" });
  });
  it("rejects a bad sequence or date", () => {
    expect(formatInvoiceNumber("{SEQ:4}", { clientCode: null, invoiceDate: "2026-01-01", seq: 0 })).toMatchObject({ ok: false });
    expect(formatInvoiceNumber("{SEQ:4}", { clientCode: null, invoiceDate: "2026-13-01", seq: 1 })).toMatchObject({ ok: false });
  });
});

describe("previewInvoiceNumber", () => {
  it("shows the first number for a client and date", () => {
    expect(previewInvoiceNumber("{CLIENT}-{YYYY}{MM}-{SEQ:4}", "GLBX", "2026-11-01")).toEqual({ ok: true, number: "GLBX-202611-0001" });
  });
  it("reports pattern errors before formatting", () => {
    expect(previewInvoiceNumber("{CLIENT}", "GLBX", "2026-11-01")).toMatchObject({ ok: false, code: "MISSING_SEQ" });
  });
});
