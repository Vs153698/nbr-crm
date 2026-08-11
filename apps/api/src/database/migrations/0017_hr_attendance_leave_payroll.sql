CREATE TABLE "employee_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"status" varchar(30) NOT NULL,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"worked_minutes" integer,
	"remarks" text,
	"marked_by_user_id" uuid,
	"marked_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type" varchar(30) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_by_name" varchar(150),
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_by_user_id" uuid,
	"applied_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"payslip_number" varchar(60) NOT NULL,
	"monthly_salary" numeric(12, 2) NOT NULL,
	"working_days" numeric(5, 1) NOT NULL,
	"payable_days" numeric(5, 1) NOT NULL,
	"lop_days" numeric(5, 1) DEFAULT '0.0' NOT NULL,
	"gross_pay" numeric(12, 2) NOT NULL,
	"total_deductions" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"net_pay" numeric(12, 2) NOT NULL,
	"earnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'issued' NOT NULL,
	"remarks" text,
	"generated_by_user_id" uuid,
	"generated_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_address" varchar(300);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "monthly_salary" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ctc" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "probation_ends_on" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pan_number" varchar(20);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_name" varchar(150);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account_number" varchar(40);--> statement-breakpoint
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_attendance" ADD CONSTRAINT "employee_attendance_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_requests" ADD CONSTRAINT "employee_leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_requests" ADD CONSTRAINT "employee_leave_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_requests" ADD CONSTRAINT "employee_leave_requests_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payslips" ADD CONSTRAINT "employee_payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payslips" ADD CONSTRAINT "employee_payslips_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_attendance_day_uq" ON "employee_attendance" USING btree ("employee_id","on_date");--> statement-breakpoint
CREATE INDEX "employee_attendance_date_idx" ON "employee_attendance" USING btree ("on_date");--> statement-breakpoint
CREATE INDEX "employee_attendance_status_idx" ON "employee_attendance" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "employee_leave_employee_idx" ON "employee_leave_requests" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE INDEX "employee_leave_status_idx" ON "employee_leave_requests" USING btree ("status","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_payslips_number_uq" ON "employee_payslips" USING btree ("payslip_number");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_payslips_period_uq" ON "employee_payslips" USING btree ("employee_id","period_year","period_month") WHERE "employee_payslips"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "employee_payslips_employee_idx" ON "employee_payslips" USING btree ("employee_id","period_year","period_month");