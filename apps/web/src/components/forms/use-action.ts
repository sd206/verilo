"use client";

import { useState, useTransition } from "react";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** Runs a server action and keeps pending/error state for a form. */
export function useAction<I, T>(action: (input: I) => Promise<Result<T>>) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function submit(input: I, onSuccess: (data: T) => void) {
    setError(null);
    start(async () => {
      try {
        const r = await action(input);
        if (r.ok) onSuccess(r.data);
        else setError(r.error);
      } catch {
        setError("Something went wrong. Try again.");
      }
    });
  }
  return { pending, error, setError, submit };
}

export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(Array.from(new FormData(form).entries()).map(([k, v]) => [k, String(v)]));
}

/**
 * Form values for master-data actions: unchecked checkboxes become false (FormData omits
 * them), and empty optional fields become null.
 */
export function formInput(form: HTMLFormElement): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const el of Array.from(form.elements)) {
    const input = el as HTMLInputElement;
    if (!input.name || input.disabled) continue;
    if (input.type === "checkbox") out[input.name] = input.checked;
    else if (input.type !== "submit" && input.type !== "button" && input.type !== "file") out[input.name] = input.value === "" ? null : input.value;
  }
  return out;
}
