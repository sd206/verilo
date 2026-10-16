"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { verifyMfaAction } from "@/server/actions/auth";

export function MfaVerifyForm() {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);
  const { pending, error, submit, setError } = useAction(verifyMfaAction);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(formValues(e.currentTarget), (d) => router.push(d.next));
      }}
    >
      {useRecovery ? (
        <Field key="r" label="Recovery code" name="recoveryCode" required autoComplete="off" placeholder="xxxxx-xxxxx" />
      ) : (
        <Field key="c" label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          setError(null);
          setUseRecovery(!useRecovery);
        }}
      >
        {useRecovery ? "Use a code from my app" : "Use a recovery code"}
      </Button>
    </form>
  );
}
