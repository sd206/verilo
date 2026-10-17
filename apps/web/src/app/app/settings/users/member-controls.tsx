"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/forms/use-action";
import { updateMemberAction } from "@/server/actions/master";
import { ROLE_LABELS } from "@/lib/utils";

type Member = { membershipId: string; name: string; role: string; consultantId: string | null; disabled: boolean; mfaRequired: boolean };

/** Change role, disable/enable, require MFA — each confirmed in a dialog that states the effect. */
export function MemberControls({ member, consultants }: { member: Member; consultants: { id: string; name: string }[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState(member.role);
  const [consultantId, setConsultantId] = useState(member.consultantId ?? "");
  const [mfaRequired, setMfaRequired] = useState(member.mfaRequired);
  const [disabled, setDisabled] = useState(member.disabled);
  const { pending, error, submit } = useAction(updateMemberAction);
  const mfaAlways = role === "ADMIN" || role === "FINANCE";

  const changes: string[] = [];
  if (role !== member.role) changes.push(`Role changes from ${ROLE_LABELS[member.role]} to ${ROLE_LABELS[role]}.`);
  if (disabled !== member.disabled) changes.push(disabled ? `${member.name} loses access to this firm at their next click.` : `${member.name} can sign in to this firm again.`);
  if (!mfaAlways && mfaRequired !== member.mfaRequired) changes.push(mfaRequired ? "They must set up two-step sign-in before continuing." : "Two-step sign-in becomes optional for them.");
  if (mfaAlways && role !== member.role) changes.push(`${ROLE_LABELS[role]}s must use two-step sign-in.`);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.showModal()}>
        Manage
      </Button>
      <dialog ref={ref} className="m-auto w-full max-w-md rounded-lg border border-border bg-card p-0 text-left shadow-xl backdrop:bg-black/40">
        <div className="grid gap-4 p-6">
          <h2 className="text-lg font-semibold">Manage {member.name}</h2>
          <div className="grid gap-1.5">
            <Label htmlFor={`role-${member.membershipId}`}>Role</Label>
            <Select id={`role-${member.membershipId}`} value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          {role === "CONSULTANT" && (
            <div className="grid gap-1.5">
              <Label htmlFor={`cons-${member.membershipId}`}>Consultant record</Label>
              <Select id={`cons-${member.membershipId}`} value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
                <option value="">Choose…</option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mfaAlways || mfaRequired} disabled={mfaAlways} onChange={(e) => setMfaRequired(e.target.checked)} className="size-4" />
            Require two-step sign-in {mfaAlways && <span className="text-xs text-muted-foreground">(always for {ROLE_LABELS[role]})</span>}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="size-4" />
            Disable access to this firm
          </label>
          {changes.length > 0 && (
            <Alert>
              <ul className="list-disc pl-4">
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Alert>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={disabled && !member.disabled ? "destructive" : "default"}
              disabled={pending || changes.length === 0}
              onClick={() =>
                submit(
                  {
                    membershipId: member.membershipId,
                    role,
                    consultantId: role === "CONSULTANT" ? consultantId || null : null,
                    disabled,
                    mfaRequired,
                  },
                  () => {
                    ref.current?.close();
                    router.refresh();
                  },
                )
              }
            >
              Confirm changes
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
