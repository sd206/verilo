import { Storage } from "@google-cloud/storage";
import type { Readable } from "node:stream";
import type { ObjectInfo, ObjectStorage, SignedUpload } from "./types";
import { contentDisposition, MAX_UPLOAD_BYTES } from "./policy";

/**
 * Cloud Storage adapter for staging and production (section 24.3). Uses the service
 * account's identity (no HMAC or JSON keys); V4 signing goes through the IAM signBlob API,
 * so the runtime service account needs Service Account Token Creator on itself.
 */
export class GcsStorage implements ObjectStorage {
  private readonly storage = new Storage();
  constructor(private readonly bucketName: string) {}

  private get bucket() {
    return this.storage.bucket(this.bucketName);
  }

  async createSignedUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload> {
    const expiresIn = input.expiresInSeconds ?? 600;
    const expires = Date.now() + expiresIn * 1000;
    const range = `0,${Math.min(input.sizeBytes, MAX_UPLOAD_BYTES)}`;
    const [url] = await this.bucket.file(input.key).getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType: input.contentType,
      extensionHeaders: { "x-goog-content-length-range": range },
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType, "x-goog-content-length-range": range },
      expiresAt: new Date(expires),
    };
  }

  async createSignedDownload(input: { key: string; filename: string; expiresInSeconds?: number }): Promise<string> {
    const [url] = await this.bucket.file(input.key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + (input.expiresInSeconds ?? 300) * 1000,
      responseDisposition: contentDisposition(input.filename),
    });
    return url;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const f = this.bucket.file(key);
    const [exists] = await f.exists();
    if (!exists) return null;
    const [meta] = await f.getMetadata();
    return { sizeBytes: Number(meta.size ?? 0), contentType: meta.contentType ?? null };
  }

  async getStream(key: string): Promise<Readable> {
    return this.bucket.file(key).createReadStream();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(key).save(body, { contentType, resumable: false });
  }
}
