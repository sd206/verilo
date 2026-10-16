import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";

/**
 * Application-level encryption (R11, section 24.5).
 *
 * A KeyWrapper encrypts small secrets with the master key: Cloud KMS in staging and
 * production, a local AES key from APP_ENCRYPTION_KEY in development and tests.
 * Firm fields (EIN, bank details, QBO tokens) use envelope encryption with a per-firm
 * data key wrapped by the KeyWrapper. User TOTP secrets are wrapped directly.
 */
export interface KeyWrapper {
  wrap(plaintext: Buffer): Promise<Buffer>;
  unwrap(ciphertext: Buffer): Promise<Buffer>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function aesGcmDecrypt(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export class LocalKeyWrapper implements KeyWrapper {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  async wrap(plaintext: Buffer): Promise<Buffer> {
    return aesGcmEncrypt(this.key, plaintext);
  }
  async unwrap(ciphertext: Buffer): Promise<Buffer> {
    return aesGcmDecrypt(this.key, ciphertext);
  }
}

export class KmsKeyWrapper implements KeyWrapper {
  private readonly client = new KeyManagementServiceClient();
  constructor(private readonly keyName: string) {}
  async wrap(plaintext: Buffer): Promise<Buffer> {
    const [res] = await this.client.encrypt({ name: this.keyName, plaintext });
    return Buffer.from(res.ciphertext as Uint8Array);
  }
  async unwrap(ciphertext: Buffer): Promise<Buffer> {
    const [res] = await this.client.decrypt({ name: this.keyName, ciphertext });
    return Buffer.from(res.plaintext as Uint8Array);
  }
}

export function keyWrapperFromEnv(env: NodeJS.ProcessEnv = process.env): KeyWrapper {
  if (env.KMS_KEY_NAME) return new KmsKeyWrapper(env.KMS_KEY_NAME);
  if (env.APP_ENCRYPTION_KEY) {
    if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
      throw new Error("Use KMS_KEY_NAME in staging and production");
    }
    return new LocalKeyWrapper(env.APP_ENCRYPTION_KEY);
  }
  throw new Error("KMS_KEY_NAME or APP_ENCRYPTION_KEY must be set");
}

const VERSION = "v1";

/** Wraps a small secret directly with the master key (TOTP secrets). */
export async function encryptSecret(wrapper: KeyWrapper, plaintext: string): Promise<string> {
  return `${VERSION}:${(await wrapper.wrap(Buffer.from(plaintext, "utf8"))).toString("base64")}`;
}

export async function decryptSecret(wrapper: KeyWrapper, value: string): Promise<string> {
  const [version, b64] = value.split(":");
  if (version !== VERSION || !b64) throw new Error("unknown ciphertext format");
  return (await wrapper.unwrap(Buffer.from(b64, "base64"))).toString("utf8");
}

/** Per-firm data key: returns the plaintext key (keep in memory only) and its wrapped form for the DB. */
export async function newFirmDataKey(wrapper: KeyWrapper): Promise<{ key: Buffer; wrapped: string }> {
  const key = randomBytes(32);
  return { key, wrapped: (await wrapper.wrap(key)).toString("base64") };
}

const dataKeyCache = new Map<string, { key: Buffer; expires: number }>();
const DATA_KEY_TTL_MS = 5 * 60_000;

export async function unwrapFirmDataKey(wrapper: KeyWrapper, firmId: string, wrapped: string): Promise<Buffer> {
  const hit = dataKeyCache.get(firmId);
  if (hit && hit.expires > Date.now()) return hit.key;
  const key = await wrapper.unwrap(Buffer.from(wrapped, "base64"));
  dataKeyCache.set(firmId, { key, expires: Date.now() + DATA_KEY_TTL_MS });
  return key;
}

export function encryptWithDataKey(key: Buffer, plaintext: string): string {
  return `${VERSION}:${aesGcmEncrypt(key, Buffer.from(plaintext, "utf8")).toString("base64")}`;
}

export function decryptWithDataKey(key: Buffer, value: string): string {
  const [version, b64] = value.split(":");
  if (version !== VERSION || !b64) throw new Error("unknown ciphertext format");
  return aesGcmDecrypt(key, Buffer.from(b64, "base64")).toString("utf8");
}
