import { Badge } from "@/components/ui/badge";

/** One color per status, used everywhere (13 "UI rules"). */
const TONES: Record<string, "neutral" | "success" | "warning" | "danger" | "primary"> = {
  ACTIVE: "success",
  CLEAN: "success",
  VALID: "success",
  DRAFT: "neutral",
  NO_EXPIRY: "neutral",
  INACTIVE: "neutral",
  ENDED: "neutral",
  ARCHIVED: "neutral",
  PENDING: "warning",
  EXPIRING: "warning",
  INVITED: "warning",
  EXPIRED: "danger",
  INFECTED: "danger",
  DISABLED: "danger",
};

const LABELS: Record<string, string> = {
  NO_EXPIRY: "No expiry",
  EXPIRING: "Expiring soon",
};

export function StatusChip({ status }: { status: string }) {
  const label = LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <Badge tone={TONES[status] ?? "neutral"} data-status={status}>
      {label}
    </Badge>
  );
}
