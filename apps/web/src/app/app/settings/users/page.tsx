import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listMembers } from "@/server/handlers/members";
import { listConsultants } from "@/server/handlers/consultants";
import { ROLE_LABELS } from "@/lib/utils";
import { InviteForm } from "./invite-form";
import { MemberControls } from "./member-controls";

export const metadata = { title: "Users and roles" };

export default async function UsersPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "MANAGE_FIRM")) redirect("/app");
  const [{ members, pendingInvitations }, consultants] = await Promise.all([listMembers(deps(), ctx), listConsultants(deps(), ctx)]);
  const consultantOptions = consultants.map((c) => ({ id: c.id, name: c.name }));
  const nameOf = new Map(consultantOptions.map((c) => [c.id, c.name]));
  return (
    <div className="grid gap-6">
      <PageHeader title="Users and roles" description="Admins and Finance users always use two-step sign-in. You can require it for others too." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite someone</CardTitle>
          <CardDescription>They&apos;ll get a link that expires in 7 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm consultants={consultantOptions} />
        </CardContent>
      </Card>
      <Card>
        <Table data-testid="members-table">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Two-step</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.membershipId} data-testid="member-row">
                <TD className="font-medium">
                  {m.name}
                  {m.role === "CONSULTANT" && m.consultantId && <div className="text-xs text-muted-foreground">as {nameOf.get(m.consultantId) ?? "consultant"}</div>}
                </TD>
                <TD className="text-muted-foreground">{m.email}</TD>
                <TD>{ROLE_LABELS[m.role]}</TD>
                <TD>
                  {m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
                  {m.mfaRequired && m.role !== "ADMIN" && m.role !== "FINANCE" && <span className="ml-2 text-xs text-muted-foreground">required</span>}
                </TD>
                <TD>
                  <StatusChip status={m.disabledAt ? "DISABLED" : "ACTIVE"} />
                </TD>
                <TD className="text-right">
                  {m.userId !== ctx.userId && (
                    <MemberControls
                      member={{ membershipId: m.membershipId, name: m.name, role: m.role, consultantId: m.consultantId, disabled: m.disabledAt !== null, mfaRequired: m.mfaRequired }}
                      consultants={consultantOptions}
                    />
                  )}
                </TD>
              </TR>
            ))}
            {pendingInvitations.map((i) => (
              <TR key={i.id} data-testid="pending-invite">
                <TD className="text-muted-foreground">Invited</TD>
                <TD className="text-muted-foreground">{i.email}</TD>
                <TD>{ROLE_LABELS[i.role]}</TD>
                <TD />
                <TD>
                  <StatusChip status="INVITED" />
                </TD>
                <TD />
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
