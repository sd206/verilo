import Link from "next/link";
import { can } from "@verilo/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listParties } from "@/server/handlers/parties";
import { PartiesTable } from "./parties-table";

export const metadata = { title: "Parties" };

export default async function PartiesPage() {
  const { ctx } = await requireFirmPage();
  const rows = await listParties(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Parties"
        description="Prime vendors, implementation partners, end clients, sub-vendors and factors."
        actions={
          can(ctx.role, "EDIT_MASTER_DATA") && (
            <Button asChild>
              <Link href="/app/parties/new">New party</Link>
            </Button>
          )
        }
      />
      <PartiesTable rows={rows} />
    </div>
  );
}
