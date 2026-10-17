"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/confirm-button";
import { CheckboxField, SelectField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import {
  addContactAction,
  archiveContactAction,
  archivePartyAction,
  archivePartyDocumentAction,
  attachPartyDocumentAction,
} from "@/server/actions/master";
import { completeUploadAction, requestUploadAction } from "@/server/actions/files";
import { DOC_TYPE_LABELS } from "@/lib/utils";

export function ArchivePartyButton({ partyId, name }: { partyId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Archive"
      variant="destructive"
      title={`Archive ${name}?`}
      description="It disappears from lists and can't be picked for new engagements. Its history stays. Parties used by active engagements or consultants can't be archived."
      confirmLabel="Archive party"
      onConfirm={async () => {
        const r = await archivePartyAction({ partyId });
        if (r.ok) router.push("/app/parties");
        return r.ok ? { ok: true } : r;
      }}
    />
  );
}

export function ArchiveRowButton({ kind, id, name }: { kind: "contact" | "document"; id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      label="Remove"
      variant="ghost"
      title={`Remove ${name}?`}
      description={`The ${kind} is archived and no longer shown. Nothing is deleted.`}
      confirmLabel="Remove"
      onConfirm={async () => {
        const r = kind === "contact" ? await archiveContactAction({ contactId: id }) : await archivePartyDocumentAction({ documentId: id });
        if (r.ok) router.refresh();
        return r.ok ? { ok: true } : r;
      }}
    />
  );
}

export function AddContactForm({ partyId }: { partyId: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(addContactAction);
  return (
    <form
      className="grid gap-3 rounded-md border border-dashed border-border p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        submit({ ...formInput(form), partyId }, () => {
          form.reset();
          router.refresh();
        });
      }}
    >
      <TextField label="Name" name="name" required />
      <TextField label="Role" name="roleLabel" placeholder="AP clerk" />
      <TextField label="Email" name="email" type="email" />
      <TextField label="Phone" name="phone" />
      <Button type="submit" variant="outline" disabled={pending}>
        Add contact
      </Button>
      {error && <Alert variant="destructive" className="md:col-span-5">{error}</Alert>}
    </form>
  );
}

/** Upload (signed URL → virus scan) then attach to the party. */
export function AttachDocumentForm({ partyId }: { partyId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: HTMLFormElement) {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file");
    setPending(true);
    setError(null);
    try {
      setStatus("Uploading…");
      const req = await requestUploadAction({ filename: file.name, contentType: file.type, sizeBytes: file.size });
      if (!req.ok) throw new Error(req.error);
      const put = await fetch(req.data.upload.url, { method: "PUT", headers: req.data.upload.headers, body: file });
      if (!put.ok) throw new Error("Upload to storage failed. Try again.");
      setStatus("Scanning for viruses…");
      const done = await completeUploadAction({ fileId: req.data.fileId });
      if (!done.ok) throw new Error(done.error);
      if (done.data.scanStatus !== "CLEAN") throw new Error("The file failed the virus scan and was blocked.");
      const att = await attachPartyDocumentAction({ ...formInput(form), partyId, fileId: req.data.fileId });
      if (!att.ok) throw new Error(att.error);
      form.reset();
      setStatus(null);
      router.refresh();
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-md border border-dashed border-border p-4 md:grid-cols-4 md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(e.currentTarget);
      }}
    >
      <SelectField label="Type" name="docType" options={Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
      <TextField label="Effective" name="effectiveDate" type="date" />
      <TextField label="Expires" name="expiryDate" type="date" />
      <div className="grid gap-1.5">
        <label className="text-sm font-medium" htmlFor="doc-file">
          File
        </label>
        <input id="doc-file" ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" className="text-sm" data-testid="doc-file" />
      </div>
      <CheckboxField label="Required for payment" name="requiredForPayment" />
      <div className="flex items-center gap-3 md:col-span-3">
        <Button type="submit" variant="outline" disabled={pending}>
          Upload document
        </Button>
        {status && <span className="text-sm text-muted-foreground">{status}</span>}
      </div>
      {error && <Alert variant="destructive" className="md:col-span-4">{error}</Alert>}
    </form>
  );
}
