/** Section 17: presigned uploads with size (≤ 15 MB per file) and type limits. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
} as const satisfies Record<string, readonly string[]>;

export type AllowedUploadType = keyof typeof ALLOWED_UPLOAD_TYPES;

export function uploadPolicyError(input: { filename: string; contentType: string; sizeBytes: number }): string | null {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return "File is empty";
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return "File is larger than 15 MB";
  const exts = (ALLOWED_UPLOAD_TYPES as Record<string, readonly string[]>)[input.contentType];
  if (!exts) return "File type not allowed. Upload a PDF, PNG, JPEG, WebP or HEIC file.";
  const lower = input.filename.toLowerCase();
  if (!exts.some((e) => lower.endsWith(e))) return "File extension does not match its type";
  return null;
}

/** Storage keys are generated server-side; filenames never become part of the key. */
export function storageKeyFor(firmId: string, fileId: string): string {
  return `firms/${firmId}/files/${fileId}`;
}

/** Safe value for Content-Disposition. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
