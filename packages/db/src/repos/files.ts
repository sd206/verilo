import { and, desc, eq } from "drizzle-orm";
import { fileScanMachine, type FileScanStatus } from "@verilo/domain";
import { file } from "../schema";
import type { Queryable } from "../client";

export type FileRow = typeof file.$inferSelect;

export async function insertFile(
  tx: Queryable,
  f: {
    id: string;
    firmId: string;
    storageKey: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
    source: "UPLOAD" | "EMAIL" | "SYSTEM";
  },
): Promise<FileRow> {
  const [row] = await tx
    .insert(file)
    .values({ ...f, createdBy: f.uploadedBy, scanStatus: fileScanMachine.initial })
    .returning();
  return row!;
}

export async function getFile(tx: Queryable, firmId: string, id: string): Promise<FileRow | null> {
  const [row] = await tx
    .select()
    .from(file)
    .where(and(eq(file.firmId, firmId), eq(file.id, id)));
  return row ?? null;
}

export async function listFiles(tx: Queryable, firmId: string, opts: { uploadedBy?: string } = {}) {
  const conds = [eq(file.firmId, firmId)];
  if (opts.uploadedBy) conds.push(eq(file.uploadedBy, opts.uploadedBy));
  return tx
    .select()
    .from(file)
    .where(and(...conds))
    .orderBy(desc(file.createdAt))
    .limit(200);
}

/** Status change through the domain state machine (R6). */
export async function recordScanResult(
  tx: Queryable,
  firmId: string,
  id: string,
  from: FileScanStatus,
  to: FileScanStatus,
  patch: { sha256: string; sizeBytes: number },
): Promise<FileRow> {
  const next = fileScanMachine.transition(from, to);
  const [row] = await tx
    .update(file)
    .set({ scanStatus: next, sha256: patch.sha256, sizeBytes: patch.sizeBytes })
    .where(and(eq(file.firmId, firmId), eq(file.id, id), eq(file.scanStatus, from)))
    .returning();
  if (!row) throw new Error("file scan status changed concurrently");
  return row;
}
