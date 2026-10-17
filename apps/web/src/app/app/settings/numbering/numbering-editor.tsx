"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/forms/use-action";
import { previewInvoiceNumberAction, setNumberingPatternAction } from "@/server/actions/master";

const TOKENS = [
  ["{CLIENT}", "Bill-to party code"],
  ["{YYYY}", "Invoice year"],
  ["{YY}", "Two-digit year"],
  ["{MM}", "Invoice month"],
  ["{SEQ:4}", "Sequence, zero-padded (1–9 digits)"],
] as const;

export function NumberingEditor({
  pattern: initialPattern,
  seqReset: initialReset,
  clients,
  today,
}: {
  pattern: string;
  seqReset: string;
  clients: { id: string; name: string; code: string }[];
  today: string;
}) {
  const router = useRouter();
  const [pattern, setPattern] = useState(initialPattern);
  const [seqReset, setSeqReset] = useState(initialReset);
  const [client, setClient] = useState(clients[0]?.id ?? "");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [preview, setPreview] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const { pending, error, submit } = useAction(setNumberingPatternAction);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await previewInvoiceNumberAction({ pattern, clientPartyId: client || null, invoiceDate });
      if (cancelled) return;
      if (!r.ok) setPreview({ ok: false, text: r.error });
      else setPreview(r.data.ok ? { ok: true, text: r.data.number } : { ok: false, text: r.data.error });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pattern, client, invoiceDate]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor="pattern">Pattern</Label>
          <Input
            id="pattern"
            className="font-mono"
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="seqReset">Sequence resets</Label>
          <Select id="seqReset" value={seqReset} onChange={(e) => setSeqReset(e.target.value)}>
            <option value="NEVER">Never</option>
            <option value="YEARLY">Every year</option>
            <option value="MONTHLY">Every month</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {TOKENS.map(([t, help]) => (
          <button
            key={t}
            type="button"
            title={help}
            className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs hover:bg-accent"
            onClick={() => setPattern((p) => p + t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid gap-4 rounded-md bg-muted p-4 md:grid-cols-3 md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="client">Preview for</Label>
          <Select id="client" value={client} onChange={(e) => setClient(e.target.value)}>
            {clients.length === 0 && <option value="">Sample client (CLIENT)</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invoiceDate">Invoice date</Label>
          <Input id="invoiceDate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">First number</span>
          <output
            data-testid="numbering-preview"
            className={`font-mono text-lg font-semibold ${preview && !preview.ok ? "text-destructive text-sm font-normal" : ""}`}
          >
            {preview?.text ?? "…"}
          </output>
        </div>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {saved && <Alert variant="success">Numbering pattern saved.</Alert>}
      <div>
        <Button
          type="button"
          disabled={pending || (preview !== null && !preview.ok)}
          onClick={() =>
            submit({ pattern, seqReset }, () => {
              setSaved(true);
              router.refresh();
            })
          }
        >
          Save pattern
        </Button>
      </div>
    </div>
  );
}
