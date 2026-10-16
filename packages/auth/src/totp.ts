import { generateSecret, generateSync, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "./tokens";

export const TOTP_ISSUER = "Verilo";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(accountEmail: string, secret: string): string {
  return generateURI({ strategy: "totp", issuer: TOTP_ISSUER, label: accountEmail, secret });
}

export function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, token: string, now: Date = new Date()): boolean {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const result = verifySync({
    strategy: "totp",
    secret,
    token: cleaned,
    epoch: Math.floor(now.getTime() / 1000),
    epochTolerance: 30,
  });
  return result.valid;
}

/** Used by tests and the staging smoke test to act as an authenticator app. */
export function generateTotp(secret: string, now: Date = new Date()): string {
  return generateSync({ strategy: "totp", secret, epoch: Math.floor(now.getTime() / 1000) });
}

// --- recovery codes ------------------------------------------------------------

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(normalizeRecoveryCode(code));
}
