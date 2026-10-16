CREATE TYPE "public"."file_source" AS ENUM('UPLOAD', 'EMAIL', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."invoice_seq_reset" AS ENUM('NEVER', 'YEARLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MANAGER', 'FINANCE', 'CONSULTANT');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."week_start" AS ENUM('MON', 'SUN');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'INVITED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"perceptual_hash" text,
	"scan_status" "scan_status" DEFAULT 'PENDING' NOT NULL,
	"uploaded_by" uuid,
	"source" "file_source" DEFAULT 'UPLOAD' NOT NULL,
	CONSTRAINT "file_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "firm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"ein" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"logo_file_id" uuid,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"week_start" "week_start" DEFAULT 'MON' NOT NULL,
	"default_payment_terms_days" integer DEFAULT 30 NOT NULL,
	"remit_to_text" text,
	"invoice_number_pattern" text DEFAULT '{CLIENT}-{YYYY}{MM}-{SEQ:4}' NOT NULL,
	"invoice_seq_reset" "invoice_seq_reset" DEFAULT 'YEARLY' NOT NULL,
	"timesheet_inbox_address" text NOT NULL,
	"ap_inbox_address" text NOT NULL,
	"match_tolerance_cents" integer DEFAULT 100 NOT NULL,
	"deduction_tolerance_cents" integer DEFAULT 100 NOT NULL,
	"wrapped_data_key" text NOT NULL,
	CONSTRAINT "firm_timesheet_inbox_address_unique" UNIQUE("timesheet_inbox_address"),
	CONSTRAINT "firm_ap_inbox_address_unique" UNIQUE("ap_inbox_address")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"consultant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"active_firm_id" uuid,
	"mfa_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_token_identifier_token_hash_pk" PRIMARY KEY("identifier","token_hash")
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_app_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_firm_id_firm_id_fk" FOREIGN KEY ("active_firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_event_firm_id_idx" ON "audit_event" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("firm_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "file_firm_id_idx" ON "file" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "invitation_firm_id_idx" ON "invitation" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "membership_firm_id_idx" ON "membership" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "membership_user_id_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_firm_user_key" ON "membership" USING btree ("firm_id","user_id");--> statement-breakpoint
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");