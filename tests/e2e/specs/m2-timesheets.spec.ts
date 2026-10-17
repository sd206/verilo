/**
 * M2 main flow (R9) through the UI, with the worker running and the fixture extractor
 * (EXTRACTOR=fixture answers from packages/integrations/ai/fixtures by file hash):
 *  - Ravi, on a phone, enters 176.00 for October and attaches a screenshot that shows 168.00
 *  - the worker reads it; HOURS_MISMATCH blocks it (T3)
 *  - the Admin reviews: image and values side by side with the differences highlighted,
 *    resolves the check with a reason and verifies
 *  - an emailed screenshot from Ravi pre-fills a DRAFT on his September timesheet
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devices, expect, test, type Page } from "@playwright/test";
import { inviteLink, PASSWORD, signUpFirm, unique } from "../helpers";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/integrations/ai/fixtures");
const WEBHOOK_SECRET = process.env.POSTMARK_INBOUND_WEBHOOK_SECRET ?? "e2e-inbound-webhook-secret";

async function createParty(page: Page, kind: string, name: string, extra: (p: Page) => Promise<void> = async () => {}) {
  await page.goto("/app/parties/new");
  await page.getByLabel("Kind").selectOption(kind);
  await page.getByLabel("Legal name").fill(name);
  await page.getByLabel("Display name").fill(name);
  await extra(page);
  await page.getByRole("button", { name: "Create party" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
}

/** Section 18.1 in miniature: Globex prime, Initech end client, Apex sub-vendor, Ravi (contractor), E1 monthly from Sep 1. */
async function setUpRavi(page: Page, raviEmail: string) {
  await createParty(page, "PRIME_VENDOR", "Globex Solutions", async (p) => {
    await p.getByLabel("Code").fill("GLBX");
    await p.getByLabel("Payment terms (days)").fill("45");
  });
  await createParty(page, "END_CLIENT", "Initech Corp");
  await createParty(page, "SUB_VENDOR", "Apex Talent Inc", async (p) => void (await p.getByLabel("Vendor pay terms").selectOption("PAY_WHEN_PAID")));

  await page.goto("/app/consultants/new");
  await page.getByLabel("First name").fill("Ravi");
  await page.getByLabel("Last name").fill("Kumar");
  await page.getByLabel("Employment").selectOption("CONTRACTOR");
  await page.getByLabel("Sub-vendor").selectOption({ label: "Apex Talent Inc" });
  await page.getByLabel("Emails").fill(raviEmail);
  await page.getByRole("button", { name: "Create consultant" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ravi Kumar");

  await page.getByRole("link", { name: "New engagement" }).click();
  await page.getByLabel("Bill-to").selectOption({ label: "Globex Solutions (Prime vendor)" });
  await page.getByLabel("End client").selectOption({ label: "Initech Corp" });
  await page.getByLabel("Prime vendor").selectOption({ label: "Globex Solutions" });
  await page.getByLabel("Role title").fill("SAP Analyst");
  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByRole("button", { name: "Create engagement" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SAP Analyst");
  for (const [n, side, rate] of [
    [1, "BILL", "95.00"],
    [2, "PAY", "75.00"],
  ] as const) {
    await page.getByLabel("Side").selectOption(side);
    await page.getByLabel("Rate per hour").fill(rate);
    await page.getByLabel("Effective from").fill("2026-09-01");
    await page.getByRole("button", { name: "Add rate" }).click();
    await expect(page.getByTestId("rate-row")).toHaveCount(n);
  }
  await page.getByRole("button", { name: "Activate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Activate" }).click();
  // Activation creates the timesheets for periods that have started (7.1).
  await expect(page.getByTestId("engagement-timesheets")).toContainText("Sep 2026");

  await page.goto("/app/settings/users");
  await page.getByLabel("Email").fill(raviEmail);
  await page.getByLabel("Role").selectOption("CONSULTANT");
  await page.getByLabel("Consultant record").selectOption({ label: "Ravi Kumar" });
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(new RegExp(`Invitation sent to ${raviEmail}|Send ${raviEmail} this link`))).toBeVisible();
  return inviteLink(page, raviEmail);
}

const weekdays = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

test("M2: phone timesheet, AI read, side-by-side review, email intake", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const admin = await browser.newPage();
  await signUpFirm(admin, { firm: "Lonestar M2", name: "Lee Admin", email: unique("m2-admin") });
  const inbox = (await admin.locator("code").first().textContent())!.trim();
  expect(inbox).toMatch(/^ts-/);
  const raviEmail = unique("ravi");
  const link = await setUpRavi(admin, raviEmail);

  // --- Ravi on his phone (13.1) -------------------------------------------------------------
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const ravi = await phoneCtx.newPage();
  await ravi.goto(link);
  await ravi.getByLabel("Your name").fill("Ravi Kumar");
  await ravi.getByLabel("Choose a password").fill(PASSWORD);
  await ravi.getByRole("button", { name: "Accept invitation" }).click();
  await expect(ravi).toHaveURL(/\/app\/timesheets$/);
  await expect(ravi.getByTestId("submit-current")).toBeVisible();
  await expect(ravi.getByTestId("submit-current")).toContainText(/Submit this month/);

  await ravi.getByTestId("my-timesheets").getByRole("link", { name: /Oct 2026/ }).click();
  await expect(ravi.getByRole("heading", { level: 1 })).toContainText("Oct 2026");
  for (const d of weekdays("2026-10-01", "2026-10-31")) await ravi.locator(`input[data-date="${d}"]`).fill("8");
  await expect(ravi.getByTestId("total-hours")).toHaveText("176.00");

  // The approved screenshot shows 168.00 (one weekday off).
  await ravi.getByTestId("evidence-input").setInputFiles(path.join(FIXTURES, "calendar-month-7.png"));
  await expect(ravi.getByTestId("evidence-list")).toContainText("calendar-month-7.png", { timeout: 60_000 });
  await ravi.getByTestId("submit-timesheet").click();
  await expect(ravi.getByTestId("save-result")).toHaveText("Submitted");

  // The worker reads the screenshot; the page refreshes itself and shows the problem in plain words.
  await expect(ravi.locator('[data-check="HOURS_MISMATCH"]')).toContainText("168.00", { timeout: 90_000 });
  await expect(ravi.getByRole("heading", { level: 1 }).locator('[data-status="NEEDS_REVIEW"]')).toBeVisible();

  // --- Admin reviews (13.2 item 2) ------------------------------------------------------------
  await admin.goto("/app/timesheets");
  await admin.getByTestId("timesheet-inbox").getByText("Ravi Kumar").first().click();
  await expect(admin.getByTestId("evidence-viewer").locator("img")).toBeVisible();
  const totalRow = admin.locator('[data-field="Total hours"]');
  await expect(totalRow).toHaveAttribute("data-differs", "true");
  await expect(totalRow).toContainText("176.00");
  await expect(totalRow).toContainText("168.00");
  await expect(admin.locator('[data-field="Consultant"]')).toHaveAttribute("data-differs", "false");
  // The day that differs is highlighted (Fri Oct 30).
  await expect(admin.getByTestId("daily-comparison").locator('tr[data-differs="true"]')).toHaveCount(1);
  await expect(admin.getByTestId("daily-comparison").locator('tr[data-differs="true"]')).toContainText("Oct 30");
  // Zoom.
  await admin.getByRole("button", { name: "Zoom in" }).click();
  await expect(admin.getByRole("button", { name: "125%" })).toBeVisible();

  const check = admin.locator('[data-check="HOURS_MISMATCH"]');
  await check.getByRole("button", { name: "Resolve" }).click();
  await check.getByLabel("Reason").fill("Client confirmed Oct 30 was worked; VMS correction pending");
  await check.getByRole("button", { name: "Save" }).click();
  await expect(check).toContainText("Resolved by");
  await admin.getByTestId("verify").click();
  await expect(admin.getByRole("heading", { level: 1 }).locator('[data-status="VERIFIED"]')).toBeVisible();

  // --- Emailed screenshot from Ravi (section 9, 8.6) -------------------------------------------
  const sep = readFileSync(path.join(FIXTURES, "calendar-month-5.png"));
  const res = await request.post("/api/inbound-email/postmark", {
    headers: { authorization: `Basic ${Buffer.from(`postmark:${WEBHOOK_SECRET}`).toString("base64")}` },
    data: {
      From: `Ravi Kumar <${raviEmail}>`,
      FromFull: { Email: raviEmail, Name: "Ravi Kumar" },
      ToFull: [{ Email: inbox, Name: "" }],
      Subject: "September timesheet",
      MessageID: `e2e-${Date.now()}`,
      Date: new Date().toUTCString(),
      Headers: [],
      Attachments: [{ Name: "september.png", ContentType: "image/png", Content: sep.toString("base64"), ContentLength: sep.length }],
    },
  });
  expect(res.status()).toBe(200);
  await ravi.goto("/app/timesheets");
  const sepCard = ravi.getByTestId("my-timesheets").getByRole("link", { name: /Sep 2026/ });
  await expect(async () => {
    await ravi.reload();
    await expect(sepCard).toContainText("176.00", { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(sepCard.locator('[data-status="DRAFT"]')).toBeVisible(); // pre-filled, never submitted
  await sepCard.click();
  await expect(ravi.getByTestId("evidence-list")).toContainText("september.png");
  await expect(ravi.getByTestId("submit-timesheet")).toBeVisible();

  await phoneCtx.close();
});
