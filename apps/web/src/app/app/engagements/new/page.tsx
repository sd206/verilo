import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getEngagementFormOptions } from "@/server/handlers/engagements";
import { EngagementForm } from "../engagement-form";

export const metadata = { title: "New engagement" };

export default async function NewEngagementPage({ searchParams }: { searchParams: Promise<{ consultantId?: string }> }) {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "EDIT_MASTER_DATA")) redirect("/app/consultants");
  const { consultantId } = await searchParams;
  const options = await getEngagementFormOptions(deps(), ctx);
  const back = consultantId ? { href: `/app/consultants/${consultantId}`, label: "Consultant" } : { href: "/app/consultants", label: "Consultants" };
  return (
    <div className="grid gap-6">
      <PageHeader title="New engagement" description="Rates and POs are added on the engagement page." back={back} />
      <Card>
        <CardContent className="pt-6">
          <EngagementForm options={options} initial={{ consultantId: consultantId ?? "", timesheetCycle: "MONTHLY", invoiceCycle: "MONTHLY" }} />
        </CardContent>
      </Card>
    </div>
  );
}
