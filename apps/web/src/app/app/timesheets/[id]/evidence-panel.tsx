"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StatusChip } from "@/components/status-chip";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { uploadScanned } from "@/lib/upload";
import { removeEvidenceAction, uploadEvidenceAction } from "@/server/actions/timesheets";

export type EvidenceView = {
  id: string;
  filename: string;
  source: string;
  pages: string[];
  extraction: { status: string; error: string | null } | null;
  canRemove: boolean;
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/*";

export function EvidencePanel({
  timesheetId,
  evidence,
  canAttach,
  required,
  mode,
}: {
  timesheetId: string;
  evidence: EvidenceView[];
  canAttach: boolean;
  required: boolean;
  mode: "compact" | "viewer";
}) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(1);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const f of Array.from(files)) {
      const up = await uploadScanned(f, (s) => setBusy(`${f.name}: ${s}`));
      if (!up.ok) {
        setError(up.error);
        continue;
      }
      setBusy(`${f.name}: attaching…`);
      const r = await uploadEvidenceAction({ timesheetId, fileId: up.fileId });
      if (!r.ok) setError(r.error);
    }
    setBusy(null);
    if (camera.current) camera.current.value = "";
    if (picker.current) picker.current.value = "";
    router.refresh();
  }

  const pages = evidence.flatMap((e) => e.pages.map((url, i) => ({ url, label: e.pages.length > 1 ? `${e.filename} · p${i + 1}` : e.filename, ev: e })));
  const current = pages[Math.min(active, Math.max(0, pages.length - 1))];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{mode === "viewer" ? "Evidence" : "Approved timesheet screenshot"}</CardTitle>
        {mode === "viewer" && current && (
          <div className="flex items-center gap-1" aria-label="Zoom">
            <Button type="button" size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
              −
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">
              +
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {evidence.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {required ? "Your client's approval is needed: take a photo of the approved VMS timesheet or upload the screenshot." : "No files attached."}
          </p>
        )}

        {mode === "viewer" && current && (
          <div className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40" data-testid="evidence-viewer">
            <img src={current.url} alt={current.label} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block" />
          </div>
        )}

        <div className="flex flex-wrap gap-2" data-testid="evidence-list">
          {evidence.map((e) => {
            const idx = pages.findIndex((p) => p.ev.id === e.id);
            return (
              <div key={e.id} className={cn("w-32 overflow-hidden rounded-md border", mode === "viewer" && idx === active ? "border-primary ring-2 ring-primary/30" : "border-border")}>
                <button
                  type="button"
                  className="block h-24 w-full bg-muted"
                  onClick={() => idx >= 0 && setActive(idx)}
                  aria-label={`Show ${e.filename}`}
                >
                  {e.pages[0] ? (
                    <img src={e.pages[0]} alt="" className="h-24 w-full object-cover object-top" />
                  ) : (
                    <span className="text-xs text-muted-foreground">{e.filename.split(".").pop()?.toUpperCase()}</span>
                  )}
                </button>
                <div className="grid gap-1 p-1.5">
                  <span className="truncate text-xs" title={e.filename}>
                    {e.filename}
                  </span>
                  <div className="flex items-center justify-between gap-1">
                    {e.extraction ? <StatusChip status={e.extraction.status} /> : <span className="text-xs text-muted-foreground">Stored</span>}
                    {e.canRemove && (
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline"
                        onClick={async () => {
                          const r = await removeEvidenceAction({ evidenceId: e.id });
                          if (!r.ok) setError(r.error);
                          router.refresh();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {canAttach && (
          <div className="grid grid-cols-2 gap-2">
            <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => void add(e.target.files)} />
            <input ref={picker} type="file" accept={ACCEPT} multiple className="sr-only" aria-label="Upload a screenshot" data-testid="evidence-input" onChange={(e) => void add(e.target.files)} />
            <Button type="button" variant="outline" className="h-12" disabled={!!busy} onClick={() => camera.current?.click()}>
              Take photo
            </Button>
            <Button type="button" variant="outline" className="h-12" disabled={!!busy} onClick={() => picker.current?.click()}>
              Upload file
            </Button>
          </div>
        )}
        {busy && <Alert>{busy}</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>
    </Card>
  );
}
