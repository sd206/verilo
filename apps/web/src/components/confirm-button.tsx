"use client";

import { useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * Every destructive or financial action asks first, stating exactly what will happen
 * (13 "UI rules").
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = "outline",
  size = "sm",
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => ref.current?.showModal()}>
        {label}
      </Button>
      <dialog ref={ref} className="m-auto w-full max-w-md rounded-lg border border-border bg-card p-0 shadow-xl backdrop:bg-black/40">
        <div className="grid gap-4 p-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                const r = await onConfirm();
                setPending(false);
                if (r.ok) ref.current?.close();
                else setError(r.error);
              }}
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
