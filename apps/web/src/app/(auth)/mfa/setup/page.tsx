import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deps } from "@/server/deps";
import { getAuth } from "@/server/context";
import { beginMfaSetup } from "@/server/handlers/auth";
import { nextPathFor } from "@/server/handlers/common";
import { MfaSetupForm } from "./mfa-setup-form";

export const metadata = { title: "Set up two-step sign-in" };
export const dynamic = "force-dynamic";

export default async function MfaSetupPage() {
  const auth = await getAuth();
  if (!auth) redirect("/sign-in");
  if (auth.user.mfaEnabled) redirect(nextPathFor(auth.state));
  const setup = await beginMfaSetup(deps(), auth);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-step sign-in</CardTitle>
        <CardDescription>
          {auth.role === "ADMIN" || auth.role === "FINANCE"
            ? "Required for Admin and Finance users."
            : "Adds a code from your phone to every sign-in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaSetupForm qrDataUrl={setup.qrDataUrl} secret={setup.secret} />
      </CardContent>
    </Card>
  );
}
