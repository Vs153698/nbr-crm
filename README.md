# NBR Backend CRM

Internal applicant & record management system for the **National Book of Records**.

One applicant = one permanent digital profile. The whole lifecycle — application →
verification → payment → certificate → publication → dispatch — is managed from a single
screen, with an automatic read-only timeline and a workflow engine that surfaces the next
step at every stage.

Scope, screens and commercials are defined in [`docs/source/`](docs/source/).
Live build status: open **[`tracker.html`](tracker.html)** in a browser.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | Node 22 · NestJS 11 on Fastify | Fastest mainstream option for this I/O-bound CRUD workload; NestJS gives a long-lived CRM the module structure it needs |
| Database | PostgreSQL 16 · Drizzle ORM | `pg_trgm` fuzzy search and partial indexes serve the search and duplicate-detection requirements with no extra services |
| Cache / queue | Redis 7 · BullMQ | Dashboard counters, sessions, rate limiting, and every heavy job |
| Files | Cloudflare R2 (MinIO locally) | Direct-to-storage presigned uploads; the API only records metadata |
| Web | React 18 · Vite · TanStack Query · Tailwind | *(not yet built — see tracker)* |
| Shared | `@nbr/shared` | Zod schemas, the workflow state machine and the RBAC vocabulary, imported by **both** sides so the form and the endpoint cannot disagree |

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in the secrets it asks for
pnpm infra:up                 # Postgres, Redis, MinIO, Mailpit
pnpm --filter @nbr/shared build
pnpm db:migrate
pnpm db:seed
pnpm dev:api
```

Generate the secrets the env schema demands:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET, and again for JWT_REFRESH_SECRET
openssl rand -base64 32   # PII_ENCRYPTION_KEY
openssl rand -hex 32      # NBR_WEBHOOK_SECRET
```

The API refuses to start on a missing, malformed or placeholder secret rather than failing
later on the first request that needs it.

Health check: `GET /health` · API base: `/api/v1`

## Repository layout

```
apps/api/          NestJS API
  src/database/    Drizzle schema (48 tables), migrations, idempotent seed
  src/auth/        argon2id, JWT sessions, database-driven RBAC guard
  src/applicants/  Master profile, duplicate detection
  src/records/     Workflow state machine + Smart Workflow Engine
  src/privacy/     DPDP: identifier encryption, PII access logging
  src/timeline/    Append-only activity log
  src/audit/       Append-only audit trail
apps/web/          React SPA (not yet built)
packages/shared/   Domain kernel — statuses, transitions, permissions, Zod schemas
docs/source/       Client requirement documents & the production plan
tracker.html       Build progress tracker
```

## Guarantees enforced by the database, not by convention

Several requirements are absolute ("timeline must be read-only", "old certificates should
never be deleted", "audit logs cannot be edited"). Those are enforced in Postgres, so a bug
in a service — or a compromised API process — still cannot break them:

- **Append-only** (trigger-blocked `UPDATE`/`DELETE`): `timeline_events`, `audit_logs`,
  `certificate_versions`, `note_revisions`, `consent_records`, `pii_access_log`,
  `erasure_log`, `login_attempts`
- **Never deletable**: `notes`, `evidence_files`
- **Money invariants** (`CHECK`): `final_amount = amount − discount + GST`, and paid can
  never exceed the total — an overpayment must be an explicit refund
- **Duplicate prevention**: partial unique index on the normalised mobile number
- **Child consent** (DPDP §9): a minor's consent row without a named guardian is rejected

## India DPDP Act, 2023

NBR is the Data Fiduciary; applicants are Data Principals. Implemented controls:

- **§5** — versioned consent notice; old versions never overwritten
- **§6** — append-only per-purpose consent ledger with notice version, channel, IP, timestamp
- **§8(4)** — Aadhaar/passport/PAN AES-256-GCM encrypted, held in a separate table, masked by
  default, revealed only with the `pii:reveal` permission plus a written reason — and the
  access log is written *before* the value is returned
- **§8(5)** — breach register with a 72-hour notification deadline; closure without a Board
  notification requires a written justification, enforced by constraint
- **§8(7)** — retention policies per data class, with erasure that anonymises rather than
  hard-deletes so tax-mandated financial history survives
- **§9** — age computed at intake; guardian required for minors
- **§11–§14** — data-principal request register with identity gate and response deadline

These are engineering controls. **Have a lawyer review the notice wording and retention
periods before go-live.**

## Extending the system

The plan requires that future phases plug in without a rebuild. Concretely:

- **New workflow stage** → add a code to `RECORD_STATUS`, its transitions to
  `STATUS_TRANSITIONS`, its next-step actions to `STAGE_ACTIONS`, and a seed row. No schema
  migration; the state machine, UI badges and Smart Action panel all follow.
- **New permission** → add it to `MODULE_ACTIONS`. The seed picks it up, and it appears in
  the Users & Roles grid automatically.
- **New module** → the schema already carries the full V1.0 module map, so applicant-portal,
  payment-gateway and QR-verification phases attach to existing tables.

## Commands

| Command | Does |
|---|---|
| `pnpm dev:api` | API in watch mode |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Idempotent seed — safe to re-run on every deploy |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm typecheck` | Typecheck every package |
| `pnpm infra:up` / `infra:down` | Local dependencies |

> **Note:** `tsx` cannot run the API — esbuild does not emit decorator metadata, which
> NestJS dependency injection requires. Use `pnpm dev:api` (Nest CLI / tsc) or
> `nest build && node dist/main.js`. The migration and seed scripts have no decorators and
> run fine under `tsx`.
