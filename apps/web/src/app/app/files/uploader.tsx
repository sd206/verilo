"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { completeUploadAction, requestUploadAction } from "@/server/actions/files";

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; text: string; tone: "success" | "destructive" } | { kind: "error"; text: string };

export function Uploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function upload(file: File) {
    setStatus({ kind: "busy", text: "Uploading…" });
    const req = await requestUploadAction({ filename: file.name, contentType: file.type, sizeBytes: file.size });
    if (!req.ok) return setStatus({ kind: "error", text: req.error });
    const put = await fetch(req.data.upload.url, { method: "PUT", headers: req.data.upload.headers, body: file });
    if (!put.ok) return setStatus({ kind: "error", text: "Upload to storage failed. Try again." });
    setStatus({ kind: "busy", text: "Scanning for viruses…" });
    const done = await completeUploadAction({ fileId: req.data.fileId });
    if (!done.ok) return setStatus({ kind: "error", text: done.error });
    setStatus(
      done.data.scanStatus === "CLEAN"
        ? { kind: "done", text: `${file.name} is clean and saved.`, tone: "success" }
        : { kind: "done", text: `${file.name} failed the virus scan and has been blocked.`, tone: "destructive" },
    );
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={input}
          data-testid="file-input"
          aria-label="Upload a file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          disabled={status.kind === "busy"}
        />
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={status.kind === "busy"}>
          Choose a file to upload
        </Button>
      </div>
      {status.kind === "busy" && <Alert>{status.text}</Alert>}
      {status.kind === "done" && (
        <Alert variant={status.tone} data-testid="upload-result">
          {status.text}
        </Alert>
      )}
      {status.kind === "error" && <Alert variant="destructive">{status.text}</Alert>}
    </div>
  );
}
