import { describe, expect, it } from "vitest";
import { DisabledSender, emailSenderFromEnv, EmailNotConfiguredError, inviteEmail, MailpitSender, PostmarkSender } from "./index";

describe("email", () => {
  it("chooses Postmark, then Mailpit, then disabled", () => {
    expect(emailSenderFromEnv({ POSTMARK_SERVER_TOKEN: "t" })).toBeInstanceOf(PostmarkSender);
    expect(emailSenderFromEnv({ MAILPIT_URL: "http://localhost:8025" })).toBeInstanceOf(MailpitSender);
    const off = emailSenderFromEnv({});
    expect(off).toBeInstanceOf(DisabledSender);
    expect(off.enabled).toBe(false);
  });

  it("disabled sender throws", async () => {
    await expect(new DisabledSender().send()).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("escapes names in the invite email", () => {
    const m = inviteEmail({ to: "a@b.co", firmName: "<Acme>", inviterName: "Ann", role: "FINANCE", link: "https://x/y" });
    expect(m.html).toContain("&lt;Acme&gt;");
    expect(m.text).toContain("https://x/y");
  });
});
