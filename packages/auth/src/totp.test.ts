import { describe, expect, it } from "vitest";
import {
  generateRecoveryCodes,
  generateTotp,
  hashRecoveryCode,
  newTotpSecret,
  totpUri,
  verifyTotp,
} from "./totp";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password";

describe("TOTP", () => {
  it("accepts the current code and rejects others", () => {
    const secret = newTotpSecret();
    const now = new Date("2026-10-16T12:00:00Z");
    expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(generateTotp(secret, now) === "000000");
    expect(verifyTotp(secret, "abc", now)).toBe(false);
  });

  it("tolerates one step of clock drift but not five minutes", () => {
    const secret = newTotpSecret();
    const now = new Date("2026-10-16T12:00:00Z");
    const prev = generateTotp(secret, new Date(now.getTime() - 30_000));
    const old = generateTotp(secret, new Date(now.getTime() - 300_000));
    expect(verifyTotp(secret, prev, now)).toBe(true);
    expect(verifyTotp(secret, old, now)).toBe(false);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    expect(totpUri("a@b.co", "JBSWY3DPEHPK3PXP")).toMatch(/^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/);
  });
});

describe("recovery codes", () => {
  it("generates 10 distinct codes and hashes them ignoring case and dashes", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    const c = codes[0]!;
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toUpperCase().replace("-", " ")));
  });
});

describe("passwords", () => {
  it("enforces length", () => {
    expect(passwordPolicyError("short")).toMatch(/at least 12/);
    expect(passwordPolicyError("x".repeat(129))).toMatch(/at most 128/);
    expect(passwordPolicyError("correct horse battery")).toBeNull();
  });

  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong horse battery")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
