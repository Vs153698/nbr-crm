CREATE TABLE "imported_record_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"imported_record_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"subject" varchar(300),
	"body" text NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" varchar(20),
	"error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_number" varchar(120) NOT NULL,
	"holder_name" varchar(200) NOT NULL,
	"record_title" varchar(1000) NOT NULL,
	"category" varchar(150),
	"issued_at" timestamp with time zone NOT NULL,
	"email" varchar(200),
	"phone" varchar(30),
	"location" varchar(250),
	"bio" text,
	"achievement_date" timestamp with time zone,
	"cover_image_url" varchar(1000),
	"extra_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"awardee_slug" varchar(250),
	"verify_url" varchar(1000),
	"awardee_url" varchar(1000),
	"is_published" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoke_reason" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imported_record_activity" ADD CONSTRAINT "imported_record_activity_imported_record_id_imported_records_id_fk" FOREIGN KEY ("imported_record_id") REFERENCES "public"."imported_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_record_activity" ADD CONSTRAINT "imported_record_activity_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imported_activity_record_idx" ON "imported_record_activity" USING btree ("imported_record_id");--> statement-breakpoint
CREATE INDEX "imported_activity_due_idx" ON "imported_record_activity" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_records_certificate_uq" ON "imported_records" USING btree ("certificate_number");--> statement-breakpoint
CREATE INDEX "imported_records_holder_idx" ON "imported_records" USING btree ("holder_name");--> statement-breakpoint
CREATE INDEX "imported_records_issued_idx" ON "imported_records" USING btree ("issued_at");