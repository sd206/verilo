import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getEngagementFormOptions } from "@/server/handlers/engagements";
import { ConsultantForm } from "../consultant-form";

export const metadata = { title: "New consultant" };

export default async function NewConsultantPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "EDIT_MASTER_DATA")) redirect("/app/consultants");
  const opts = await getEngagementFormOptions(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader title="New consultant" back={{ href: "/app/consultants", label: "Consultants" }} />
      <Card>
        <CardContent className="pt-6">
          <ConsultantForm subVendors={opts.subVendors} />
        </CardContent>
      </Card>
    </div>
  );
}
