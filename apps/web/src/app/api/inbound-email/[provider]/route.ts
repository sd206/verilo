import { deps } from "@/server/deps";
import { receiveInboundEmail } from "@/server/jobs/inbound";

export const dynamic = "force-dynamic";

/** Section 9 inbound webhook (Postmark). Authenticated by HTTP basic auth, not a session. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return receiveInboundEmail(deps(), req, (await params).provider);
}
