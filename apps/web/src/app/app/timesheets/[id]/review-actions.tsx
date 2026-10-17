"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { returnTimesheetAction, verifyTimesheetAction } from "@/server/actions/timesheets";

export function ReviewActions({ timesheetId, canVerify, canReturn, status }: { timesheetId: string; canVerify: boolean; canReturn: boolean; status: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 p-4">
        {canVerify && (
          <Button
            type="button"
            disabled={pending}
            data-testid="verify"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await verifyTimesheetAction({ timesheetId });
                if (!r.ok) setError(r.error);
                router.refresh();
              })
            }
          >
            Verify
          </Button>
        )}
        {canReturn && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.showModal()} data-testid="return">
            Return to consultant
          </Button>
        )}
        {error && <Alert variant="destructive" className="w-full">{error}</Alert>}
        <dialog ref={dialog} className="m-auto w-full max-w-md rounded-lg border border-border bg-card p-0 shadow-xl backdrop:bg-black/40">
          <form
            className="grid gap-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await returnTimesheetAction({ timesheetId, reason });
                if (!r.ok) return setError(r.error);
                dialog.current?.close();
                router.refresh();
              });
            }}
          >
            <h2 className="text-lg font-semibold">Return this timesheet?</h2>
            <p className="text-sm text-muted-foreground">
              The consultant is emailed your reason and can fix the hours or the screenshot{status === "VERIFIED" ? ". It will no longer be verified." : "."}
            </p>
            <Textarea required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs fixing" aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Return
              </Button>
            </div>
          </form>
        </dialog>
      </CardContent>
    </Card>
  );
}
