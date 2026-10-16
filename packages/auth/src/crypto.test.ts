import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  decryptWithDataKey,
  encryptSecret,
  encryptWithDataKey,
  keyWrapperFromEnv,
  LocalKeyWrapper,
  newFirmDataKey,
  unwrapFirmDataKey,
} from "./crypto";

const wrapper = new LocalKeyWrapper(randomBytes(32).toString("base64"));

describe("application-level encryption", () => {
  it("round-trips a secret through the key wrapper", async () => {
    const ct = await encryptSecret(wrapper, "JBSWY3DPEHPK3PXP");
    expect(ct).toMatch(/^v1:/);
    expect(ct).not.toContain("JBSWY3DPEHPK3PXP");
    expect(await decryptSecret(wrapper, ct)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV each time", async () => {
    expect(await encryptSecret(wrapper, "x")).not.toBe(await encryptSecret(wrapper, "x"));
  });

  it("envelope-encrypts firm fields with a wrapped per-firm data key", async () => {
    const { key, wrapped } = await newFirmDataKey(wrapper);
    const ct = encryptWithDataKey(key, "12-3456789");
    const unwrapped = await unwrapFirmDataKey(wrapper, "firm-1", wrapped);
    expect(decryptWithDataKey(unwrapped, ct)).toBe("12-3456789");
  });

  it("fails on tampered ciphertext", async () => {
    const { key } = await newFirmDataKey(wrapper);
    const ct = encryptWithDataKey(key, "secret");
    const [v, b64] = ct.split(":");
    const buf = Buffer.from(b64!, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 1;
    expect(() => decryptWithDataKey(key, `${v}:${buf.toString("base64")}`)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    expect(() => new LocalKeyWrapper(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("refuses a local key in staging or production", () => {
    const key = randomBytes(32).toString("base64");
    expect(() => keyWrapperFromEnv({ APP_ENV: "staging", APP_ENCRYPTION_KEY: key })).toThrow(/KMS/);
    expect(keyWrapperFromEnv({ APP_ENV: "local", APP_ENCRYPTION_KEY: key })).toBeInstanceOf(LocalKeyWrapper);
  });
});
