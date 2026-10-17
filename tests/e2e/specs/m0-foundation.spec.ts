/**
 * M0 main flow (R9): sign up a firm, MFA for the Admin, invite users of all four roles,
 * MFA enforced for Finance, and a file upload that is stored and scanned CLEAN.
 * Invite links are taken from Mailpit when it runs, otherwise from the on-screen fallback.
 */
import { expect, test, type Page } from "@playwright/test";
import { enrolMfa, PASSWORD, signIn, signOut, signUpFirm, unique, uploadPdf } from "../helpers";

const MAILPIT = process.env.MAILPIT_URL;

async function inviteLink(page: Page, email: string): Promise<string> {
  const onScreen = page.getByTestId("invite-link");
  if (await onScreen.isVisible().catch(() => false)) return (await onScreen.textContent())!.trim();
  expect(MAILPIT, "no on-screen link and no MAILPIT_URL").toBeTruthy();
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { ID: string }[] };
    if (body.messages.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${body.messages[0]!.ID}`)).json()) as { Text: string };
      return msg.Text.match(/https?:\/\/\S+\/invite\/\S+/)![0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no invite email for ${email}`);
}

test("M0: sign up, MFA, invite all four roles, upload a clean file", async ({ page, browser }) => {
  const adminEmail = unique("admin");
  const adminSecret = await signUpFirm(page, { firm: "Playwright Consulting", name: "Pat Admin", email: adminEmail });
  await expect(page.getByTestId("firm-name")).toHaveText("Playwright Consulting");

  // Consultant logins link to a consultant record (M1), so create one first.
  const consultantEmail = unique("consultant");
  await page.goto("/app/consultants/new");
  await page.getByLabel("First name").fill("Cam");
  await page.getByLabel("Last name").fill("Consultant");
  await page.getByLabel("Employment").selectOption("W2");
  await page.getByLabel("Emails").fill(consultantEmail);
  await page.getByRole("button", { name: "Create consultant" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Cam Consultant");

  // Invite one user of each role.
  const invited: Record<string, string> = {};
  for (const [role, label] of [
    ["ADMIN", "Admin"],
    ["MANAGER", "Manager"],
    ["FINANCE", "Finance"],
    ["CONSULTANT", "Consultant"],
  ] as const) {
    await page.goto("/app/settings/users");
    const email = role === "CONSULTANT" ? consultantEmail : unique(role.toLowerCase());
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role").selectOption(role);
    if (role === "CONSULTANT") await page.getByLabel("Consultant record").selectOption({ label: "Cam Consultant" });
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(new RegExp(`Invitation sent to ${email}|Send ${email} this link`))).toBeVisible();
    invited[role] = await inviteLink(page, email);
    void label;
  }
  await page.goto("/app/settings/users");
  await expect(page.getByTestId("pending-invite")).toHaveCount(4);

  // Finance accepts and is forced through MFA setup before reaching the app.
  const finance = await browser.newPage();
  await finance.goto(invited.FINANCE!);
  await finance.getByLabel("Your name").fill("Fran Finance");
  await finance.getByLabel("Choose a password").fill(PASSWORD);
  await finance.getByRole("button", { name: "Accept invitation" }).click();
  await expect(finance).toHaveURL(/\/mfa\/setup/);
  await finance.goto("/app");
  await expect(finance).toHaveURL(/\/mfa\/setup/); // can't skip it
  await enrolMfa(finance);
  await expect(finance.getByTestId("whoami")).toContainText("Finance");

  // Manager accepts and goes straight in (MFA optional).
  const manager = await browser.newPage();
  await manager.goto(invited.MANAGER!);
  await manager.getByLabel("Your name").fill("Max Manager");
  await manager.getByLabel("Choose a password").fill(PASSWORD);
  await manager.getByRole("button", { name: "Accept invitation" }).click();
  await expect(manager).toHaveURL(/\/app$/);
  // Managers don't see user management, and the server refuses it too (R8).
  await expect(manager.getByRole("link", { name: "Users" })).toHaveCount(0);
  await manager.goto("/app/settings/users");
  await expect(manager).toHaveURL(/\/app$/);

  // Consultant accepts and uploads a file, which is scanned CLEAN.
  const consultant = await browser.newPage();
  await consultant.goto(invited.CONSULTANT!);
  await consultant.getByLabel("Your name").fill("Cam Consultant");
  await consultant.getByLabel("Choose a password").fill(PASSWORD);
  await consultant.getByRole("button", { name: "Accept invitation" }).click();
  await expect(consultant).toHaveURL(/\/app$/);
  await uploadPdf(consultant, "week-42.pdf");

  // Admin signs out and back in: password + TOTP; then uploads and downloads.
  await signOut(page);
  await signIn(page, adminEmail, adminSecret);
  await uploadPdf(page, "admin-upload.pdf");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "admin-upload.pdf" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("admin-upload.pdf");
});
