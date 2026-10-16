import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuth } from "@/server/context";
import { nextPathFor } from "@/server/handlers/common";
import { MfaVerifyForm } from "./mfa-verify-form";

export const metadata = { title: "Two-step sign-in" };
export const dynamic = "force-dynamic";

export default async function MfaVerifyPage() {
  const auth = await getAuth();
  if (!auth) redirect("/sign-in");
  if (auth.state !== "MFA_REQUIRED") redirect(nextPathFor(auth.state));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter your code</CardTitle>
        <CardDescription>Open your authenticator app for {auth.user.email}.</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaVerifyForm />
      </CardContent>
    </Card>
  );
}
