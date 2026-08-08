CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"original_size_bytes" bigint,
	"checksum_sha256" varchar(64),
	"description" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_documents_employee_idx" ON "employee_documents" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_documents_storage_key_uq" ON "employee_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_documents_checksum_uq" ON "employee_documents" USING btree ("employee_id","checksum_sha256") WHERE "employee_documents"."checksum_sha256" is not null and "employee_documents"."deleted_at" is null;