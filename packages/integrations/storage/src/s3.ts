import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, NotFound } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { ObjectInfo, ObjectStorage, SignedUpload } from "./types";
import { contentDisposition } from "./policy";

export interface S3StorageOptions {
  bucket: string;
  /** Endpoint the app uses (e.g. http://minio:9000 in docker). */
  endpoint: string;
  /** Endpoint the browser uses for signed URLs (e.g. http://localhost:9000). Defaults to endpoint. */
  publicEndpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Local development adapter for MinIO. Not used in staging or production. */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  constructor(private readonly opts: S3StorageOptions) {
    const base = {
      region: opts.region ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
    };
    this.client = new S3Client({ ...base, endpoint: opts.endpoint });
    this.signer = new S3Client({ ...base, endpoint: opts.publicEndpoint ?? opts.endpoint });
  }

  async createSignedUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload> {
    const expiresIn = input.expiresInSeconds ?? 600;
    // Content-Length and Content-Type are signed, so the browser must upload exactly what it declared.
    const cmd = new PutObjectCommand({
      Bucket: this.opts.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const url = await getSignedUrl(this.signer, cmd, {
      expiresIn,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async createSignedDownload(input: { key: string; filename: string; expiresInSeconds?: number }): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.opts.bucket,
      Key: input.key,
      ResponseContentDisposition: contentDisposition(input.filename),
    });
    return getSignedUrl(this.signer, cmd, { expiresIn: input.expiresInSeconds ?? 300 });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === "NotFound") return null;
      throw e;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return res.Body as Readable;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
