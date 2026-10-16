import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-10 text-xs text-muted-foreground">Accurate hours. Less busywork. More time for your business.</p>
    </main>
  );
}
