CREATE TABLE "legacy_mirror" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"legacy_app_code" varchar(60),
	"legacy_status" varchar(40),
	"legacy_stage" varchar(40),
	"legacy_url" varchar(1000),
	"certificate_number" varchar(80),
	"certificate_url" varchar(1000),
	"certificate_revoked" boolean DEFAULT false NOT NULL,
	"invoice_url" varchar(1000),
	"awardee_slug" varchar(200),
	"awardee_url" varchar(1000),
	"awardee_published" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	"inbound_hash" varchar(64),
	"outbound_hash" varchar(64),
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_outbound_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_mirror_record_uq" ON "legacy_mirror" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_mirror_external_uq" ON "legacy_mirror" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "legacy_mirror_applicant_idx" ON "legacy_mirror" USING btree ("applicant_id");--> statement-breakpoint
-- Declared here rather than in the Drizzle table definition: governance.ts sits
-- above records.ts in the import order, and a .references() either way round
-- would create a cycle between the two schema modules.
ALTER TABLE "legacy_mirror"
  ADD CONSTRAINT "legacy_mirror_record_fk"
  FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "legacy_mirror"
  ADD CONSTRAINT "legacy_mirror_applicant_fk"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE cascade;
