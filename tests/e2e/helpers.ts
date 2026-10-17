import { expect, type Page } from "@playwright/test";
import { generateTotp } from "@verilo/auth";

export const PASSWORD = "correct horse battery staple";

export function unique(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

/** Signs up a firm and completes MFA. Returns the TOTP secret (acting as the authenticator app). */
export async function signUpFirm(page: Page, opts: { firm: string; name: string; email: string }) {
  await page.goto("/sign-up");
  await page.getByLabel("Firm legal name").fill(`${opts.firm} LLC`);
  await page.getByLabel("Display name").fill(opts.firm);
  await page.getByLabel("Your name").fill(opts.name);
  await page.getByLabel("Work email").fill(opts.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create firm" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup/);
  return enrolMfa(page);
}

export async function enrolMfa(page: Page) {
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(generateTotp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("recovery-codes")).toBeVisible();
  await page.getByRole("button", { name: /continue/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  return secret;
}

export async function signIn(page: Page, email: string, totpSecret?: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (totpSecret) {
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByLabel("6-digit code").fill(generateTotp(totpSecret));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  // Consultants land on their timesheets (13.1).
  await expect(page).toHaveURL(/\/app(\/timesheets)?$/);
}

/** The invite link from the on-screen fallback, or from Mailpit when email is on. */
export async function inviteLink(page: Page, email: string): Promise<string> {
  const onScreen = page.getByTestId("invite-link");
  if (await onScreen.isVisible().catch(() => false)) return (await onScreen.textContent())!.trim();
  const mailpit = process.env.MAILPIT_URL;
  expect(mailpit, "no on-screen link and no MAILPIT_URL").toBeTruthy();
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { ID: string }[] };
    if (body.messages.length) {
      const msg = (await (await fetch(`${mailpit}/api/v1/message/${body.messages[0]!.ID}`)).json()) as { Text: string };
      return msg.Text.match(/https?:\/\/\S+\/invite\/\S+/)![0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no invite email for ${email}`);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Uploads a small PDF and waits for the scan result. */
export async function uploadPdf(page: Page, name = "timesheet.pdf") {
  await page.goto("/app/files");
  await page.getByTestId("file-input").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Verilo E2E test timesheet\n"),
  });
  await expect(page.getByTestId("upload-result")).toContainText("is clean", { timeout: 60_000 });
  await expect(page.getByRole("row", { name: new RegExp(name) }).getByTestId("scan-status")).toHaveText("Clean");
}
