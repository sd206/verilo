import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { AppError } from "@verilo/auth";
import { deps } from "@/server/deps";
import { getInvitation } from "@/server/handlers/members";
import { ROLE_LABELS } from "@/lib/utils";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let inv: Awaited<ReturnType<typeof getInvitation>> | null = null;
  let error: string | null = null;
  try {
    inv = await getInvitation(deps(), { token });
  } catch (e) {
    error = e instanceof AppError ? e.message : "This invitation is invalid or has expired";
  }
  if (!inv) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">{error}</Alert>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {inv.firmName}</CardTitle>
        <CardDescription>
          You've been invited as <b>{ROLE_LABELS[inv.role]}</b> ({inv.email}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInviteForm token={token} needsPassword={inv.needsPassword} />
      </CardContent>
    </Card>
  );
}
