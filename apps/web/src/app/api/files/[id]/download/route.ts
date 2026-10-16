import { deps } from "@/server/deps";
import { downloadFileRoute } from "@/server/handlers/routes";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return downloadFileRoute(deps(), req, (await params).id);
}
