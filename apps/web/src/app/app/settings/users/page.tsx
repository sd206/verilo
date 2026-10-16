import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listMembers } from "@/server/handlers/members";
import { ROLE_LABELS } from "@/lib/utils";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "MANAGE_FIRM")) redirect("/app");
  const { members, pendingInvitations } = await listMembers(deps(), ctx);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Admins and Finance users must use two-step sign-in.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite someone</CardTitle>
          <CardDescription>They'll get a link that expires in 7 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
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
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.membershipId}>
                <TD className="font-medium">{m.name}</TD>
                <TD className="text-muted-foreground">{m.email}</TD>
                <TD>{ROLE_LABELS[m.role]}</TD>
                <TD>{m.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</TD>
              </TR>
            ))}
            {pendingInvitations.map((i) => (
              <TR key={i.id} data-testid="pending-invite">
                <TD className="text-muted-foreground">Invited</TD>
                <TD className="text-muted-foreground">{i.email}</TD>
                <TD>{ROLE_LABELS[i.role]}</TD>
                <TD>
                  <Badge tone="warning">Pending</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
