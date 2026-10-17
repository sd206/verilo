/**
 * M1 main flow (R9) through the UI: parties with a document, a contractor, an engagement with
 * its billing chain, rates (overlap rejected), PO and margin preview; the numbering preview.
 * Acceptance values: margin $20.00/h, 21.05%; preview GLBX-202611-0001.
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpFirm, unique } from "../helpers";

async function createParty(page: Page, fields: { kind: string; legalName: string; code?: string; terms?: string; deduction?: string; vendorTerms?: string }) {
  await page.goto("/app/parties/new");
  await page.getByLabel("Kind").selectOption(fields.kind);
  await page.getByLabel("Legal name").fill(fields.legalName);
  await page.getByLabel("Display name").fill(fields.legalName);
  if (fields.code) await page.getByLabel("Code").fill(fields.code);
  if (fields.terms) await page.getByLabel("Payment terms (days)").fill(fields.terms);
  if (fields.deduction) await page.getByLabel("Standard deduction (%)").fill(fields.deduction);
  if (fields.vendorTerms) await page.getByLabel("Vendor pay terms").selectOption(fields.vendorTerms);
  await page.getByRole("button", { name: "Create party" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fields.legalName);
  return page.url().split("/").pop()!;
}

test("M1: parties, consultant, engagement with rates and margin, numbering preview", async ({ page }) => {
  await signUpFirm(page, { firm: "Lonestar E2E", name: "Lee Admin", email: unique("m1-admin") });

  await createParty(page, { kind: "PRIME_VENDOR", legalName: "Globex Solutions", code: "GLBX", terms: "45", deduction: "2" });
  await createParty(page, { kind: "END_CLIENT", legalName: "Initech Corp" });
  await createParty(page, { kind: "SUB_VENDOR", legalName: "Apex Talent Inc", vendorTerms: "PAY_WHEN_PAID" });

  // Apex: upload a W-9 (signed upload + virus scan), shown as valid.
  await page.getByLabel("Type").selectOption("W9");
  await page.getByLabel("Expires").fill("2027-12-31");
  await page.getByTestId("doc-file").setInputFiles({ name: "apex-w9.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 W-9") });
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByTestId("documents-table")).toContainText("apex-w9.pdf", { timeout: 60_000 });
  await expect(page.getByTestId("documents-table").locator('[data-status="VALID"]')).toBeVisible();

  // Parties list: filter by kind, CSV export available.
  await page.goto("/app/parties");
  await page.getByLabel("Kinds").selectOption("SUB_VENDOR");
  await expect(page.getByTestId("parties-table").locator("tbody tr")).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("parties.csv");

  // Consultant (contractor via Apex).
  await page.goto("/app/consultants/new");
  await page.getByLabel("First name").fill("Ravi");
  await page.getByLabel("Last name").fill("Kumar");
  await page.getByLabel("Employment").selectOption("CONTRACTOR");
  await page.getByLabel("Sub-vendor").selectOption({ label: "Apex Talent Inc" });
  await page.getByLabel("Emails").fill(unique("ravi"));
  await page.getByRole("button", { name: "Create consultant" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ravi Kumar");

  // Engagement E1.
  await page.getByRole("link", { name: "New engagement" }).click();
  await page.getByLabel("Bill-to").selectOption({ label: "Globex Solutions (Prime vendor)" });
  await page.getByLabel("End client").selectOption({ label: "Initech Corp" });
  await page.getByLabel("Prime vendor").selectOption({ label: "Globex Solutions" });
  await page.getByLabel("Role title").fill("SAP Analyst");
  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByRole("button", { name: "Create engagement" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SAP Analyst");

  const chain = page.getByTestId("billing-chain");
  await expect(chain.locator('[data-role="END_CLIENT"]')).toContainText("Initech Corp");
  await expect(chain.locator('[data-role="PRIME_VENDOR"]')).toContainText("Bill-to");
  await expect(chain.locator('[data-role="SUB_VENDOR"]')).toContainText("Apex Talent Inc");
  await expect(chain.locator('[data-role="CONSULTANT"]')).toContainText("Ravi Kumar");

  // Rates: bill $95, pay $75 → margin $20.00/h, 21.05%.
  const addRate = async (side: string, rate: string, from: string) => {
    await page.getByLabel("Side").selectOption(side);
    await page.getByLabel("Rate per hour").fill(rate);
    await page.getByLabel("Effective from").fill(from);
    await page.getByRole("button", { name: "Add rate" }).click();
  };
  await addRate("BILL", "95.00", "2026-09-01");
  await expect(page.getByTestId("rate-row").first()).toContainText("$95.00");
  await addRate("PAY", "75.00", "2026-09-01");
  await expect(page.getByTestId("rate-row")).toHaveCount(2);
  const margin = page.getByTestId("margin-preview");
  await expect(margin).toContainText("$20.00/h");
  await expect(margin).toContainText("21.05%");

  // Overlapping bill rate is rejected.
  await addRate("BILL", "100.00", "2026-11-01");
  await expect(page.getByTestId("rate-error")).toContainText("Overlaps");
  await expect(page.getByTestId("rate-row")).toHaveCount(2);

  // PO and activation (both confirmed).
  await page.getByLabel("PO number").fill("GLX-WO-7781");
  await page.getByLabel("Amount").fill("60000.00");
  await page.getByRole("button", { name: "Add PO" }).click();
  await expect(page.getByTestId("po")).toContainText("$60,000.00");
  await page.getByRole("button", { name: "Activate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Activate" }).click();
  await expect(page.getByRole("heading", { level: 1 }).locator('[data-status="ACTIVE"]')).toBeVisible();

  // Numbering preview for Globex on 2026-11-01.
  await page.goto("/app/settings/numbering");
  await page.getByLabel("Preview for").selectOption({ label: "Globex Solutions (GLBX)" });
  await page.getByLabel("Invoice date").fill("2026-11-01");
  await expect(page.getByTestId("numbering-preview")).toHaveText("GLBX-202611-0001");
  await page.getByLabel("Pattern").fill("{CLIENT}-{YYYY}");
  await expect(page.getByTestId("numbering-preview")).toContainText("{SEQ:n}");
  await expect(page.getByRole("button", { name: "Save pattern" })).toBeDisabled();
});
