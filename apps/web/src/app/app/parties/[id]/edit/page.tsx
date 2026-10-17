import { notFound, redirect } from "next/navigation";
import { AppError, can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getPartyDetail } from "@/server/handlers/parties";
import { PartyForm } from "../../party-form";

export const metadata = { title: "Edit party" };

export default async function EditPartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const { id } = await params;
  if (!can(ctx.role, "EDIT_MASTER_DATA")) redirect(`/app/parties/${id}`);
  const detail = await getPartyDetail(deps(), ctx, { partyId: id }).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const p = detail.party;
  return (
    <div className="grid gap-6">
      <PageHeader title={`Edit ${p.displayName}`} back={{ href: `/app/parties/${id}`, label: p.displayName }} />
      <Card>
        <CardContent className="pt-6">
          <PartyForm
            initial={{
              id,
              kind: p.kind,
              legalName: p.legalName,
              displayName: p.displayName,
              code: p.code,
              addressLine1: p.addressLine1,
              addressLine2: p.addressLine2,
              city: p.city,
              state: p.state,
              postalCode: p.postalCode,
              phone: p.phone,
              apEmails: p.apEmails,
              arEmails: p.arEmails,
              paymentTermsDays: p.paymentTermsDays,
              paysWhenPaidUpstream: p.paysWhenPaidUpstream,
              upstreamBufferDays: p.upstreamBufferDays,
              deductionPercent: p.deductionPercent,
              deductionLabel: p.deductionLabel,
              invoiceLayout: p.invoiceLayout,
              deliveryMethod: p.deliveryMethod,
              backupRequired: p.backupRequired,
              poRequired: p.poRequired,
              timesheetConfirmEmail: p.timesheetConfirmEmail,
              vendorPayTerms: p.vendorPayTerms,
              vendorNetDays: p.vendorNetDays,
              w9TaxClassification: p.w9TaxClassification,
              tinMasked: p.tinMasked,
              tinType: p.tinType,
              hasRemitDetails: Boolean(p.remitDetails),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
