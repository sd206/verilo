"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { requestMagicLinkAction, signInAction } from "@/server/actions/auth";

export function SignInForm() {
  const router = useRouter();
  const { pending, error, submit } = useAction(signInAction);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(formValues(e.currentTarget), (d) => router.push(d.next));
      }}
    >
      <Field label="Email" name="email" type="email" required autoComplete="username" />
      <Field label="Password" name="password" type="password" required autoComplete="current-password" />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function MagicLinkForm() {
  const [sent, setSent] = useState(false);
  const { pending, error, submit } = useAction(requestMagicLinkAction);
  if (sent) return <Alert variant="success">If that email has an account, a sign-in link is on its way.</Alert>;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(formValues(e.currentTarget), () => setSent(true));
      }}
    >
      <Field label="Email me a sign-in link" name="email" type="email" required autoComplete="email" />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Sending…" : "Send link"}
      </Button>
    </form>
  );
}
