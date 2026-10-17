import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@verilo/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DefinitionList, PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getPartyDetail } from "@/server/handlers/parties";
import { DOC_TYPE_LABELS, formatDate, PARTY_KIND_LABELS, W9_LABELS } from "@/lib/utils";
import { AddContactForm, AttachDocumentForm, ArchivePartyButton, ArchiveRowButton } from "./party-actions";

export const metadata = { title: "Party" };

export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireFirmPage();
  const { id } = await params;
  const detail = await getPartyDetail(deps(), ctx, { partyId: id }).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const p = detail.party;
  const billTo = p.kind === "PRIME_VENDOR" || p.kind === "IMPLEMENTATION_PARTNER" || p.kind === "END_CLIENT";
  const sub = p.kind === "SUB_VENDOR";
  const address = [p.addressLine1, p.addressLine2, [p.city, p.state, p.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <div className="grid gap-6">
      <PageHeader
        back={{ href: "/app/parties", label: "Parties" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.displayName}
            {p.code && <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm">{p.code}</code>}
            {p.archivedAt && <StatusChip status="ARCHIVED" />}
          </span>
        }
        description={`${PARTY_KIND_LABELS[p.kind]} · ${p.legalName}`}
        actions={
          detail.canEdit &&
          !p.archivedAt && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/parties/${id}/edit`}>Edit</Link>
              </Button>
              <ArchivePartyButton partyId={id} name={p.displayName} />
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <DefinitionList
              items={[
                ...(billTo
                  ? ([
                      ["Payment terms", p.paymentTermsDays !== null ? `Net ${p.paymentTermsDays}` : null],
                      ["Pays when paid upstream", p.paysWhenPaidUpstream ? `Yes (+${p.upstreamBufferDays} days buffer)` : "No"],
                      ["Standard deduction", p.standardDeductionBps !== null ? `${p.deductionPercent}%${p.deductionLabel ? ` (${p.deductionLabel})` : ""}` : null],
                      ["Invoice layout", p.invoiceLayout === "PER_CONSULTANT" ? "One per consultant" : "Combined"],
                      ["Delivery", p.deliveryMethod === "EMAIL" ? "Email" : "Portal"],
                      ["Backup required", p.backupRequired ? "Yes" : "No"],
                      ["PO required", p.poRequired ? "Yes" : "No"],
                      ["AP emails", p.apEmails.length ? p.apEmails.join(", ") : null],
                      ["Timesheet confirmation", p.timesheetConfirmEmail],
                    ] as [string, React.ReactNode][])
                  : []),
                ...(sub
                  ? ([
                      ["Vendor pay terms", p.vendorPayTerms === "PAY_WHEN_PAID" ? "Pay when paid" : `Net ${p.vendorNetDays}`],
                      ["AR emails", p.arEmails.length ? p.arEmails.join(", ") : null],
                      ["Remit details", p.remitDetails ? <span className="whitespace-pre-line">{p.remitDetails}</span> : null],
                      ["W-9 classification", W9_LABELS[p.w9TaxClassification]],
                      ["TIN", p.tinMasked ? `${p.tinMasked}${p.tinType ? ` (${p.tinType})` : ""}` : null],
                    ] as [string, React.ReactNode][])
                  : []),
                ["Address", address || null],
                ["Phone", p.phone],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">QuickBooks</CardTitle>
            <CardDescription>Mapping is set up in a later release.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {detail.qbo.customerId || detail.qbo.vendorId ? (
              <StatusChip status="ACTIVE" />
            ) : (
              <span className="text-muted-foreground">Not mapped</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table data-testid="contacts-table">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Email</TH>
                <TH>Phone</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {detail.contacts.length === 0 && (
                <TR>
                  <TD colSpan={5} className="text-muted-foreground">
                    No contacts yet.
                  </TD>
                </TR>
              )}
              {detail.contacts.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD>{c.roleLabel ?? "—"}</TD>
                  <TD>{c.email ?? "—"}</TD>
                  <TD>{c.phone ?? "—"}</TD>
                  <TD className="text-right">
                    {detail.canEdit && <ArchiveRowButton kind="contact" id={c.id} name={c.name} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {detail.canEdit && <AddContactForm partyId={id} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>W-9, COI, MSA and work orders. Expiring within 30 days is flagged.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table data-testid="documents-table">
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>File</TH>
                <TH>Effective</TH>
                <TH>Expires</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {detail.documents.length === 0 && (
                <TR>
                  <TD colSpan={6} className="text-muted-foreground">
                    No documents yet.
                  </TD>
                </TR>
              )}
              {detail.documents.map((doc) => (
                <TR key={doc.id}>
                  <TD className="font-medium">
                    {DOC_TYPE_LABELS[doc.docType]}
                    {doc.requiredForPayment && <span className="ml-2 text-xs text-muted-foreground">required for payment</span>}
                  </TD>
                  <TD>
                    <a className="text-primary hover:underline" href={`/api/files/${doc.fileId}/download`}>
                      {doc.filename}
                    </a>
                  </TD>
                  <TD>{formatDate(doc.effectiveDate)}</TD>
                  <TD>{formatDate(doc.expiryDate)}</TD>
                  <TD>
                    <StatusChip status={doc.status} />
                  </TD>
                  <TD className="text-right">
                    {detail.canEdit && <ArchiveRowButton kind="document" id={doc.id} name={DOC_TYPE_LABELS[doc.docType]!} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {detail.canEdit && <AttachDocumentForm partyId={id} />}
        </CardContent>
      </Card>

      {(detail.engagements.length > 0 || detail.consultants.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{sub ? "Consultants supplied" : "Engagements billed to this party"}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {detail.engagements.map((e) => (
                <li key={e.id} className="flex items-center gap-3">
                  <Link href={`/app/engagements/${e.id}`} className="text-primary hover:underline">
                    {e.consultantName} — {e.roleTitle ?? e.projectName ?? "Engagement"}
                  </Link>
                  <StatusChip status={e.status} />
                </li>
              ))}
              {detail.consultants.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <Link href={`/app/consultants/${c.id}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                  <StatusChip status={c.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
