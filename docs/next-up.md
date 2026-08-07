# Next up

One open item, and two that have shipped — kept here with what they became, so
the next person reads the same history.

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

## 2. Email templates — done

Shipped. Templates are no longer text: each is a heading, a strapline and an
ordered set of areas (paragraphs, highlighted values, detail tables, numbered
steps, buttons, side notes) rendered into the website's layout by
`packages/shared/src/utils/email-layout.ts`.

The Admin screen edits those areas beside a live preview and never shows
markup. The preview runs the same renderer the send does. Migration `0008`
converts existing rows into paragraphs, preserving their wording — including
any an Admin had already changed.

WhatsApp stays plain text; the transport has no HTML.

---

## 3. Imported records — done

Shipped, both directions. The website exposes its offline certificates at
`GET /api/crm-connector/imported-certificates` and pushes each new one as it
is imported; the CRM pulls on demand and accepts the push at
`POST /integrations/nbr-website/imported-certificates`. Both converge on one
upsert keyed on the certificate number, so a redelivery refreshes rather than
duplicates.

`Imported Records` in the sidebar lists and searches them, with a detail view
carrying the four permitted actions. Email is genuinely sent; WhatsApp returns
a click-to-chat link, as elsewhere in the product.

---

## Known gaps

- **ESLint is not installed.** `npm run lint` fails with `eslint: command not
  found` in both apps — the dependency is missing from the workspace, so no
  linting has run against any of this.
- **`apps/api` has one test file** (`src/docs/__tests__/openapi.test.ts`).
  The services carry no unit tests; `packages/shared` is the only package with
  meaningful coverage.
