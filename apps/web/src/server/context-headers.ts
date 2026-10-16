import type { RequestMeta } from "./handlers/common";

/**
 * Client IP for rate limiting and the audit log. X-Forwarded-For entries on the left are
 * client-supplied and can be spoofed; Google's front end appends the real client address.
 * Directly on Cloud Run that is the last entry (TRUSTED_PROXY_HOPS=1); behind the external
 * load balancer (M8) the LB adds one more, so set TRUSTED_PROXY_HOPS=2 there.
 */
export function metaFromHeaders(h: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): RequestMeta {
  const parts = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = parts.length ? (parts[Math.max(0, parts.length - hops)] ?? null) : (h.get("x-real-ip") ?? null);
  return { ip, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}
