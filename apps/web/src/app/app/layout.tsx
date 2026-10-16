import Link from "next/link";
import { can } from "@verilo/auth";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { FirmSwitcher } from "@/components/firm-switcher";
import { deps } from "@/server/deps";
import { requireFirmPage } from "@/server/context";
import { listMyFirms } from "@/server/handlers/auth";
import { ROLE_LABELS } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { auth, ctx } = await requireFirmPage();
  const firms = await listMyFirms(deps(), auth);
  const nav = [
    { href: "/app", label: "Home", show: true },
    { href: "/app/files", label: "Files", show: can(ctx.role, "UPLOAD_FILES") },
    { href: "/app/settings/users", label: "Users", show: can(ctx.role, "MANAGE_FIRM") },
  ].filter((n) => n.show);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/app" aria-label="Home">
            <Logo />
          </Link>
          <FirmSwitcher firms={firms} activeFirmId={ctx.firmId} />
          <nav className="hidden items-center gap-1 sm:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground md:inline" data-testid="whoami">
              {auth.user.name} · {ROLE_LABELS[ctx.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
