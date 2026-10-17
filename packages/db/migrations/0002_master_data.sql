CREATE TYPE "public"."consultant_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."cycle" AS ENUM('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('EMAIL', 'PORTAL');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('W2', 'CONTRACTOR');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('DRAFT', 'ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."invoice_layout" AS ENUM('PER_CONSULTANT', 'COMBINED');--> statement-breakpoint
CREATE TYPE "public"."party_doc_type" AS ENUM('W9', 'COI', 'MSA', 'WORK_ORDER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('PRIME_VENDOR', 'IMPLEMENTATION_PARTNER', 'END_CLIENT', 'SUB_VENDOR', 'FACTOR');--> statement-breakpoint
CREATE TYPE "public"."rate_kind" AS ENUM('REGULAR', 'OVERTIME', 'HOLIDAY');--> statement-breakpoint
CREATE TYPE "public"."rate_side" AS ENUM('BILL', 'PAY');--> statement-breakpoint
CREATE TYPE "public"."tin_type" AS ENUM('EIN', 'SSN');--> statement-breakpoint
CREATE TYPE "public"."vendor_pay_terms" AS ENUM('NET', 'PAY_WHEN_PAID');--> statement-breakpoint
CREATE TYPE "public"."w9_tax_classification" AS ENUM('INDIVIDUAL_SOLE_PROP_SMLLC', 'C_CORP', 'S_CORP', 'PARTNERSHIP', 'TRUST_ESTATE', 'LLC_C', 'LLC_S', 'LLC_P', 'OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "consultant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"emails" text[] DEFAULT '{}' NOT NULL,
	"phone" text,
	"employment_type" "employment_type" NOT NULL,
	"sub_vendor_party_id" uuid,
	"work_auth_type" text,
	"work_auth_expiry" date,
	"status" "consultant_status" DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engagement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"bill_to_party_id" uuid NOT NULL,
	"end_client_party_id" uuid NOT NULL,
	"prime_party_id" uuid,
	"implementation_partner_party_id" uuid,
	"project_name" text,
	"role_title" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"timesheet_cycle" "cycle" NOT NULL,
	"biweekly_anchor_date" date,
	"invoice_cycle" "cycle" NOT NULL,
	"evidence_required" boolean DEFAULT true NOT NULL,
	"expected_weekly_hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"max_weekly_hours_warning" numeric(5, 2) DEFAULT '50' NOT NULL,
	"deduction_bps_override" integer,
	"factored" boolean DEFAULT false NOT NULL,
	"prime_work_order_no" text,
	"prime_consultant_ref" text,
	"end_client_worker_ref" text,
	"status" "engagement_status" DEFAULT 'DRAFT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"kind" "party_kind" NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"code" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"phone" text,
	"ap_emails" text[] DEFAULT '{}' NOT NULL,
	"ar_emails" text[] DEFAULT '{}' NOT NULL,
	"payment_terms_days" integer,
	"pays_when_paid_upstream" boolean DEFAULT false NOT NULL,
	"upstream_buffer_days" integer DEFAULT 15 NOT NULL,
	"standard_deduction_bps" integer,
	"deduction_label" text,
	"invoice_layout" "invoice_layout" DEFAULT 'PER_CONSULTANT' NOT NULL,
	"delivery_method" "delivery_method" DEFAULT 'EMAIL' NOT NULL,
	"backup_required" boolean DEFAULT false NOT NULL,
	"po_required" boolean DEFAULT false NOT NULL,
	"timesheet_confirm_email" text,
	"vendor_pay_terms" "vendor_pay_terms",
	"vendor_net_days" integer,
	"remit_details" text,
	"qbo_customer_id" text,
	"qbo_vendor_id" text,
	"w9_tax_classification" "w9_tax_classification" DEFAULT 'UNKNOWN' NOT NULL,
	"tin" text,
	"tin_type" "tin_type",
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "party_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role_label" text,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "party_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"doc_type" "party_doc_type" NOT NULL,
	"file_id" uuid NOT NULL,
	"effective_date" date,
	"expiry_date" date,
	"required_for_payment" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"amount_cents" bigint,
	"start_date" date,
	"end_date" date,
	"alert_thresholds_bps" integer[] DEFAULT '{7500,9000,10000}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"firm_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"side" "rate_side" NOT NULL,
	"rate_kind" "rate_kind" DEFAULT 'REGULAR' NOT NULL,
	"rate_cents" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "consultant_id" uuid;--> statement-breakpoint
ALTER TABLE "consultant" ADD CONSTRAINT "consultant_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant" ADD CONSTRAINT "consultant_sub_vendor_party_id_party_id_fk" FOREIGN KEY ("sub_vendor_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_bill_to_party_id_party_id_fk" FOREIGN KEY ("bill_to_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_end_client_party_id_party_id_fk" FOREIGN KEY ("end_client_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_prime_party_id_party_id_fk" FOREIGN KEY ("prime_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_implementation_partner_party_id_party_id_fk" FOREIGN KEY ("implementation_partner_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_holiday" ADD CONSTRAINT "firm_holiday_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_contact" ADD CONSTRAINT "party_contact_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_contact" ADD CONSTRAINT "party_contact_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_document" ADD CONSTRAINT "party_document_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_document" ADD CONSTRAINT "party_document_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_document" ADD CONSTRAINT "party_document_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_firm_id_firm_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultant_firm_id_idx" ON "consultant" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "engagement_firm_id_idx" ON "engagement" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "engagement_consultant_idx" ON "engagement" USING btree ("consultant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firm_holiday_firm_date_key" ON "firm_holiday" USING btree ("firm_id","holiday_date");--> statement-breakpoint
CREATE INDEX "party_firm_id_idx" ON "party" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_firm_code_key" ON "party" USING btree ("firm_id","code");--> statement-breakpoint
CREATE INDEX "party_contact_firm_id_idx" ON "party_contact" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "party_contact_party_idx" ON "party_contact" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_document_firm_id_idx" ON "party_document" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "party_document_party_idx" ON "party_document" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "purchase_order_firm_id_idx" ON "purchase_order" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "purchase_order_engagement_idx" ON "purchase_order" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "rate_firm_id_idx" ON "rate" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "rate_engagement_idx" ON "rate" USING btree ("engagement_id");