import { redirect } from "next/navigation";
import { can } from "@verilo/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { getFirmSettings } from "@/server/handlers/settings";
import { FirmForm } from "./firm-form";
import { HolidaysEditor } from "./holidays-editor";

export const metadata = { title: "Firm settings" };

export default async function FirmSettingsPage() {
  const { ctx } = await requireFirmPage();
  if (!can(ctx.role, "MANAGE_FIRM")) redirect("/app");
  const s = await getFirmSettings(deps(), ctx);
  return (
    <div className="grid gap-6">
      <PageHeader title="Firm settings" description="Profile, defaults and the holiday calendar." />
      <Card>
        <CardContent className="pt-6">
          <FirmForm firm={s.firm} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holiday calendar</CardTitle>
          <CardDescription>Hours entered on these dates are flagged for review.</CardDescription>
        </CardHeader>
        <CardContent>
          <HolidaysEditor initial={s.holidays} />
        </CardContent>
      </Card>
    </div>
  );
}
