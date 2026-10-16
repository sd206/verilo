"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { enableMfaAction } from "@/server/actions/auth";

export function MfaSetupForm({ qrDataUrl, secret }: { qrDataUrl: string; secret: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(enableMfaAction);
  const [done, setDone] = useState<{ recoveryCodes: string[]; next: string } | null>(null);

  if (done) {
    return (
      <div className="grid gap-4">
        <Alert variant="success">Two-step sign-in is on.</Alert>
        <div>
          <p className="text-sm font-medium">Save your recovery codes</p>
          <p className="text-sm text-muted-foreground">Each code works once if you lose your phone. They won't be shown again.</p>
        </div>
        <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 rounded-md bg-muted p-4 font-mono text-sm">
          {done.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button onClick={() => router.push(done.next)}>I've saved them — continue</Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(formValues(e.currentTarget), setDone);
      }}
    >
      <ol className="grid gap-1 text-sm text-muted-foreground">
        <li>1. Open an authenticator app (Google Authenticator, 1Password, Authy…).</li>
        <li>2. Scan the code, or enter the key by hand.</li>
        <li>3. Type the 6-digit code it shows.</li>
      </ol>
      <div className="flex flex-col items-center gap-3 rounded-md border border-border p-4">
        <img src={qrDataUrl} alt="QR code for your authenticator app" width={220} height={220} />
        <code data-testid="totp-secret" className="break-all text-center font-mono text-xs tracking-wider">
          {secret}
        </code>
      </div>
      <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9 ]{6,7}" />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Turn on"}
      </Button>
    </form>
  );
}
