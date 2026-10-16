// GET /api/health — process up; used by the load balancer and uptime checks (section 24.8).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "web", revision: process.env.K_REVISION ?? null });
}
