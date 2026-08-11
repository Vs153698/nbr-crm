-- Approved leave was written into the register as `on_leave`, a status worth
-- nothing towards a payable day. That made every kind of leave a deduction:
-- somebody taking two days of casual leave — leave they had earned and were
-- owed — had two days docked.
--
-- `on_leave` now means paid leave and is worth a full day. The days that really
-- are unpaid move to their own status, so the register can still express both.
--
-- Only rows this system wrote from an approved unpaid request are moved. A day
-- an operator marked by hand is left exactly as they marked it.
UPDATE "employee_attendance" AS a
SET "status" = 'leave_without_pay'
FROM "employee_leave_requests" AS l
WHERE a."status" = 'on_leave'
  AND l."employee_id" = a."employee_id"
  AND l."status" = 'approved'
  AND l."leave_type" = 'unpaid'
  AND a."on_date" BETWEEN l."from_date" AND l."to_date";
