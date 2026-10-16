"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { signUpFirmAction } from "@/server/actions/auth";

export function SignUpForm() {
  const router = useRouter();
  const { pending, error, submit } = useAction(signUpFirmAction);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(formValues(e.currentTarget), (d) => router.push(d.next));
      }}
    >
      <Field label="Firm legal name" name="firmLegalName" required autoComplete="organization" placeholder="Acme Consulting LLC" />
      <Field label="Display name" name="firmDisplayName" required placeholder="Acme Consulting" />
      <Field label="Your name" name="name" required autoComplete="name" />
      <Field label="Work email" name="email" type="email" required autoComplete="email" />
      <Field label="Password" name="password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create firm"}
      </Button>
    </form>
  );
}
