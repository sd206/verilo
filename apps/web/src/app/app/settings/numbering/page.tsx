import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getFirmSettings } from "@/server/handlers/settings";
import { NumberingEditor } from "./numbering-editor";

export const metadata = { title: "Invoice numbering" };

export default async function NumberingPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "MANAGE_FIRM")) redirect("/app");
  const s = await getFirmSettings(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader title="Invoice numbering" description="How invoice numbers are built. Numbers are assigned when an invoice is approved." />
      <Card>
        <CardContent className="pt-6">
          <NumberingEditor
            pattern={s.firm.invoiceNumberPattern}
            seqReset={s.firm.invoiceSeqReset}
            clients={s.billToParties}
            today={s.today}
          />
        </CardContent>
      </Card>
    </div>
  );
}
