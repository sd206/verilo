import { notFound, redirect } from "next/navigation";
import { AppError, can } from "@verilo/auth";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getEngagementDetail, getEngagementFormOptions } from "@/server/handlers/engagements";
import { EngagementForm } from "../../engagement-form";

export const metadata = { title: "Edit engagement" };

export default async function EditEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const { id } = await params;
  if (!can(ctx.role, "EDIT_MASTER_DATA")) redirect(`/app/engagements/${id}`);
  const detail = await getEngagementDetail(deps(), ctx, { engagementId: id }).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const e = detail.engagement;
  const options = await getEngagementFormOptions(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader title="Edit engagement" back={{ href: `/app/engagements/${id}`, label: detail.consultant.name }} />
      <Card>
        <CardContent className="pt-6">
          <EngagementForm
            options={options}
            initial={{
              id,
              consultantId: e.consultantId,
              billToPartyId: e.billToPartyId,
              endClientPartyId: e.endClientPartyId,
              primePartyId: e.primePartyId,
              implementationPartnerPartyId: e.implementationPartnerPartyId,
              projectName: e.projectName,
              roleTitle: e.roleTitle,
              startDate: e.startDate,
              endDate: e.endDate,
              timesheetCycle: e.timesheetCycle,
              biweeklyAnchorDate: e.biweeklyAnchorDate,
              invoiceCycle: e.invoiceCycle,
              evidenceRequired: e.evidenceRequired,
              expectedWeeklyHours: e.expectedWeeklyHours,
              maxWeeklyHoursWarning: e.maxWeeklyHoursWarning,
              deductionOverride: e.deductionBpsOverride === null ? "" : (e.deductionBpsOverride / 100).toFixed(2),
              factored: e.factored,
              primeWorkOrderNo: e.primeWorkOrderNo,
              primeConsultantRef: e.primeConsultantRef,
              endClientWorkerRef: e.endClientWorkerRef,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
