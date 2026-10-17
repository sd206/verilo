import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireFirmPage } from "@/server/context";
import { PartyForm } from "../party-form";

export const metadata = { title: "New party" };

export default async function NewPartyPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "EDIT_MASTER_DATA")) redirect("/app/parties");
  return (
    <div className="grid gap-6">
      <PageHeader title="New party" back={{ href: "/app/parties", label: "Parties" }} />
      <Card>
        <CardContent className="pt-6">
          <PartyForm />
        </CardContent>
      </Card>
    </div>
  );
}
