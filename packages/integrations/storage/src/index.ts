import type { ObjectStorage } from "./types";
import { GcsStorage } from "./gcs";
import { S3Storage } from "./s3";
import { ClamAvHttpScanner, type VirusScanner } from "./scan";

export * from "./types";
export * from "./policy";
export * from "./scan";
export { GcsStorage } from "./gcs";
export { S3Storage } from "./s3";

export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  if (env.STORAGE_DRIVER === "gcs" || (!env.STORAGE_DRIVER && env.FILES_BUCKET && !env.S3_ENDPOINT)) {
    if (!env.FILES_BUCKET) throw new Error("FILES_BUCKET is required");
    return new GcsStorage(env.FILES_BUCKET);
  }
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is required for the S3 storage driver`);
    return v;
  };
  return new S3Storage({
    bucket: need("FILES_BUCKET"),
    endpoint: need("S3_ENDPOINT"),
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  });
}

export function scannerFromEnv(env: NodeJS.ProcessEnv = process.env): VirusScanner {
  if (!env.CLAMAV_URL) throw new Error("CLAMAV_URL is required");
  return new ClamAvHttpScanner(env.CLAMAV_URL, { useIdToken: env.CLAMAV_AUTH === "google" });
}
