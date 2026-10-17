"use client";

import { completeUploadAction, requestUploadAction } from "@/server/actions/files";

const BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** Some browsers report HEIC (and other types) as "", so fall back to the extension. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  return BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export type UploadOutcome = { ok: true; fileId: string } | { ok: false; error: string };

/** requestUpload → PUT to the signed URL → completeUpload (virus scan). */
export async function uploadScanned(file: File, onStage?: (s: string) => void): Promise<UploadOutcome> {
  onStage?.("Uploading…");
  const contentType = contentTypeOf(file);
  const req = await requestUploadAction({ filename: file.name, contentType, sizeBytes: file.size });
  if (!req.ok) return { ok: false, error: req.error };
  const put = await fetch(req.data.upload.url, { method: "PUT", headers: req.data.upload.headers, body: file });
  if (!put.ok) return { ok: false, error: "Upload to storage failed. Try again." };
  onStage?.("Checking the file…");
  const done = await completeUploadAction({ fileId: req.data.fileId });
  if (!done.ok) return { ok: false, error: done.error };
  if (done.data.scanStatus !== "CLEAN") return { ok: false, error: `${file.name} failed the virus scan and was blocked.` };
  return { ok: true, fileId: req.data.fileId };
}
