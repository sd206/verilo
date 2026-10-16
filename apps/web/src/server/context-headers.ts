import type { RequestMeta } from "./handlers/common";

/** Client IP from the load balancer / Cloud Run front end (first X-Forwarded-For hop). */
export function metaFromHeaders(h: Headers): RequestMeta {
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : (h.get("x-real-ip") ?? null);
  return { ip, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}
