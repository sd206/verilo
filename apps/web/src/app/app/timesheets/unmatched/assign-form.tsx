"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { assignUnmatchedFileAction } from "@/server/actions/timesheets";

export function AssignForm({ evidenceId, timesheets }: { evidenceId: string; timesheets: { id: string; label: string }[] }) {
  const router = useRouter();
  const [ts, setTs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid content-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await assignUnmatchedFileAction({ evidenceId, timesheetId: ts });
          if (!r.ok) return setError(r.error);
          router.refresh();
        });
      }}
    >
      <Select required value={ts} onChange={(e) => setTs(e.target.value)} aria-label="Timesheet">
        <option value="">Choose a timesheet…</option>
        {timesheets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={pending || !ts}>
        Assign
      </Button>
      {error && <Alert variant="destructive">{error}</Alert>}
    </form>
  );
}
