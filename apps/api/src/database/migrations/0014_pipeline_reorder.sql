--
-- Pipeline reorder: Publication moves from before dispatch to after delivery.
--
-- No schema change — the status codes are unchanged and this migration is
-- entirely about records that are standing in the wrong place because the old
-- order put them there.
--
-- Under the old pipeline a record went Certificate → Publication → Dispatch, so
-- everything currently at `publication` was put there *before* its parcel was
-- sent. Under the new order Publication comes after delivery, which leaves
-- those records in a stage that no longer has a route to dispatch: the
-- transition Publication → Dispatch Pending has been removed, so they would sit
-- there with no legal move and never ship.
--
-- Their certificate is complete and the parcel has not gone out, which is
-- precisely Dispatch Pending. Publication rows already attached to them are
-- untouched — only the stage moves, so nothing written for the magazine or the
-- website is lost, and the record will pass back through Publication after it
-- is delivered.
-- Done as one data-modifying CTE so the timeline note is written for exactly
-- the rows this migration moved. Selecting them back afterwards by timestamp
-- would be a guess, and would sweep in any record that happened to be edited in
-- the same minute by someone else.
WITH moved AS (
  UPDATE "records"
     SET "status"     = 'dispatch_pending',
         "updated_at" = now()
   WHERE "status" = 'publication'
     AND "deleted_at" IS NULL
  RETURNING "id", "applicant_id"
)
-- Leave a note on each one, so nobody finds a record moved overnight with no
-- explanation. Recorded as a system action rather than attributed to whoever
-- happens to run the deploy.
INSERT INTO "timeline_events" ("applicant_id", "record_id", "event_type", "summary", "meta", "actor_kind", "actor_name")
SELECT m."applicant_id",
       m."id",
       'status_changed',
       'Publication → Dispatch Pending — publication now follows delivery in the pipeline, and this record had not been dispatched yet.',
       jsonb_build_object('from', 'publication', 'to', 'dispatch_pending', 'automatic', true, 'reason', 'pipeline reorder'),
       'system',
       'System'
  FROM moved m;
