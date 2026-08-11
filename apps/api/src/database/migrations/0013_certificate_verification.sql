ALTER TABLE "certificates" ADD COLUMN "verification_status" varchar(30) DEFAULT 'awaiting_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "verified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "verified_version" integer;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "verification_notes" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

--
-- Backfill: place existing certificates where they already stand.
--
-- The column defaults to 'awaiting_upload', which is right for a new row and
-- wrong for every row that already exists. Left as-is, every certificate ever
-- issued would read as un-uploaded, the certificate queue would fill with
-- records that were dispatched months ago, and the new guard would refuse to
-- let any of them move.
--
-- Three populations, decided by evidence already in the database rather than by
-- a guess:
--

-- 1. A certificate with an uploaded file, on a record that has already moved
--    past the certificate stage. The stage plainly completed — someone shipped
--    it — so it is recorded as verified, credited to whoever uploaded the
--    current version and stamped with that version's upload time. That is the
--    most truthful statement available: the file is real, the approval happened,
--    and this is who touched it and when.
UPDATE "certificates" c
   SET "verification_status" = 'verified',
       "verified_version"    = c."current_version",
       "verified_at"         = v."created_at",
       "verified_by_user_id" = v."uploaded_by_user_id",
       "verification_notes"  = 'Recorded on migration — this certificate stage completed before verification was tracked separately.'
  FROM "certificate_versions" v,
       "records" r
 WHERE v."certificate_id" = c."id"
   AND v."version"        = c."current_version"
   AND r."id"             = c."record_id"
   AND r."status" IN (
         'certificate_uploaded', 'publication', 'dispatch_pending',
         'dispatched', 'delivered', 'completed'
       );--> statement-breakpoint

-- 2. A certificate with an uploaded file on a record still in the certificate
--    stage. The file exists, nobody has signed it off — which is exactly the
--    state the new flow calls 'pending_verification', and exactly the queue an
--    employee should now see it in.
UPDATE "certificates" c
   SET "verification_status" = 'pending_verification'
 WHERE c."verification_status" = 'awaiting_upload'
   AND EXISTS (
         SELECT 1 FROM "certificate_versions" v WHERE v."certificate_id" = c."id"
       );--> statement-breakpoint

-- 3. A certificate row with no version behind it is the NBR website's
--    auto-minted number, recorded for reference. Nothing has been uploaded, so
--    the default 'awaiting_upload' is already correct — but `current_version`
--    was seeded at 1 by its column default and now counts real uploads, so it
--    is corrected to zero. Without this the first genuine upload would be
--    numbered v2 with no v1 behind it.
UPDATE "certificates" c
   SET "current_version" = 0
 WHERE NOT EXISTS (
         SELECT 1 FROM "certificate_versions" v WHERE v."certificate_id" = c."id"
       );