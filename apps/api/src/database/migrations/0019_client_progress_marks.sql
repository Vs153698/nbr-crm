CREATE TABLE "record_progress_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"stage" varchar(40) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"marked_by_user_id" uuid,
	"marked_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_progress_marks" ADD CONSTRAINT "record_progress_marks_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_progress_marks" ADD CONSTRAINT "record_progress_marks_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_progress_marks_stage_uq" ON "record_progress_marks" USING btree ("record_id","stage");