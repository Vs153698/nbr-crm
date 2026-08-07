ALTER TABLE "templates" ADD COLUMN "document" jsonb;
--> statement-breakpoint
-- Carry existing email templates over to the new content areas.
--
-- The constants only govern a fresh install, so any system already running has
-- Admin-editable rows holding plain text that the new renderer cannot draw.
-- Each is converted into paragraphs split on blank lines, which preserves the
-- wording exactly — including any rewording an Admin has done, which is why
-- this does not simply overwrite the seven system templates with the richer
-- shipped defaults.
--
-- The heading falls back to the template's own name. It is the one part with no
-- equivalent in the old format, and it is the first thing an Admin will see and
-- adjust in the editor.
UPDATE "templates"
   SET "document" = jsonb_build_object(
         'heading', "name",
         'blocks', (
           SELECT jsonb_agg(jsonb_build_object('type', 'paragraph', 'text', btrim(para)))
             FROM unnest(regexp_split_to_array("body", E'\n[[:space:]]*\n')) AS para
            WHERE btrim(para) <> ''
         ),
         'signoff', 'Warm regards,'
       )
 WHERE "channel" = 'email'
   AND "document" IS NULL
   AND btrim(coalesce("body", '')) <> '';
