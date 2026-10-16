/**
 * Outbound email (section 3: Postmark). Locally, Mailpit's HTTP send API. In staging before a
 * Postmark server exists, the disabled sender reports that email is off and callers fall back
 * (invite links are shown to the inviting admin outside production; magic links are hidden).
 * Inbound parsing arrives in M2.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Postmark message stream; "outbound" is the transactional default. */
  stream?: string;
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
        From: this.from,
        To: msg.to,
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
        From: { Email: this.from },
        To: [{ Email: msg.to }],
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
