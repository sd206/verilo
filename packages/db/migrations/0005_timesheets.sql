CREATE TYPE "public"."check_code" AS ENUM('NO_EVIDENCE', 'EXTRACTION_PENDING', 'HOURS_MISMATCH', 'PERIOD_MISMATCH', 'NOT_APPROVED', 'NAME_MISMATCH', 'LOW_CONFIDENCE', 'DUPLICATE_EVIDENCE', 'OUTSIDE_ENGAGEMENT', 'NO_RATE', 'HOLIDAY_HOURS', 'HIGH_HOURS', 'PO_EXCEEDED', 'RATE_CHANGE_IN_PERIOD');--> statement-breakpoint
CREATE TYPE "public"."check_severity" AS ENUM('BLOCK', 'WARN', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('TIMESHEET', 'VENDOR_INVOICE', 'REMITTANCE');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('CONSULTANT_UPLOAD', 'EMAIL', 'BULK_UPLOAD', 'PRIME_CONFIRMATION', 'APPROVER_LINK');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."inbound_email_status" AS ENUM('RECEIVED', 'PROCESSED', 'UNMATCHED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."inbox" AS ENUM('TIMESHEET', 'AP');--> statement-breakpoint
CREATE TYPE "public"."non_billable_reason" AS ENUM('VALIDATION_RETRY', 'PROVIDER_ERROR', 'DUPLICATE', 'SCAN_REJECTED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'NEEDS_REVIEW', 'VERIFIED', 'RETURNED', 'INVOICED');--> statement-breakpoint
CREATE TABLE "ai_usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"extraction_id" uuid,
	"file_id" uuid NOT NULL,
	"document_kind" "document_kind" NOT NULL,
	"pages" integer NOT NULL,
	"billable" boolean NOT NULL,
	"non_billable_reason" "non_billable_reason",
	"usage_month" date NOT NULL,
	"provider_cost_cents" integer
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid,
	"file_id" uuid NOT NULL,
	"source" "evidence_source" NOT NULL,
	"extraction_id" uuid,
	"inbound_email_id" uuid,
	"consultant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "extraction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"status" "extraction_status" DEFAULT 'QUEUED' NOT NULL,
	"model" text,
	"prompt_version" text,
	"raw_json" jsonb,
	"result_json" jsonb,
	"overall_confidence" numeric(3, 2),
	"error" text,
	"cost_cents" integer
);
--> statement-breakpoint
CREATE TABLE "inbound_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"inbox" "inbox" NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"raw_storage_key" text NOT NULL,
	"status" "inbound_email_status" DEFAULT 'RECEIVED' NOT NULL,
	"status_reason" text,
	"matched_consultant_id" uuid,
	"matched_party_id" uuid
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"user_id" uuid,
	"to_email" text,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" timesheet_status DEFAULT 'NOT_STARTED' NOT NULL,
	"total_hours" numeric(7, 2) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"returned_reason" text,
	"invoice_id" uuid
);
--> statement-breakpoint
CREATE TABLE "timesheet_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"check_code" "check_code" NOT NULL,
	"severity" "check_severity" NOT NULL,
	"message" text NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text
);
--> statement-breakpoint
CREATE TABLE "timesheet_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"rate_kind" "rate_kind" DEFAULT 'REGULAR' NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "firm" ADD COLUMN "timesheet_auto_reply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_extraction_id_extraction_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extraction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_timesheet_id_timesheet_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_extraction_id_extraction_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extraction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_inbound_email_id_inbound_email_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_email"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email" ADD CONSTRAINT "inbound_email_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email" ADD CONSTRAINT "inbound_email_matched_consultant_id_consultant_id_fk" FOREIGN KEY ("matched_consultant_id") REFERENCES "public"."consultant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email" ADD CONSTRAINT "inbound_email_matched_party_id_party_id_fk" FOREIGN KEY ("matched_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_verified_by_app_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_check" ADD CONSTRAINT "timesheet_check_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_check" ADD CONSTRAINT "timesheet_check_timesheet_id_timesheet_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_check" ADD CONSTRAINT "timesheet_check_resolved_by_app_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_timesheet_id_timesheet_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_event_firm_month_idx" ON "ai_usage_event" USING btree ("firm_id","usage_month");--> statement-breakpoint
CREATE INDEX "evidence_firm_id_idx" ON "evidence" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "evidence_timesheet_idx" ON "evidence" USING btree ("timesheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_file_key" ON "evidence" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "extraction_firm_id_idx" ON "extraction" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "extraction_file_idx" ON "extraction" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "inbound_email_firm_id_idx" ON "inbound_email" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_email_message_key" ON "inbound_email" USING btree ("firm_id","inbox","message_id");--> statement-breakpoint
CREATE INDEX "notification_firm_id_idx" ON "notification" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "timesheet_firm_id_idx" ON "timesheet" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_engagement_period_key" ON "timesheet" USING btree ("engagement_id","period_start");--> statement-breakpoint
CREATE INDEX "timesheet_check_firm_id_idx" ON "timesheet_check" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_check_code_key" ON "timesheet_check" USING btree ("timesheet_id","check_code");--> statement-breakpoint
CREATE INDEX "timesheet_entry_firm_id_idx" ON "timesheet_entry" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_entry_day_kind_key" ON "timesheet_entry" USING btree ("timesheet_id","work_date","rate_kind");