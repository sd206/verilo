"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/forms/field";
import { formValues, useAction } from "@/components/forms/use-action";
import { inviteUserAction } from "@/server/actions/members";
import { ROLE_LABELS } from "@/lib/utils";

export function InviteForm({ consultants }: { consultants: { id: string; name: string }[] }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(inviteUserAction);
  const [role, setRole] = useState("CONSULTANT");
  const [result, setResult] = useState<{ emailed: boolean; link: string | null; email: string } | null>(null);
  return (
    <div className="grid gap-4">
      <form
        className="grid gap-4 md:grid-cols-[2fr_2fr_1fr_2fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          submit({ email: v.email, role: v.role, ...(v.name ? { name: v.name } : {}), ...(v.role === "CONSULTANT" && v.consultantId ? { consultantId: v.consultantId } : {}) }, (d) => {
            setResult({ ...d, email: v.email! });
            form.reset();
            router.refresh();
          });
        }}
      >
        <Field label="Email" name="email" type="email" required />
        <Field label="Name (optional)" name="name" />
        <div className="grid gap-1.5">
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {role === "CONSULTANT" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="consultantId">Consultant record</Label>
            <Select id="consultantId" name="consultantId" defaultValue="">
              <option value="">Choose…</option>
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {result?.emailed && <Alert variant="success">Invitation sent to {result.email}.</Alert>}
      {result && !result.emailed && result.link && (
        <Alert data-testid="invite-link-alert">
          Email isn't set up in this environment. Send {result.email} this link yourself:
          <code data-testid="invite-link" className="mt-2 block break-all font-mono text-xs">
            {result.link}
          </code>
        </Alert>
      )}
    </div>
  );
}
