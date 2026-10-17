"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/confirm-button";
import { MoneyField, SelectField, TextField } from "@/components/forms/controls";
import { formInput, useAction } from "@/components/forms/use-action";
import { addPurchaseOrderAction, addRateAction, endRateAction, setEngagementStatusAction } from "@/server/actions/master";

export function AddRateForm({ engagementId, contractor, defaultFrom }: { engagementId: string; contractor: boolean; defaultFrom: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(addRateAction);
  return (
    <form
      className="grid gap-3 rounded-md border border-dashed border-border p-4 md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        submit({ ...formInput(form), engagementId }, () => {
          form.reset();
          router.refresh();
        });
      }}
    >
      <SelectField label="Side" name="side" options={contractor ? [{ value: "BILL", label: "Bill" }, { value: "PAY", label: "Pay" }] : [{ value: "BILL", label: "Bill" }]} />
      <SelectField
        label="Kind"
        name="rateKind"
        options={[
          { value: "REGULAR", label: "Regular" },
          { value: "OVERTIME", label: "Overtime" },
          { value: "HOLIDAY", label: "Holiday" },
        ]}
      />
      <MoneyField label="Rate per hour" name="rate" required />
      <TextField label="Effective from" name="effectiveFrom" type="date" defaultValue={defaultFrom} required />
      <TextField label="Effective to" name="effectiveTo" type="date" hint="Optional (inclusive)" />
      <Button type="submit" variant="outline" disabled={pending}>
        Add rate
      </Button>
      {error && (
        <Alert variant="destructive" className="md:col-span-6" data-testid="rate-error">
          {error}
        </Alert>
      )}
    </form>
  );
}

/** Ending a rate is financial: confirm with the exact date. */
export function EndRateButton({ rateId, label, from }: { rateId: string; label: string; from: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const { pending, error, submit } = useAction(endRateAction);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.showModal()}>
        End rate
      </Button>
      <dialog ref={ref} className="m-auto w-full max-w-md rounded-lg border border-border bg-card p-0 shadow-xl backdrop:bg-black/40">
        <form
          className="grid gap-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ rateId, effectiveTo: date }, () => {
              ref.current?.close();
              router.refresh();
            });
          }}
        >
          <h2 className="text-lg font-semibold">End the {label}?</h2>
          <p className="text-sm text-muted-foreground">
            The rate stops applying after the last day you pick (inclusive). Hours after that day have no rate until you add a new one. An end date can only be moved earlier later.
          </p>
          <label className="grid gap-1.5 text-sm font-medium">
            Last day at this rate
            <Input type="date" min={from} value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !date}>
              End rate
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function AddPurchaseOrderForm({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const { pending, error, submit } = useAction(addPurchaseOrderAction);
  return (
    <form
      className="grid gap-3 rounded-md border border-dashed border-border p-4 md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        submit({ ...formInput(form), engagementId }, () => {
          form.reset();
          router.refresh();
        });
      }}
    >
      <TextField label="PO number" name="poNumber" required />
      <MoneyField label="Amount" name="amount" />
      <TextField label="Start" name="startDate" type="date" />
      <TextField label="End" name="endDate" type="date" />
      <TextField label="Alerts at (%)" name="alertThresholds" defaultValue="75, 90, 100" />
      <Button type="submit" variant="outline" disabled={pending}>
        Add PO
      </Button>
      {error && <Alert variant="destructive" className="md:col-span-6">{error}</Alert>}
    </form>
  );
}

export function EngagementStatusActions({
  engagementId,
  status,
  endDate,
  today,
}: {
  engagementId: string;
  status: string;
  endDate: string | null;
  today: string;
}) {
  const router = useRouter();
  const [end, setEnd] = useState(endDate ?? today);
  if (status === "DRAFT") {
    return (
      <ConfirmButton
        label="Activate"
        variant="default"
        title="Activate this engagement?"
        description="It becomes active: timesheets can be captured and it counts toward invoicing. A regular bill rate covering the start date is required."
        confirmLabel="Activate"
        onConfirm={async () => {
          const r = await setEngagementStatusAction({ engagementId, status: "ACTIVE" });
          if (r.ok) router.refresh();
          return r.ok ? { ok: true } : r;
        }}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input type="date" aria-label="End date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-40" />
      <ConfirmButton
        label="End engagement"
        variant="destructive"
        title="End this engagement?"
        description={`It ends on ${end}. Ended engagements can't be edited or reopened and get no new rates or POs.`}
        confirmLabel="End engagement"
        onConfirm={async () => {
          const r = await setEngagementStatusAction({ engagementId, status: "ENDED", endDate: end });
          if (r.ok) router.refresh();
          return r.ok ? { ok: true } : r;
        }}
      />
    </div>
  );
}
