/**
 * Outbound email (section 3: Postmark). Locally, Mailpit's HTTP send API. In staging before a
 * Postmark server exists, the disabled sender reports that email is off and callers fall back
 * (invite links are shown to the inviting admin outside production; magic links are hidden).
 * Inbound parsing (section 9) is in ./inbound.ts.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Postmark message stream; "outbound" is the transactional default. */
  stream?: string;
  /** Extra headers, e.g. Auto-Submitted on auto-replies and In-Reply-To. */
  headers?: Record<string, string>;
  /** Overrides the sender's default From (auto-replies come from the inbox address). */
  from?: string;
}

export interface EmailSender {
  readonly enabled: boolean;
  send(msg: OutboundEmail): Promise<void>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Outbound email is not configured");
    this.name = "EmailNotConfiguredError";
  }
}

export class PostmarkSender implements EmailSender {
  readonly enabled = true;
  constructor(
    private readonly serverToken: string,
    private readonly from: string,
  ) {}
  async send(msg: OutboundEmail): Promise<void> {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-postmark-server-token": this.serverToken,
      },
      body: JSON.stringify({
        From: msg.from ?? this.from,
        To: msg.to,
        Headers: Object.entries(msg.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
        Subject: msg.subject,
        TextBody: msg.text,
        HtmlBody: msg.html,
        MessageStream: msg.stream ?? "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark send failed: HTTP ${res.status}`);
  }
}

/** Local development: Mailpit (docker-compose) HTTP API. */
export class MailpitSender implements EmailSender {
  readonly enabled = true;
  constructor(
    private readonly baseUrl: string,
    private readonly from: string,
  ) {}
  async send(msg: OutboundEmail): Promise<void> {
    const res = await fetch(new URL("/api/v1/send", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: msg.from ?? this.from },
        To: [{ Email: msg.to }],
        Headers: msg.headers ?? {},
        Subject: msg.subject,
        Text: msg.text,
        HTML: msg.html,
      }),
    });
    if (!res.ok) throw new Error(`Mailpit send failed: HTTP ${res.status}`);
  }
}

export class DisabledSender implements EmailSender {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new EmailNotConfiguredError();
  }
}

export function emailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const from = env.EMAIL_FROM ?? "Verilo <no-reply@localhost>";
  if (env.POSTMARK_SERVER_TOKEN) return new PostmarkSender(env.POSTMARK_SERVER_TOKEN, from);
  if (env.MAILPIT_URL) return new MailpitSender(env.MAILPIT_URL, from);
  return new DisabledSender();
}

// --- templates -------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1c1917;max-width:520px;margin:24px auto">
<h2 style="font-size:18px">${esc(title)}</h2>${bodyHtml}
<p style="color:#78716c;font-size:12px;margin-top:32px">Verilo — Accurate hours. Less busywork.</p></body></html>`;
}

export function inviteEmail(input: { to: string; firmName: string; inviterName: string; role: string; link: string }): OutboundEmail {
  const subject = `${input.inviterName} invited you to ${input.firmName} on Verilo`;
  const text = `${input.inviterName} invited you to join ${input.firmName} on Verilo as ${input.role}.\n\nAccept the invitation: ${input.link}\n\nThis link expires in 7 days.`;
  const html = layout(
    subject,
    `<p>${esc(input.inviterName)} invited you to join <b>${esc(input.firmName)}</b> as <b>${esc(input.role)}</b>.</p>
<p><a href="${esc(input.link)}" style="background:#1c1917;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
<p style="font-size:13px">This link expires in 7 days.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function magicLinkEmail(input: { to: string; link: string }): OutboundEmail {
  const subject = "Your Verilo sign-in link";
  const text = `Sign in to Verilo: ${input.link}\n\nThe link expires in 10 minutes. If you didn't ask for it, ignore this email.`;
  const html = layout(
    subject,
    `<p><a href="${esc(input.link)}" style="background:#1c1917;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
<p style="font-size:13px">The link expires in 10 minutes. If you didn't ask for it, ignore this email.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function autoReplyEmail(input: { to: string; from: string; subject: string | null; inReplyTo: string | null }): OutboundEmail {
  const subject = input.subject ? `Re: ${input.subject.replace(/^re:\s*/i, "")}` : "Received";
  const text = "Received — we'll let you know if anything is missing.";
  return {
    to: input.to,
    from: input.from,
    subject,
    text,
    html: layout("Received", `<p>${esc(text)}</p>`),
    // RFC 3834: mark it so other auto-responders don't answer it.
    headers: { "Auto-Submitted": "auto-replied", ...(input.inReplyTo ? { "In-Reply-To": input.inReplyTo, References: input.inReplyTo } : {}) },
  };
}

export function timesheetReminderEmail(input: { to: string; firmName: string; consultantName: string; period: string; link: string }): OutboundEmail {
  const subject = `Reminder: submit your timesheet for ${input.period}`;
  const text = `Hi ${input.consultantName},\n\nYour ${input.period} timesheet for ${input.firmName} hasn't been submitted yet. Enter your hours and attach the approved screenshot: ${input.link}\n\nYou can also reply to your timesheet inbox with the screenshot.`;
  const html = layout(
    subject,
    `<p>Hi ${esc(input.consultantName)},</p><p>Your <b>${esc(input.period)}</b> timesheet for ${esc(input.firmName)} hasn't been submitted yet.</p>
<p><a href="${esc(input.link)}" style="background:#1c1917;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Submit timesheet</a></p>`,
  );
  return { to: input.to, subject, text, html };
}

export function timesheetReturnedEmail(input: { to: string; firmName: string; consultantName: string; period: string; reason: string; link: string }): OutboundEmail {
  const subject = `Your ${input.period} timesheet needs a fix`;
  const text = `Hi ${input.consultantName},\n\n${input.firmName} returned your ${input.period} timesheet:\n\n${input.reason}\n\nFix it here: ${input.link}`;
  const html = layout(
    subject,
    `<p>Hi ${esc(input.consultantName)},</p><p>${esc(input.firmName)} returned your <b>${esc(input.period)}</b> timesheet:</p>
<blockquote style="border-left:3px solid #d6d3d1;margin:0;padding-left:12px">${esc(input.reason)}</blockquote>
<p><a href="${esc(input.link)}" style="background:#1c1917;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Fix timesheet</a></p>`,
  );
  return { to: input.to, subject, text, html };
}

export * from "./inbound";
