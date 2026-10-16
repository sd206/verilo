import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isFileViewable } from "@verilo/domain";
import {
  can,
  ConflictError,
  enforceRateLimit,
  NotFoundError,
  requirePermission,
  ValidationError,
  type FirmContext,
} from "@verilo/auth";
import { getFile, insertFile, listFiles as listFilesRepo, recordScanResult, withTenant, writeAudit, type FileRow } from "@verilo/db";
import { MAX_UPLOAD_BYTES, storageKeyFor, uploadPolicyError, type SignedUpload } from "@verilo/storage";
import type { Deps } from "../deps";
import { parse, uuid } from "./common";

export interface FileView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: FileRow["scanStatus"];
  uploadedBy: string | null;
  createdAt: Date;
}

const view = (f: FileRow): FileView => ({
  id: f.id,
  filename: f.filename,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  scanStatus: f.scanStatus,
  uploadedBy: f.uploadedBy,
  createdAt: f.createdAt,
});

/** Consultants see only their own uploads; other roles see the firm's files (R8). */
function canSee(ctx: FirmContext, f: FileRow): boolean {
  return can(ctx.role, "VIEW_ALL_FILES") || f.uploadedBy === ctx.userId;
}

// ---------------------------------------------------------------------------
// requestUpload → browser PUTs to the signed URL → completeUpload scans it
// ---------------------------------------------------------------------------

const requestSchema = z.strictObject({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export async function requestUpload(
  d: Deps,
  ctx: FirmContext,
  input: unknown,
): Promise<{ fileId: string; upload: SignedUpload }> {
  requirePermission(ctx, "UPLOAD_FILES");
  const data = parse(requestSchema, input);
  const policyError = uploadPolicyError(data);
  if (policyError) throw new ValidationError(policyError);
  await enforceRateLimit(d.db, "upload", ctx.userId);

  const fileId = randomUUID();
  const storageKey = storageKeyFor(ctx.firmId, fileId);
  await withTenant(d.db, ctx, async (tx) => {
    const f = await insertFile(tx, {
      id: fileId,
      firmId: ctx.firmId,
      storageKey,
      filename: data.filename,
      mimeType: data.contentType,
      sizeBytes: data.sizeBytes,
      uploadedBy: ctx.userId,
      source: "UPLOAD",
    });
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "file",
      entityId: f.id,
      action: "create",
      after: view(f),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  });
  const upload = await d.storage.createSignedUpload({
    key: storageKey,
    contentType: data.contentType,
    sizeBytes: data.sizeBytes,
  });
  return { fileId, upload };
}

export async function completeUpload(d: Deps, ctx: FirmContext, input: unknown): Promise<FileView> {
  requirePermission(ctx, "UPLOAD_FILES");
  const { fileId } = parse(z.strictObject({ fileId: uuid }), input);

  const f = await withTenant(d.db, ctx, (tx) => getFile(tx, ctx.firmId, fileId));
  // Only the uploader completes their own upload; anything else looks like a missing file (T12).
  if (!f || f.uploadedBy !== ctx.userId) throw new NotFoundError();
  if (f.scanStatus !== "PENDING") return view(f);

  const info = await d.storage.head(f.storageKey);
  if (!info) throw new ValidationError("The upload didn't reach storage. Try again.");
  if (info.sizeBytes > MAX_UPLOAD_BYTES || info.sizeBytes !== f.sizeBytes) {
    throw new ValidationError("The uploaded file doesn't match what was declared");
  }

  const result = await d.scanner.scan(await d.storage.getStream(f.storageKey));
  const updated = await withTenant(d.db, ctx, async (tx) => {
    const row = await recordScanResult(tx, ctx.firmId, f.id, "PENDING", result.status, {
      sha256: result.sha256,
      sizeBytes: result.sizeBytes,
    });
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "file",
      entityId: f.id,
      action: "status_change",
      before: { scanStatus: "PENDING" },
      after: { scanStatus: row.scanStatus, sha256: row.sha256, signature: result.signature },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return row;
  });
  if (result.status === "INFECTED") {
    d.log.warn({ firm_id: ctx.firmId, file_id: f.id, signature: result.signature }, "infected upload quarantined");
  }
  return view(updated);
}

export async function listFiles(d: Deps, ctx: FirmContext): Promise<FileView[]> {
  requirePermission(ctx, "UPLOAD_FILES");
  const rows = await withTenant(d.db, ctx, (tx) =>
    listFilesRepo(tx, ctx.firmId, can(ctx.role, "VIEW_ALL_FILES") ? {} : { uploadedBy: ctx.userId }),
  );
  return rows.map(view);
}

/** GET /api/files/:id/download → short-lived signed URL, only for CLEAN files (section 17). */
export async function getDownloadUrl(d: Deps, ctx: FirmContext, input: unknown): Promise<string> {
  const { fileId } = parse(z.strictObject({ fileId: uuid }), input);
  const f = await withTenant(d.db, ctx, (tx) => getFile(tx, ctx.firmId, fileId));
  if (!f || !canSee(ctx, f)) throw new NotFoundError();
  if (!isFileViewable(f.scanStatus)) throw new ConflictError("This file isn't available until its virus scan is clean");
  return d.storage.createSignedDownload({ key: f.storageKey, filename: f.filename });
}
