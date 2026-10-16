"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { switchFirmAction } from "@/server/actions/auth";

export function FirmSwitcher({
  firms,
  activeFirmId,
}: {
  firms: { firmId: string; displayName: string; role: string }[];
  activeFirmId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (firms.length <= 1) {
    return <span className="truncate text-sm font-medium">{firms[0]?.displayName}</span>;
  }
  return (
    <select
      aria-label="Switch firm"
      className="h-8 max-w-[14rem] truncate rounded-md border border-input bg-card px-2 text-sm"
      value={activeFirmId}
      disabled={pending}
      onChange={(e) => {
        const firmId = e.target.value;
        start(async () => {
          const r = await switchFirmAction({ firmId });
          if (r.ok) {
            router.push(r.data.next);
            router.refresh();
          }
        });
      }}
    >
      {firms.map((f) => (
        <option key={f.firmId} value={f.firmId}>
          {f.displayName}
        </option>
      ))}
    </select>
  );
}
