import Link from "next/link";

const TABS = [
  { href: "/app/settings/firm", label: "Firm" },
  { href: "/app/settings/numbering", label: "Invoice numbering" },
  { href: "/app/settings/users", label: "Users and roles" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <nav aria-label="Settings" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-input hover:text-foreground">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
