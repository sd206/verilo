import type { Readable } from "node:stream";

export interface SignedUpload {
  url: string;
  method: "PUT";
  /** Headers the browser must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

/** One storage interface: Cloud Storage in staging/production, MinIO (S3 API) locally (section 3). */
export interface ObjectStorage {
  createSignedUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;
  createSignedDownload(input: { key: string; filename: string; expiresInSeconds?: number }): Promise<string>;
  head(key: string): Promise<ObjectInfo | null>;
  getStream(key: string): Promise<Readable>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}
