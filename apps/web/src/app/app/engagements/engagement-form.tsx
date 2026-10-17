"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, FormSection, SelectField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import { createEngagementAction, updateEngagementAction } from "@/server/actions/master";
import { CYCLE_LABELS, PARTY_KIND_LABELS } from "@/lib/utils";

type Opt = { id: string; name: string; kind?: string };
export interface EngagementOptions {
  billTo: Opt[];
  endClients: Opt[];
  primes: Opt[];
  implementationPartners: Opt[];
  consultants: Opt[];
}

export interface EngagementFormValues {
  id?: string;
  consultantId: string;
  billToPartyId: string;
  endClientPartyId: string;
  primePartyId: string | null;
  implementationPartnerPartyId: string | null;
  projectName: string | null;
  roleTitle: string | null;
  startDate: string;
  endDate: string | null;
  timesheetCycle: string;
  biweeklyAnchorDate: string | null;
  invoiceCycle: string;
  evidenceRequired: boolean;
  expectedWeeklyHours: string;
  maxWeeklyHoursWarning: string;
  deductionOverride: string;
  factored: boolean;
  primeWorkOrderNo: string | null;
  primeConsultantRef: string | null;
  endClientWorkerRef: string | null;
}

const cycles = Object.entries(CYCLE_LABELS).map(([value, label]) => ({ value, label }));
const opts = (xs: Opt[], withKind = false) => xs.map((x) => ({ value: x.id, label: withKind && x.kind ? `${x.name} (${PARTY_KIND_LABELS[x.kind]})` : x.name }));

export function EngagementForm({ options, initial }: { options: EngagementOptions; initial: Partial<EngagementFormValues> }) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [tsCycle, setTsCycle] = useState(initial.timesheetCycle ?? "MONTHLY");
  const [invCycle, setInvCycle] = useState(initial.invoiceCycle ?? "MONTHLY");
  const { pending, error, submit } = useAction(editing ? updateEngagementAction : createEngagementAction);
  const needsAnchor = tsCycle === "BIWEEKLY" || invCycle === "BIWEEKLY";
  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const input = formInput(e.currentTarget);
        if (editing) {
          delete input.consultantId;
          input.engagementId = initial.id!;
        }
        submit(input, (d) => {
          router.push(`/app/engagements/${d.id}`);
          router.refresh();
        });
      }}
    >
      <FormSection title="Billing chain">
        <SelectField
          label="Consultant"
          name="consultantId"
          defaultValue={initial.consultantId ?? ""}
          placeholder="Choose…"
          options={opts(options.consultants)}
          disabled={editing}
          required
        />
        <SelectField label="Bill-to" name="billToPartyId" defaultValue={initial.billToPartyId ?? ""} placeholder="Choose…" options={opts(options.billTo, true)} required />
        <SelectField label="End client" name="endClientPartyId" defaultValue={initial.endClientPartyId ?? ""} placeholder="Choose…" options={opts(options.endClients)} required />
        <SelectField label="Prime vendor" name="primePartyId" defaultValue={initial.primePartyId ?? ""} placeholder="None" options={opts(options.primes)} />
        <SelectField
          label="Implementation partner"
          name="implementationPartnerPartyId"
          defaultValue={initial.implementationPartnerPartyId ?? ""}
          placeholder="None"
          options={opts(options.implementationPartners)}
        />
      </FormSection>
      <FormSection title="Assignment">
        <TextField label="Role title" name="roleTitle" defaultValue={initial.roleTitle ?? ""} placeholder="SAP Analyst" />
        <TextField label="Project" name="projectName" defaultValue={initial.projectName ?? ""} />
        <TextField label="Start date" name="startDate" type="date" defaultValue={initial.startDate ?? ""} required />
        <TextField label="End date" name="endDate" type="date" defaultValue={initial.endDate ?? ""} />
        <TextField label="Prime work order #" name="primeWorkOrderNo" defaultValue={initial.primeWorkOrderNo ?? ""} />
        <TextField label="Prime's consultant ID" name="primeConsultantRef" defaultValue={initial.primeConsultantRef ?? ""} />
        <TextField label="VMS worker ID" name="endClientWorkerRef" defaultValue={initial.endClientWorkerRef ?? ""} />
      </FormSection>
      <FormSection title="Timesheets and invoicing">
        <SelectField label="Timesheet cycle" name="timesheetCycle" value={tsCycle} onChange={(e) => setTsCycle(e.target.value)} options={cycles} />
        <SelectField label="Invoice cycle" name="invoiceCycle" value={invCycle} onChange={(e) => setInvCycle(e.target.value)} options={cycles} />
        {needsAnchor && <TextField label="Biweekly anchor date" name="biweeklyAnchorDate" type="date" defaultValue={initial.biweeklyAnchorDate ?? ""} required />}
        <TextField label="Expected weekly hours" name="expectedWeeklyHours" inputMode="decimal" defaultValue={initial.expectedWeeklyHours ?? "40"} />
        <TextField label="Warn above (hours/week)" name="maxWeeklyHoursWarning" inputMode="decimal" defaultValue={initial.maxWeeklyHoursWarning ?? "50"} />
        <TextField label="Deduction override (%)" name="deductionOverride" inputMode="decimal" defaultValue={initial.deductionOverride ?? ""} hint="Leave empty to use the bill-to party's deduction." />
        <div className="grid content-start gap-2 pt-1">
          <CheckboxField label="Evidence required" name="evidenceRequired" defaultChecked={initial.evidenceRequired ?? true} />
          <CheckboxField label="Factored" name="factored" defaultChecked={initial.factored ?? false} />
        </div>
      </FormSection>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create engagement"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
