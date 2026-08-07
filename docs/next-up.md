# Next up

Three open items, captured so they can be picked up cold.

---

## 1. Backfill returns 500 — diagnose first, fix second

Every `application.backfill` push is being rejected with HTTP 500 by the CRM.
The 500 is generated **inside the CRM**, so the legacy sync log only records the
status, never the cause.

Ruled out so far:

- **Migration 0005 (`legacy_plan_id`).** `applyPayment` never selects that
  column — only `packages.id` and `packages.name`. The column is used by
  `syncPackages`, which is not on the import path.
- **Legacy-side SQL.** `getSyncBreakdown` and the scoped
  `listSyncableApplicationIds` were checked; the generated statements are valid,
  and `crm_sync_log` is created by the legacy migration with `IF NOT EXISTS`.

### Get the actual error

The CRM writes every failed import to `integration_events`, including the
exception message. Run against the **CRM** database:

```sql
SELECT event_type, status, error, created_at
  FROM integration_events
 WHERE status = 'failed'
 ORDER BY created_at DESC
 LIMIT 5;
```

That names the failing column, constraint or validation directly. Failing that,
the API log line for the same request id carries the stack.

Two candidates worth checking against whatever it reports:

- The CRM's `packages` table is queried during `applyPayment`. If the deployed
  API predates migration 0005 but the **database** has it, that is harmless; the
  reverse — code newer than schema — is not. Confirm both are on the same
  commit.
- `nbr_immutable_unaccent` and the `pg_trgm` / `unaccent` extensions. These were
  only ever created by `infra/postgres/init/01-extensions.sql`, which a managed
  Postgres never runs. `migrate.ts` now bootstraps them, but a database migrated
  **before** that fix will still be missing them, and duplicate detection during
  import uses them.

---

## 2. Email templates must match the legacy HTML exactly

Today the CRM sends plain text assembled from a `{{placeholder}}` body. The
legacy site sends styled HTML — see `backend/src/lib/email.ts`, which builds
full documents starting `<!DOCTYPE html><html><body style="font-family:Arial,
sans-serif;background:#f8fafc;padding:24px">` and repeats that shell for each
message type.

Requirement: an applicant must not be able to tell which system sent the mail —
same markup, same spacing, same everything.

### Work

1. **Extract the legacy shell** into a shared layout in `packages/shared`, so
   both systems render from one definition rather than two that drift.
2. **Store HTML bodies.** `templates.body` is currently a text blob rendered by
   `renderTemplate`. Keep the placeholder syntax; change the payload to HTML and
   send it as the `html` part, with a generated text fallback.
3. **Template editor UI.** `Admin → Templates` edits raw text in a textarea.
   It needs to edit HTML with a live preview of the rendered result, and the
   create form must start from the same shell so a new template matches the
   others by default.
4. **Migration.** Templates live in the database once seeded, so existing rows
   need converting — the constants only govern fresh installs.

---

## 3. Imported certificates — a separate section, not applicants

Offline records brought in through the legacy `POST /admin/certificates/import`
create a `certificates` row with `application_id = NULL` plus an `awardees` row.
There is **no application**, which is why the existing sync — keyed entirely on
`applications` — has never picked them up.

This resolves the open question from earlier: they are **not** applicants and
must not be merged into that pipeline.

### Shape

- **New legacy endpoint** exposing imported certificates, alongside the existing
  `/plans` and `/categories` readers.
- **New CRM table**, e.g. `imported_records`, with no foreign key to
  `applicants` or `records`. Holder name, record title, category, certificate
  number, issue date, awardee slug, public certificate URL, and whatever contact
  details the import captured.
- **New page: Imported Records.** A listing, a detail view, and a link out to
  the public certificate.
- **Exactly four actions**, and nothing else: send email, send WhatsApp, add a
  note, add a task.
- **Backfill plus ongoing.** One run for what exists, then a detached push from
  the legacy import route so future imports arrive automatically — the same
  fire-and-forget pattern the approve and payment hooks already use.

### Note

The CRM's inbound applicant schema requires `mobile` and `email`; many historic
holders have neither. Keeping these in their own table sidesteps that entirely,
which is a further argument for the separation the client asked for.
