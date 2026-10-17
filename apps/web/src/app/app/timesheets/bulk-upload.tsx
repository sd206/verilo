"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { uploadScanned } from "@/lib/upload";
import { uploadEvidenceAction } from "@/server/actions/timesheets";

/** Bulk upload (section 12, 8.6): screenshots without a timesheet; the AI read matches them. */
export function BulkUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function run(files: FileList) {
    let ok = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      setStatus(`${f.name}: uploading…`);
      const up = await uploadScanned(f);
      if (!up.ok) {
        errors.push(`${f.name}: ${up.error}`);
        continue;
      }
      const r = await uploadEvidenceAction({ fileId: up.fileId });
      if (r.ok) ok++;
      else errors.push(`${f.name}: ${r.error}`);
    }
    setStatus(`${ok} uploaded; they'll be matched automatically.${errors.length ? ` ${errors.join(" ")}` : ""}`);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        aria-label="Bulk upload screenshots"
        data-testid="bulk-input"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/*"
        onChange={(e) => e.target.files?.length && void run(e.target.files)}
      />
      <Button type="button" onClick={() => input.current?.click()}>
        Upload screenshots
      </Button>
      {status && <span className="max-w-xs text-xs text-muted-foreground" role="status">{status}</span>}
    </div>
  );
}
