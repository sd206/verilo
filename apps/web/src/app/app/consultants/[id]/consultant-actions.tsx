"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { archiveConsultantAction, setConsultantStatusAction } from "@/server/actions/master";
import { ConsultantForm, type ConsultantFormValues } from "../consultant-form";

export function ConsultantActions({
  consultant,
  status,
  subVendors,
}: {
  consultant: ConsultantFormValues;
  status: string;
  subVendors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  if (editing) return <ConsultantForm initial={consultant} subVendors={subVendors} onDone={() => setEditing(false)} />;
  const name = `${consultant.firstName} ${consultant.lastName}`;
  const next = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <ConfirmButton
        label={next === "INACTIVE" ? "Mark inactive" : "Mark active"}
        title={next === "INACTIVE" ? `Mark ${name} inactive?` : `Mark ${name} active?`}
        description={
          next === "INACTIVE"
            ? "They stop appearing as an active consultant. Engagements and history are unchanged."
            : "They appear as an active consultant again."
        }
        confirmLabel="Confirm"
        onConfirm={async () => {
          const r = await setConsultantStatusAction({ consultantId: consultant.id, status: next });
          if (r.ok) router.refresh();
          return r.ok ? { ok: true } : r;
        }}
      />
      <ConfirmButton
        label="Archive"
        variant="destructive"
        title={`Archive ${name}?`}
        description="They disappear from lists. Only possible when all their engagements have ended. History stays."
        confirmLabel="Archive consultant"
        onConfirm={async () => {
          const r = await archiveConsultantAction({ consultantId: consultant.id });
          if (r.ok) router.push("/app/consultants");
          return r.ok ? { ok: true } : r;
        }}
      />
    </div>
  );
}
