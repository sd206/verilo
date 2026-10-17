"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveCheckAction } from "@/server/actions/timesheets";

type Check = {
  id: string;
  code: string;
  severity: string;
  message: string;
  resolved: boolean;
  resolvedByName: string | null;
  resolutionReason: string | null;
};

const ICON: Record<string, string> = { BLOCK: "⛔", WARN: "⚠️", INFO: "ℹ️" };
const TITLE: Record<string, string> = { BLOCK: "Must be fixed or resolved", WARN: "Worth a look", INFO: "For your information" };

export function ChecksPanel({ checks, canResolve }: { checks: Check[]; canResolve: boolean }) {
  if (checks.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-success" data-testid="checks-clear">
          ✓ No problems found.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Checks</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3" data-testid="checks">
        {checks.map((c) => (
          <CheckRow key={c.id} c={c} canResolve={canResolve} />
        ))}
      </CardContent>
    </Card>
  );
}

function CheckRow({ c, canResolve }: { c: Check; canResolve: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div
      data-check={c.code}
      className={cn(
        "rounded-md border p-3 text-sm",
        c.resolved ? "border-border bg-muted/40" : c.severity === "BLOCK" ? "border-destructive/30 bg-destructive/5" : c.severity === "WARN" ? "border-warning/30 bg-warning/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden>{c.resolved ? "✓" : ICON[c.severity]}</span>
        <div className="grid flex-1 gap-1">
          <span className="sr-only">{TITLE[c.severity]}</span>
          <span>{c.message}</span>
          {c.resolved && (
            <span className="text-xs text-muted-foreground">
              Resolved by {c.resolvedByName ?? "a reviewer"}: {c.resolutionReason}
            </span>
          )}
        </div>
        {canResolve && !c.resolved && c.severity !== "INFO" && !open && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            Resolve
          </Button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await resolveCheckAction({ checkId: c.id, reason });
              if (!r.ok) return setError(r.error);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <Input autoFocus required minLength={3} placeholder="Reason (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <Alert variant="destructive" className="mt-2">{error}</Alert>}
    </div>
  );
}
