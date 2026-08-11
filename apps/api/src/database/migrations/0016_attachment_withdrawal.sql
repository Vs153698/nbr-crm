ALTER TABLE "attachments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;