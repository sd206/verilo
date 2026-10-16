import { AppError } from "@verilo/auth";
import { deps } from "./deps";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** Maps handler errors to a result the form can show; unexpected errors are logged, not leaked. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, code: e.code };
    // redirect() and notFound() throw special errors that Next must see.
    if (e && typeof e === "object" && "digest" in e) throw e;
    deps().log.error({ err: e }, "server action failed");
    return { ok: false, error: "Something went wrong. Try again.", code: "INTERNAL" };
  }
}
