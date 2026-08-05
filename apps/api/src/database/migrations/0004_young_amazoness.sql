CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" varchar(30) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"personal_email" varchar(255),
	"work_email" varchar(255),
	"mobile" varchar(20) NOT NULL,
	"alternate_phone" varchar(20),
	"date_of_birth" date,
	"gender" varchar(20),
	"photo_key" varchar(500),
	"department" varchar(120),
	"designation" varchar(120),
	"employment_type" varchar(30) DEFAULT 'full_time' NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"joined_on" date,
	"exited_on" date,
	"work_location" varchar(150),
	"reports_to_employee_id" uuid,
	"user_id" uuid,
	"address_line" varchar(300),
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(12),
	"emergency_contact_name" varchar(150),
	"emergency_contact_phone" varchar(20),
	"emergency_contact_relation" varchar(60),
	"notes" text,
	"is_directory_visible" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"called_by_user_id" uuid,
	"called_by_name" varchar(150),
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"duration_minutes" integer,
	"summary" text NOT NULL,
	"follow_up_at" timestamp with time zone,
	"resulting_status" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_code" varchar(20) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"mobile" varchar(20) NOT NULL,
	"mobile_normalised" varchar(20) NOT NULL,
	"email" varchar(255),
	"city" varchar(100),
	"state" varchar(100),
	"achievement_summary" text,
	"category" varchar(150),
	"status" varchar(30) DEFAULT 'new' NOT NULL,
	"source" varchar(30) DEFAULT 'cold_call' NOT NULL,
	"source_detail" varchar(200),
	"owner_user_id" uuid,
	"next_follow_up_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"call_count" integer DEFAULT 0 NOT NULL,
	"converted_applicant_id" uuid,
	"converted_record_id" uuid,
	"converted_at" timestamp with time zone,
	"lost_reason" varchar(300),
	"notes" text,
	"extra" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_called_by_user_id_users_id_fk" FOREIGN KEY ("called_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_applicant_id_applicants_id_fk" FOREIGN KEY ("converted_applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_record_id_records_id_fk" FOREIGN KEY ("converted_record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_uq" ON "employees" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_uq" ON "employees" USING btree ("user_id") WHERE "employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department","status");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "lead_calls_lead_idx" ON "lead_calls" USING btree ("lead_id","called_at");--> statement-breakpoint
CREATE INDEX "lead_calls_user_date_idx" ON "lead_calls" USING btree ("called_by_user_id","called_at");--> statement-breakpoint
CREATE INDEX "lead_calls_outcome_idx" ON "lead_calls" USING btree ("outcome","called_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_code_uq" ON "leads" USING btree ("lead_code");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_mobile_open_uq" ON "leads" USING btree ("mobile_normalised") WHERE "leads"."deleted_at" is null and "leads"."status" not in ('converted','lost','not_interested','unqualified');--> statement-breakpoint
CREATE INDEX "leads_status_owner_idx" ON "leads" USING btree ("status","owner_user_id");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "leads_updated_idx" ON "leads" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at") WHERE "leads"."next_follow_up_at" is not null and "leads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "leads_mobile_idx" ON "leads" USING btree ("mobile_normalised");--> statement-breakpoint
-- Business ID sequences. Separate from the applicant and record series so a
-- lead number can never be mistaken for a record number, and so importing a
-- batch of leads does not advance the record counter.
CREATE SEQUENCE IF NOT EXISTS lead_code_seq START WITH 1 INCREMENT BY 1;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS employee_code_seq START WITH 1 INCREMENT BY 1;--> statement-breakpoint
-- Self-reference for the reporting line. Declared here rather than in the
-- Drizzle table: a self-referencing FK inside the table definition is a
-- circular type reference that drizzle-kit cannot infer.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_reports_to_fk"
  FOREIGN KEY ("reports_to_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL;
