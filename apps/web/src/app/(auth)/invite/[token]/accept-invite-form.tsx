"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { acceptInviteAction } from "@/server/actions/members";

export function AcceptInviteForm({ token, needsPassword }: { token: string; needsPassword: boolean }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(acceptInviteAction);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ token, ...formValues(e.currentTarget) }, (d) => router.push(d.next));
      }}
    >
      {needsPassword ? (
        <>
          <Field label="Your name" name="name" required autoComplete="name" />
          <Field label="Choose a password" name="password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
        </>
      ) : (
        <Field label="Your current Verilo password" name="password" type="password" required autoComplete="current-password" />
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
