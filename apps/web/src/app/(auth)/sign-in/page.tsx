import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { deps } from "@/server/deps";
import { MagicLinkForm, SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  disabled: "This account is disabled. Ask your firm's Admin.",
  Verification: "That sign-in link is invalid or has expired.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const magic = deps().config.magicLinkEnabled;
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Try again.") : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your email and password.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {error && <Alert variant="destructive">{error}</Alert>}
        {sp.sent && <Alert variant="success">If that email has an account, a sign-in link is on its way.</Alert>}
        <SignInForm />
        {magic && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <MagicLinkForm />
          </>
        )}
        <p className="text-center text-sm text-muted-foreground">
          New firm?{" "}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
