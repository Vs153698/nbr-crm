ALTER TABLE "settings" ADD COLUMN "is_secret" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Retrofit the two credentials that already existed before this column did.
-- The seed only inserts on conflict-do-nothing, so a fresh install gets these
-- flagged correctly from the seed data below, but an already-migrated database
-- needs the existing rows corrected here or their real values keep going out
-- in the GET /settings response until someone happens to re-seed.
UPDATE "settings" SET "is_secret" = true
WHERE "key" IN ('mail.smtp_password', 'integrations.legacy.secret');