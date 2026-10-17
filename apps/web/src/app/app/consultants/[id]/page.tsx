import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@verilo/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DefinitionList, PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getConsultantDetail } from "@/server/handlers/consultants";
import { getEngagementFormOptions } from "@/server/handlers/engagements";
import { formatDate } from "@/lib/utils";
import { ConsultantActions } from "./consultant-actions";

export const metadata = { title: "Consultant" };

export default async function ConsultantPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const { id } = await params;
  const detail = await getConsultantDetail(deps(), ctx, { consultantId: id }).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const c = detail.consultant;
  const opts = detail.canEdit ? await getEngagementFormOptions(deps(), ctx) : null;
  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: "/app/consultants", label: "Consultants" }}
        title={
          <span className="flex items-center gap-3">
            {c.firstName} {c.lastName} <StatusChip status={c.archivedAt ? "ARCHIVED" : c.status} />
          </span>
        }
        description={c.employmentType === "W2" ? "W-2 employee" : `Contractor via ${detail.subVendor?.name ?? "—"}`}
        actions={
          detail.canEdit &&
          !c.archivedAt && (
            <Button asChild>
              <Link href={`/app/engagements/new?consultantId=${id}`}>New engagement</Link>
            </Button>
          )
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <DefinitionList
            items={[
              ["Emails", c.emails.length ? c.emails.join(", ") : null],
              ["Phone", c.phone],
              [
                "Sub-vendor",
                detail.subVendor ? (
                  <Link className="text-primary hover:underline" href={`/app/parties/${detail.subVendor.id}`}>
                    {detail.subVendor.name}
                  </Link>
                ) : null,
              ],
              ["Work authorization", c.workAuthType ? `${c.workAuthType}${c.workAuthExpiry ? `, expires ${formatDate(c.workAuthExpiry)}` : ""}` : null],
            ]}
          />
          {detail.canEdit && !c.archivedAt && opts && (
            <ConsultantActions
              consultant={{
                id,
                firstName: c.firstName,
                lastName: c.lastName,
                emails: c.emails,
                phone: c.phone,
                employmentType: c.employmentType,
                subVendorPartyId: c.subVendorPartyId,
                workAuthType: c.workAuthType,
                workAuthExpiry: c.workAuthExpiry,
              }}
              status={c.status}
              subVendors={opts.subVendors}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engagements</CardTitle>
        </CardHeader>
        <CardContent>
          <Table data-testid="engagements-table">
            <THead>
              <TR>
                <TH>Role</TH>
                <TH>Bill-to</TH>
                <TH>Start</TH>
                <TH>End</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {detail.engagements.length === 0 && (
                <TR>
                  <TD colSpan={5} className="text-muted-foreground">
                    No engagements yet.
                  </TD>
                </TR>
              )}
              {detail.engagements.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <Link href={`/app/engagements/${e.id}`} className="font-medium text-primary hover:underline">
                      {e.roleTitle ?? e.projectName ?? "Engagement"}
                    </Link>
                  </TD>
                  <TD>{e.billToName}</TD>
                  <TD>{formatDate(e.startDate)}</TD>
                  <TD>{formatDate(e.endDate)}</TD>
                  <TD>
                    <StatusChip status={e.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
