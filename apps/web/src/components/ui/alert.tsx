import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" | "success" }) {
  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        variant === "destructive" && "border-destructive/30 bg-destructive/5 text-destructive",
        variant === "success" && "border-success/30 bg-success/5 text-success",
        variant === "default" && "border-border bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}
