import Link from "next/link";
import { can } from "@verilo/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listConsultants } from "@/server/handlers/consultants";
import { ConsultantsTable } from "./consultants-table";

export const metadata = { title: "Consultants" };

export default async function ConsultantsPage() {
  const { ctx } = await requireFirmPage();
  const rows = await listConsultants(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Consultants"
        description="W-2 employees and contractors supplied by sub-vendors."
        actions={
          can(ctx.role, "EDIT_MASTER_DATA") && (
            <Button asChild>
              <Link href="/app/consultants/new">New consultant</Link>
            </Button>
          )
        }
      />
      <ConsultantsTable rows={rows} />
    </div>
  );
}
