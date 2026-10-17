import { decryptWithDataKey, encryptWithDataKey, unwrapFirmDataKey } from "@verilo/auth";
import { getFirm, type Queryable } from "@verilo/db";
import type { Deps } from "../deps";

/** Field encryption with the firm's data key (R11, section 24.5): EIN, TINs, remit/bank details. */
export async function firmCipher(d: Deps, tx: Queryable, firmId: string) {
  const firm = await getFirm(tx, firmId);
  if (!firm) throw new Error("firm not found");
  const key = await unwrapFirmDataKey(d.keys, firmId, firm.wrappedDataKey);
  return {
    encrypt: (v: string | null) => (v ? encryptWithDataKey(key, v) : null),
    decrypt: (v: string | null) => (v ? decryptWithDataKey(key, v) : null),
  };
}

/** "123456789" → "•••••6789". Never send full TINs to screens that only need to show them. */
export function maskTail(value: string | null, keep = 4): string | null {
  if (!value) return null;
  const digits = value.replace(/\s/g, "");
  return `${"•".repeat(Math.max(0, digits.length - keep))}${digits.slice(-keep)}`;
}
