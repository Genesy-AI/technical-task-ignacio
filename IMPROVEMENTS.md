# Codebase Improvements & Roadmap

> This document is a living engineering backlog. Items are grouped by theme and labelled **P0** (critical / blocks production), **P1** (high value, next sprint), or **P2** (nice-to-have / tech debt). Each item includes a brief rationale and a concrete direction.

---

## 1. Architecture

### P0 — Decouple the Temporal worker from the API process

**Current state:** `index.ts` both starts the Express server and calls `runTemporalWorker()`. A crash in the worker brings down the HTTP API and vice versa.

**Direction:** Extract the worker into a separate entry point (`src/worker-main.ts`) and run it as its own process (or container). The two processes communicate only through the Temporal server, which is the intended design.

---

### P0 — Open a single Temporal client connection per process, not per request

**Current state:** Both `/leads/verify-emails` and `/leads/enrich-phone` call `Connection.connect()` and `connection.close()` inside the request handler on every invocation. This is expensive and can exhaust file descriptors under load.

**Direction:** Create the `Connection` and `Client` once at startup, store them as module-level singletons, and reuse them across all requests.

```typescript
// init once
const connection = await Connection.connect({ address: 'localhost:7233' })
export const temporalClient = new Client({ connection })

// in handlers — no connect/close
const result = await temporalClient.workflow.execute(...)
```

---

### P1 — Add graceful shutdown

**Current state:** Killing the process mid-flight drops in-progress requests and leaves Temporal connections open.

**Direction:** Listen on `SIGTERM`/`SIGINT`, stop accepting new requests (`server.close()`), wait for in-flight requests to drain, then shut down the Temporal worker and DB client.

---

### P2 — Replace SQLite with PostgreSQL for anything beyond local dev

SQLite serialises all writes and does not support concurrent connections well. The existing Prisma setup is database-agnostic; switching is a one-line change in `schema.prisma` + a migration.

---

## 2. API Design & Validation

### P0 — Add a request validation layer (Zod or similar)

**Current state:** Every route hand-rolls `if (!field) return res.status(400)...` with inconsistent checks. The `bulkImport` error type uses `lead: any`.

**Direction:** Define Zod schemas co-located with each route. Validate input at the boundary, derive TypeScript types from the schema, and return structured `{ code, message }` error objects. This eliminates the duplication between frontend API types, backend route guards, and the Prisma model.

---

### P0 — Fix the `POST /leads` field name mismatch

**Current state:** The route reads `req.body.name` but the frontend type sends `firstName`. The route also ignores all optional fields added since the initial implementation.

**Direction:** Align the field name to `firstName` and expand the route to accept the full lead schema (matching `/leads/bulk`).

---

### P1 — Add pagination to `GET /leads`

**Current state:** `prisma.lead.findMany()` returns every row. This will degrade linearly with table size.

**Direction:** Accept `?page=` / `?limit=` query parameters, return `{ data, total, page, pageSize }`, and update the frontend query + table to handle paginated results.

---

### P1 — Replace `PATCH /leads/:id` (backend) with `PUT` or align the frontend

**Current state:** The backend registers `app.patch(...)` but the frontend type (`LeadsUpdateInput`) calls `put`. One of the two needs to change.

---

### P2 — Add authentication and tighten CORS

**Current state:** CORS is `Access-Control-Allow-Origin: *` and there is no auth layer. Any origin can read or mutate all leads.

**Direction:** Short-term: restrict CORS to the known frontend origin. Long-term: add token-based auth (JWT or session) before this is exposed beyond localhost.

---

## 3. Email Verification

### P1 — Make email verification non-blocking

**Current state:** The `/leads/verify-emails` handler calls `client.workflow.execute()` sequentially per lead in a `for` loop, blocking the HTTP response until all workflows complete. With the 30-second activity timeout, a batch of 10 leads can block for up to 5 minutes.

**Direction (fire-and-forget):** Start all workflows with `client.workflow.start()` instead of `execute()`, return a `{ jobId, leadIds }` response immediately, and have the frontend poll a status endpoint or use a WebSocket/SSE stream.

**Direction (parallel execute):** At minimum, run verifications in parallel with `Promise.allSettled()` instead of sequentially.

---

### P1 — Remove the hardcoded `jane.smith` delay from the activity

**Current state:** `verifyEmail` in `activities/utils.ts` sleeps for 20 seconds when the email contains `jane.smith`. This was a deliberate bug planted in the task but should not exist in a real codebase.

---

### P2 — Show a loading state on the Verify Email button

**Current state:** The dropdown button does not reflect `verifyEmailsMutation.isPending`, unlike the Enrich Phone button which shows a spinner.

---

## 4. Phone Enrichment

### P1 — Run phone enrichment in parallel across leads

Same blocking-loop issue as email verification. Use `Promise.allSettled()` to run one workflow per lead concurrently.

---

### P1 — Derive `companyWebsite` more reliably for Orion Connect

**Current state:** The email domain (`john@acme.com` → `acme.com`) is used as the company website. This fails for Gmail/Outlook users and multi-domain companies.

**Direction:** Add an optional `companyWebsite` field to the lead model, allow CSV import of it, and prefer it over the email-domain fallback.

---

### P2 — Implement rate limits when providers announce them

**Current state:** `ORION_CONNECT_RATE_LIMIT_MS` and `ASTRA_DIALER_RATE_LIMIT_MS` are defined as `'0 milliseconds'` placeholders using Temporal's durable `sleep()`.

**Direction:** When providers publish rate limits, update the constants and redeploy. No structural change needed.

---

## 5. Testing

### P1 — Add unit tests for new lead fields in existing test suites

**Current state:**
- `messageGenerator.test.ts` does not test `phoneNumber`, `yearsInRole`, or `linkedInUrl` as template variables.
- `csvParser.test.ts` does not test country code validation, `yearsinrole`, `phonenumber`, or `linkedinurl` column parsing.

**Direction:** Extend both existing test files with coverage for the new fields.

---

### P1 — Add API integration tests

**Current state:** There are zero tests for any Express route. A wrong field name (`name` vs `firstName`) shipped undetected.

**Direction:** Use Vitest + Supertest (or similar) to test the critical paths: bulk import, message generation, email verification (mocked Temporal), phone enrichment (mocked Temporal).

---

### P2 — Add Temporal workflow unit tests

Temporal's SDK provides test utilities (`TestWorkflowEnvironment`) that allow activities to be mocked and time to be skipped, making it practical to test workflow logic without a running server.

---

### P2 — Add React component tests

`LeadsList.tsx` handles a significant amount of UI logic (selection, mutation states, error states) with zero test coverage.

---

## 6. Frontend

### P1 — Split `LeadsList.tsx` into smaller components

**Current state:** ~400 lines handling data fetching, selection state, toolbar actions, and table rendering in one file.

**Direction:** Extract at minimum:
- `<LeadsToolbar>` (import, enrich, delete buttons)
- `<LeadsTable>` (thead + tbody)
- `<LeadRow>` (single row)

This makes each piece independently testable and easier to maintain.

---

### P1 — Standardise mutations through `useApiMutation`

**Current state:** `useApiMutation` exists and has a consistent interface but is only wired for `leads.create`. All other mutations (`deleteMany`, `verifyEmails`, `enrichPhone`, etc.) use inline `useMutation`.

**Direction:** Extend `useApiMutation` to cover all mutations, or remove it and commit to inline `useMutation` everywhere — consistency matters more than which pattern is chosen.

---

### P2 — Virtualise the leads table

When the lead count grows, rendering hundreds of rows in the DOM without virtualisation will cause visible lag. `@tanstack/react-virtual` is a natural fit given TanStack Query is already in use.

---

### P2 — Add a loading skeleton to the leads table

**Current state:** While `leads.isLoading` is true, a spinner is shown. A skeleton that matches the table shape is less jarring and gives users a better sense of the incoming layout.

---

## 7. CSV Import

### P1 — Validate `yearsInRole` is a positive integer

**Current state:** `Number(trimmedValue) || undefined` silently drops non-numeric values. A value of `"abc"` becomes `undefined`; a value of `"-5"` becomes `-5`.

**Direction:** Explicitly check `Number.isInteger(n) && n >= 0` and add an error to the row's `errors` array if the value is present but invalid.

---

### P1 — Validate `linkedInUrl` is a valid URL

**Current state:** Any non-empty string is accepted as a LinkedIn URL.

**Direction:** Check that the value matches `https://www.linkedin.com/in/...` or is a valid URL, and surface a warning if it does not.

---

### P2 — Handle BOM characters in CSV files

Files exported from Excel on Windows often have a UTF-8 BOM (`\uFEFF`) prepended. PapaParse handles this, but the `transformHeader` currently only trims whitespace. Explicitly stripping the BOM from the first header guards against edge cases.

---

## 8. Observability & Operations

### P1 — Add structured request logging

**Current state:** Errors use `console.error`. There is no request-level logging (method, path, status, duration).

**Direction:** Add a lightweight middleware (e.g. `morgan` in dev, structured JSON in prod) so logs are machine-readable and searchable.

---

### P2 — Expose health and readiness endpoints

`GET /health` returning `{ status: "ok", db: "ok", temporal: "ok" }` is a prerequisite for container orchestration (Kubernetes liveness/readiness probes) and simple uptime monitoring.

---

### P2 — Fix the `.env.sample` database URL

**Current state:** `DATABASE_URL` points to a MySQL connection string but the schema uses SQLite. This is misleading for anyone setting up the project fresh.

---

## Summary Matrix

| # | Area | Priority | Effort |
|---|------|----------|--------|
| Decouple worker from API | Architecture | P0 | M |
| Singleton Temporal client | Architecture | P0 | S |
| Request validation (Zod) | API | P0 | M |
| Fix POST /leads field name | API | P0 | S |
| Non-blocking email verification | Email | P1 | M |
| Pagination on GET /leads | API | P1 | M |
| Phone enrichment parallel | Phone | P1 | S |
| Extend test coverage (new fields) | Testing | P1 | S |
| API integration tests | Testing | P1 | M |
| Split LeadsList component | Frontend | P1 | M |
| Standardise useMutation | Frontend | P1 | S |
| Validate yearsInRole / linkedInUrl | CSV | P1 | S |
| Graceful shutdown | Architecture | P2 | S |
| PostgreSQL migration | Architecture | P2 | S |
| Temporal workflow tests | Testing | P2 | M |
| Component tests | Testing | P2 | L |
| Table virtualisation | Frontend | P2 | M |
| Rate limits (enrich phone) | Phone | P2 | S |
| Structured logging | Observability | P1 | S |
| Health endpoint | Observability | P2 | S |

> **Effort key:** S = < 1 day, M = 1–3 days, L = 3+ days
