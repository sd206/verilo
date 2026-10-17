import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  END_CLIENT: "End client",
  PRIME_VENDOR: "Prime vendor",
  IMPLEMENTATION_PARTNER: "Implementation partner",
  FIRM: "Your firm",
  SUB_VENDOR: "Sub-vendor",
  CONSULTANT: "Consultant",
};

type Node = { role: string; name: string; billTo?: boolean; id?: string };

/** Section 1's chain, end client at the top of the money flow down to the consultant. */
export function BillingChain({ nodes }: { nodes: Node[] }) {
  return (
    <ol className="flex flex-col items-stretch gap-1 md:flex-row md:items-center md:gap-0" data-testid="billing-chain">
      {nodes.map((n, i) => (
        <Fragment key={`${n.role}-${i}`}>
          {i > 0 && (
            <li aria-hidden className="flex justify-center text-muted-foreground md:px-2">
              <span className="md:hidden">↓</span>
              <span className="hidden md:inline">→</span>
            </li>
          )}
          <li
            className={cn(
              "flex-1 rounded-md border px-3 py-2 text-sm",
              n.role === "FIRM" ? "border-primary bg-accent" : "border-border bg-card",
              n.billTo && "ring-2 ring-primary/40",
            )}
            data-role={n.role}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              {ROLE_LABELS[n.role]}
              {n.billTo && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">Bill-to</span>}
            </div>
            <div className="truncate font-medium">
              {n.id ? (
                <Link href={`/app/parties/${n.id}`} className="hover:underline">
                  {n.name}
                </Link>
              ) : (
                n.name
              )}
            </div>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
