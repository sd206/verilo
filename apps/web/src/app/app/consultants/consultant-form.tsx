"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FormSection, SelectField, TextAreaField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import { createConsultantAction, updateConsultantAction } from "@/server/actions/master";

export interface ConsultantFormValues {
  id?: string;
  firstName: string;
  lastName: string;
  emails: string[];
  phone: string | null;
  employmentType: "W2" | "CONTRACTOR";
  subVendorPartyId: string | null;
  workAuthType: string | null;
  workAuthExpiry: string | null;
}

export function ConsultantForm({
  initial,
  subVendors,
  onDone,
}: {
  initial?: ConsultantFormValues;
  subVendors: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [type, setType] = useState(initial?.employmentType ?? "CONTRACTOR");
  const { pending, error, submit } = useAction(editing ? updateConsultantAction : createConsultantAction);
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        const input = formInput(e.currentTarget);
        if (type === "W2") input.subVendorPartyId = null;
        if (editing) input.consultantId = initial!.id!;
        submit(input, (d) => {
          if (onDone) onDone();
          else router.push(`/app/consultants/${d.id}`);
          router.refresh();
        });
      }}
    >
      <FormSection title="Consultant">
        <TextField label="First name" name="firstName" defaultValue={initial?.firstName} required />
        <TextField label="Last name" name="lastName" defaultValue={initial?.lastName} required />
        <SelectField
          label="Employment"
          name="employmentType"
          value={type}
          onChange={(e) => setType(e.target.value as "W2" | "CONTRACTOR")}
          options={[
            { value: "CONTRACTOR", label: "Contractor (via sub-vendor)" },
            { value: "W2", label: "W-2 employee" },
          ]}
        />
        {type === "CONTRACTOR" ? (
          <SelectField
            label="Sub-vendor"
            name="subVendorPartyId"
            defaultValue={initial?.subVendorPartyId ?? ""}
            placeholder="Choose…"
            options={subVendors.map((s) => ({ value: s.id, label: s.name }))}
            required
          />
        ) : (
          <div />
        )}
        <TextAreaField
          label="Emails"
          name="emails"
          rows={2}
          defaultValue={initial?.emails.join(", ")}
          hint="Every address they may send timesheets from. Comma-separated."
        />
        <TextField label="Phone" name="phone" defaultValue={initial?.phone ?? ""} />
        <TextField label="Work authorization" name="workAuthType" defaultValue={initial?.workAuthType ?? ""} placeholder="H-1B, GC, …" hint="Used for expiry alerts only." />
        <TextField label="Work authorization expiry" name="workAuthExpiry" type="date" defaultValue={initial?.workAuthExpiry ?? ""} />
      </FormSection>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create consultant"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => (onDone ? onDone() : router.back())}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
