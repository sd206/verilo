import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "No firm" };

export default function NoFirmPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>You're not a member of a firm</CardTitle>
        <CardDescription>Ask your firm's Admin for an invitation, or create a new firm.</CardDescription>
        <div className="pt-4">
          <SignOutButton />
        </div>
      </CardHeader>
    </Card>
  );
}
