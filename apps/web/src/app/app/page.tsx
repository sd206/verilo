import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getFirmSummary } from "@/server/handlers/home";
import { ROLE_LABELS } from "@/lib/utils";
import { redirect } from "next/navigation";

export const metadata = { title: "Home" };

export default async function AppHome() {
  const { ctx } = await requireFirmPage();
  // Consultants land on their timesheets (13.1).
  if (ctx.role === "CONSULTANT") redirect("/app/timesheets");
  const firm = await getFirmSummary(deps(), ctx);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="firm-name">
          {firm.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {firm.legalName} · You're signed in as {ROLE_LABELS[firm.role]}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inbound email addresses</CardTitle>
            <CardDescription>Consultants can email approved timesheet screenshots to the timesheet address. Vendor-invoice intake starts with vendor bills.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Timesheets: </span>
              <code className="font-mono">{firm.timesheetInboxAddress}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Vendor invoices: </span>
              <code className="font-mono">{firm.apInboxAddress}</code>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Firm settings</CardTitle>
            <CardDescription>Time zone {firm.timezone}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
