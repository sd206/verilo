/**
 * Staging smoke test after each deploy (section 24.7): sign in and upload a file.
 * Signs up a throwaway firm each run (staging holds synthetic data only), so CI needs no
 * stored credentials or TOTP secrets.
 */
import { expect, test } from "@playwright/test";
import { signIn, signOut, signUpFirm, unique, uploadPdf } from "../helpers";

test("smoke: health, sign up, sign in with MFA, upload a file", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);

  const email = unique("smoke");
  const secret = await signUpFirm(page, { firm: "Smoke Test Firm", name: "Smoke Test", email });
  await signOut(page);
  await signIn(page, email, secret);
  await uploadPdf(page, "smoke.pdf");
});
