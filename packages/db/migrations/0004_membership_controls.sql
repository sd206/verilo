ALTER TABLE "membership" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "mfa_required" boolean DEFAULT false NOT NULL;