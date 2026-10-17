"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a screenshot is being read, refresh every few seconds so results appear by themselves. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
