import { AppError, requireFirmContext, resolveSession, sessionCookieName } from "@verilo/auth";
import type { Deps } from "../deps";
import { metaFromHeaders } from "../context-headers";
import { getDownloadUrl } from "./files";

/** Reads the session cookie from a Request (route handlers are tested with plain Requests). */
export function cookieFromRequest(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function errorResponse(e: unknown, d: Deps): Response {
  if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
  d.log.error({ err: e }, "route failed");
  return Response.json({ error: "Internal error" }, { status: 500 });
}

/** GET /api/files/:id/download */
export async function downloadFileRoute(d: Deps, req: Request, fileId: string): Promise<Response> {
  try {
    const secure = d.config.baseUrl.startsWith("https://");
    const auth = await resolveSession(d.db, cookieFromRequest(req, sessionCookieName(secure)));
    const ctx = requireFirmContext(auth, metaFromHeaders(req.headers));
    const url = await getDownloadUrl(d, ctx, { fileId });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e, d);
  }
}
