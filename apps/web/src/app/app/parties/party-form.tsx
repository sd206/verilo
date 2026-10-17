"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, FormSection, SelectField, TextAreaField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import { createPartyAction, updatePartyAction } from "@/server/actions/master";
import { PARTY_KIND_LABELS, W9_LABELS } from "@/lib/utils";

export interface PartyFormValues {
  id?: string;
  kind: string;
  legalName: string;
  displayName: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  apEmails: string[];
  arEmails: string[];
  paymentTermsDays: number | null;
  paysWhenPaidUpstream: boolean;
  upstreamBufferDays: number;
  deductionPercent: string;
  deductionLabel: string | null;
  invoiceLayout: string;
  deliveryMethod: string;
  backupRequired: boolean;
  poRequired: boolean;
  timesheetConfirmEmail: string | null;
  vendorPayTerms: string | null;
  vendorNetDays: number | null;
  w9TaxClassification: string;
  tinMasked: string | null;
  tinType: string | null;
  hasRemitDetails: boolean;
}

const EMPTY: PartyFormValues = {
  kind: "PRIME_VENDOR",
  legalName: "",
  displayName: "",
  code: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  phone: null,
  apEmails: [],
  arEmails: [],
  paymentTermsDays: 30,
  paysWhenPaidUpstream: false,
  upstreamBufferDays: 15,
  deductionPercent: "",
  deductionLabel: null,
  invoiceLayout: "PER_CONSULTANT",
  deliveryMethod: "EMAIL",
  backupRequired: false,
  poRequired: false,
  timesheetConfirmEmail: null,
  vendorPayTerms: null,
  vendorNetDays: null,
  w9TaxClassification: "UNKNOWN",
  tinMasked: null,
  tinType: null,
  hasRemitDetails: false,
};

const W9 = ["UNKNOWN", "INDIVIDUAL_SOLE_PROP_SMLLC", "C_CORP", "S_CORP", "PARTNERSHIP", "TRUST_ESTATE", "LLC_C", "LLC_S", "LLC_P", "OTHER"];

export function PartyForm({ initial }: { initial?: PartyFormValues }) {
  const router = useRouter();
  const v = initial ?? EMPTY;
  const [kind, setKind] = useState(v.kind);
  const [vendorTerms, setVendorTerms] = useState(v.vendorPayTerms ?? "NET");
  const editing = Boolean(v.id);
  const { pending, error, submit } = useAction(editing ? updatePartyAction : createPartyAction);
  const billTo = kind === "PRIME_VENDOR" || kind === "IMPLEMENTATION_PARTNER" || kind === "END_CLIENT";
  const sub = kind === "SUB_VENDOR";

  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const input = formInput(e.currentTarget);
        if (editing) {
          delete input.kind;
          input.partyId = v.id!;
        }
        if (!sub) {
          for (const k of ["vendorPayTerms", "vendorNetDays", "remitDetails", "w9TaxClassification", "tin", "tinType", "arEmails"]) delete input[k];
        }
        if (!billTo) for (const k of ["standardDeduction", "deductionLabel", "paysWhenPaidUpstream"]) delete input[k];
        submit(input, (d) => {
          router.push(`/app/parties/${d.id}`);
          router.refresh();
        });
      }}
    >
      <FormSection title="Organization">
        <SelectField
          label="Kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={editing}
          options={Object.entries(PARTY_KIND_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <TextField
          label="Code"
          name="code"
          defaultValue={v.code ?? ""}
          hint={billTo ? "Used in invoice numbers ({CLIENT}). 2–10 capital letters or digits." : "Optional short code."}
          maxLength={10}
          style={{ textTransform: "uppercase" }}
        />
        <TextField label="Legal name" name="legalName" defaultValue={v.legalName} required />
        <TextField label="Display name" name="displayName" defaultValue={v.displayName} required />
        <TextField label="Address" name="addressLine1" defaultValue={v.addressLine1 ?? ""} />
        <TextField label="Address line 2" name="addressLine2" defaultValue={v.addressLine2 ?? ""} />
        <TextField label="City" name="city" defaultValue={v.city ?? ""} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="State" name="state" defaultValue={v.state ?? ""} maxLength={2} />
          <TextField label="ZIP" name="postalCode" defaultValue={v.postalCode ?? ""} />
        </div>
        <TextField label="Phone" name="phone" defaultValue={v.phone ?? ""} />
      </FormSection>

      {billTo && (
        <FormSection title="Billing (bill-to)">
          <TextAreaField label="AP emails" name="apEmails" defaultValue={v.apEmails.join(", ")} hint="Where invoices and reminders go. Comma-separated." rows={2} />
          <TextField label="Payment terms (days)" name="paymentTermsDays" type="number" min={0} max={365} defaultValue={v.paymentTermsDays ?? ""} />
          <TextField label="Standard deduction (%)" name="standardDeduction" inputMode="decimal" defaultValue={v.deductionPercent} hint="e.g. 2 for a 2% MSP fee" />
          <TextField label="Deduction label" name="deductionLabel" defaultValue={v.deductionLabel ?? ""} placeholder="MSP fee" />
          <SelectField
            label="Invoice layout"
            name="invoiceLayout"
            defaultValue={v.invoiceLayout}
            options={[
              { value: "PER_CONSULTANT", label: "One invoice per consultant" },
              { value: "COMBINED", label: "Combined" },
            ]}
          />
          <SelectField
            label="Delivery"
            name="deliveryMethod"
            defaultValue={v.deliveryMethod}
            options={[
              { value: "EMAIL", label: "Email" },
              { value: "PORTAL", label: "Portal upload" },
            ]}
          />
          <TextField label="Upstream buffer (days)" name="upstreamBufferDays" type="number" min={0} defaultValue={v.upstreamBufferDays} />
          <TextField label="Timesheet confirmation contact" name="timesheetConfirmEmail" type="email" defaultValue={v.timesheetConfirmEmail ?? ""} />
          <div className="grid content-start gap-2 pt-1">
            <CheckboxField label="Pays when paid upstream" name="paysWhenPaidUpstream" defaultChecked={v.paysWhenPaidUpstream} />
            <CheckboxField label="Backup (evidence pack) required" name="backupRequired" defaultChecked={v.backupRequired} />
            <CheckboxField label="PO required" name="poRequired" defaultChecked={v.poRequired} />
          </div>
        </FormSection>
      )}

      {sub && (
        <FormSection title="Paying this sub-vendor">
          <SelectField
            label="Vendor pay terms"
            name="vendorPayTerms"
            value={vendorTerms}
            onChange={(e) => setVendorTerms(e.target.value)}
            options={[
              { value: "NET", label: "Net days" },
              { value: "PAY_WHEN_PAID", label: "Pay when paid" },
            ]}
          />
          <TextField label="Net days" name="vendorNetDays" type="number" min={0} max={365} defaultValue={v.vendorNetDays ?? (vendorTerms === "NET" ? 30 : 0)} />
          <TextAreaField label="AR emails" name="arEmails" defaultValue={v.arEmails.join(", ")} hint="Where remittances go." rows={2} />
          <TextAreaField
            label="Remit / bank details"
            name="remitDetails"
            rows={2}
            placeholder={v.hasRemitDetails ? "Saved (encrypted). Type to replace." : ""}
            hint="Stored encrypted."
          />
          <SelectField label="W-9 tax classification" name="w9TaxClassification" defaultValue={v.w9TaxClassification} options={W9.map((x) => ({ value: x, label: W9_LABELS[x]! }))} />
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <TextField label="TIN" name="tin" placeholder={v.tinMasked ?? "12-3456789"} hint={v.tinMasked ? "Saved (encrypted). Type to replace." : "Stored encrypted."} />
            <SelectField label="Type" name="tinType" defaultValue={v.tinType ?? ""} placeholder="—" options={[{ value: "EIN", label: "EIN" }, { value: "SSN", label: "SSN" }]} />
          </div>
        </FormSection>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create party"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
