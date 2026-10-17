"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FormSection, MoneyField, SelectField, TextAreaField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import { updateFirmAction } from "@/server/actions/master";
import { completeUploadAction, requestUploadAction } from "@/server/actions/files";

type Firm = {
  legalName: string;
  displayName: string;
  einMasked: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoFileId: string | null;
  timezone: string;
  weekStart: string;
  defaultPaymentTermsDays: number;
  remitToText: string | null;
  matchTolerance: string;
  deductionTolerance: string;
};

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function FirmForm({ firm }: { firm: Firm }) {
  const router = useRouter();
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoFileId, setLogoFileId] = useState(firm.logoFileId);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { pending, error, setError, submit } = useAction(updateFirmAction);

  async function uploadLogo(file: File) {
    setLogoStatus("Uploading and scanning…");
    const req = await requestUploadAction({ filename: file.name, contentType: file.type, sizeBytes: file.size });
    if (!req.ok) return setLogoStatus(req.error);
    const put = await fetch(req.data.upload.url, { method: "PUT", headers: req.data.upload.headers, body: file });
    if (!put.ok) return setLogoStatus("Upload failed");
    const done = await completeUploadAction({ fileId: req.data.fileId });
    if (!done.ok || done.data.scanStatus !== "CLEAN") return setLogoStatus("The file failed the virus scan");
    setLogoFileId(req.data.fileId);
    setLogoStatus(`${file.name} ready — save to apply`);
  }

  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const input = formInput(e.currentTarget);
        if (!input.ein) delete input.ein;
        submit({ ...input, logoFileId }, () => {
          setSaved(true);
          router.refresh();
        });
      }}
      onChange={() => {
        setSaved(false);
        setError(null);
      }}
    >
      <FormSection title="Profile">
        <TextField label="Legal name" name="legalName" defaultValue={firm.legalName} required />
        <TextField label="Display name" name="displayName" defaultValue={firm.displayName} required />
        <TextField label="EIN" name="ein" placeholder={firm.einMasked ?? "12-3456789"} hint={firm.einMasked ? "Saved (encrypted). Type to replace." : "Stored encrypted."} />
        <TextField label="Phone" name="phone" defaultValue={firm.phone ?? ""} />
        <TextField label="Address" name="addressLine1" defaultValue={firm.addressLine1 ?? ""} />
        <TextField label="Address line 2" name="addressLine2" defaultValue={firm.addressLine2 ?? ""} />
        <TextField label="City" name="city" defaultValue={firm.city ?? ""} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="State" name="state" defaultValue={firm.state ?? ""} maxLength={2} />
          <TextField label="ZIP" name="postalCode" defaultValue={firm.postalCode ?? ""} />
        </div>
        <TextField label="Email" name="email" type="email" defaultValue={firm.email ?? ""} />
        <TextField label="Website" name="website" defaultValue={firm.website ?? ""} />
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Logo</span>
          <div className="flex items-center gap-3">
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Logo file" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
            <Button type="button" variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
              {logoFileId ? "Replace logo" : "Upload logo"}
            </Button>
            <span className="text-xs text-muted-foreground">{logoStatus ?? (logoFileId ? "Logo set" : "No logo")}</span>
          </div>
        </div>
      </FormSection>
      <FormSection title="Defaults">
        <SelectField label="Time zone" name="timezone" defaultValue={firm.timezone} options={ZONES.map((z) => ({ value: z, label: z.replace("_", " ") }))} />
        <SelectField
          label="Week starts on"
          name="weekStart"
          defaultValue={firm.weekStart}
          options={[
            { value: "MON", label: "Monday" },
            { value: "SUN", label: "Sunday" },
          ]}
        />
        <TextField label="Default payment terms (days)" name="defaultPaymentTermsDays" type="number" min={0} max={365} defaultValue={firm.defaultPaymentTermsDays} />
        <div />
        <MoneyField label="Match tolerance" name="matchTolerance" defaultValue={firm.matchTolerance} required />
        <MoneyField label="Deduction tolerance" name="deductionTolerance" defaultValue={firm.deductionTolerance} required />
        <TextAreaField label="Remit-to (printed on invoices)" name="remitToText" rows={3} defaultValue={firm.remitToText ?? ""} />
      </FormSection>
      {error && <Alert variant="destructive">{error}</Alert>}
      {saved && <Alert variant="success">Saved.</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
