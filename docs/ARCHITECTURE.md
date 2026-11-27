# Architecture and future Bidlark integration

Fieldboard is a TypeScript React application with an Express API. The UI and API run from one origin. Vite builds static assets; the server serves them in preview and production. Fonts are bundled locally.

The default database is PGlite, an embedded PostgreSQL engine. Setting `DATABASE_URL` uses node-postgres and a PostgreSQL server. Both adapters execute the same SQL and transactional domain operations. The schema is in `server/db.ts`.

## Authoritative data and history

Organizations, users, sessions and projects have dedicated relational tables. Typed project records hold sections, tasks, materials, reports, crews, issues, schedule revisions and attachments in validated JSONB. All project records have IDs, monotonically increasing versions and timestamps. Project-scoped locks serialize domain mutations; updates compare the expected version and return HTTP 409 on conflict. Client submissions use an idempotency key to avoid duplicate reports on retry.

The `events` table is a durable transactional change log and outbox. Every domain mutation appends the resulting source record inside the same database transaction. Historical reconstruction replays the latest event for each entity through the requested timestamp. Report exports retain the complete computed snapshot; later edits cannot change an existing report's baseline or metric values. Publication snapshots use a separate explicit external allowlist.

The standalone domain has one authoritative schedule per standalone project. A proposed revision never changes the task or project baseline until approved. A material update never mutates schedule dates. Report approval changes contribution eligibility without generating duplicate time or production rows; a void removes eligibility but retains all history.

## Metric contract

Metrics return `key`, `label`, `value`, `unit`, `calculation`, `sourceRecordIds`, `sourceVersion`, `asOf`, `scope`, `missingData`, and `coverage`. Unknown values are `null`. Field and PM hours are separate. Draft, submitted, rejected and voided reports are excluded from approved totals.

Task progress uses the configured method: cumulative approved installed quantity divided by target quantity; cumulative approved earned standard hours divided by estimate; or the latest approved manual percentage. A verified actual completion date may establish completion. Project progress weights eligible leaf tasks by approved estimated hours and excludes summary rows and milestones. A task with missing required progress evidence prevents a falsely complete aggregate. Estimated project labor is used only when full leaf-task estimates are unavailable, never added to task estimates.

Date ranges filter period labor and intersect crew assignment dates. Progress is cumulative through the selected end date. Schedule and materials represent state at `asOf`, not a transaction-date filter. The UI and exports use the same projection function. `asOf` must be a past ISO timestamp; it reconstructs the then-current source versions. Task and project source IDs are included in lineage, and drilldown loads historical source records even if a cumulative record predates the report's period start.

Readiness requires an approved section release, cleared prerequisites and sufficient per-task allocated materials. Explicitly material-free tasks can omit requirements; otherwise absent requirements remain unknown. Each material row represents an allocation to one activity, not a warehouse stock balance. Crew conflict checks detect overlapping assignments for the same normalized crew name and are explicitly potential conflicts, not proof of a centralized resource constraint.

## API outline

All internal routes require a session. Writes require `X-Fieldboard-Request: 1`, same-origin requests and role authorization. Project record creation also requires `Idempotency-Key`.

- `/api/auth/status`, `/setup`, `/login`, `/logout`
- `/api/me`, `/api/users`, `/api/password`, `/api/views`
- `/api/projects`, `/api/portfolio`, `/api/sample`
- `/api/projects/:id/dashboard?sectionId=&from=&to=&asOf=`
- `/api/projects/:id/metrics/:key` and `/events`
- `/api/projects/:id/records/:kind` and `/records/:recordId`
- `/api/projects/:id/approvals/:recordId/decision`
- `/api/projects/:id/exports` and `/exports/:exportId/pdf|xlsx|json`
- `/api/projects/:id/publications` and `/publications/:publicationId`
- `/api/publications/:token` (public, read-only, expiring)
- `/api/projects/:id/documents` and `/documents/:documentId[/scan]`
- `/api/projects/:id/structure`, `/template`, `/api/import`, `/api/templates`

Actual API routes are the source of truth; this implementation uses `/api`, not the illustrative `/api/v1` route naming from the original product brief.

## Project setup interchange

The downloadable setup JSON has `schemaVersion: 1`, `project`, `sections`, `tasks`, and `materials`. Collection entries contain an original `id` and validated `data`. Import generates new destination IDs and remaps references within one transaction. Invalid references roll back the whole import. Completed tasks and actual material receipts cannot be imported as verified facts. Exports clear completion and receipts so setup files cannot silently become fabricated actuals. Templates also clear dates, section releases and prerequisites.

## Bidlark phase

The future adapter should map Bidlark organization IDs, project IDs, project numbers, customer IDs and member roles into explicit external identifiers. Bidlark's organization/project schema and organization membership roles were inspected as an integration reference; no proprietary application code is included here.

Before connecting, establish one authority for schedule tasks, approved progress/time and procurement. Replace standalone reads with authorized adapter projections, or ingest versioned source events idempotently with an `(organization, source, sourceEventId)` uniqueness constraint. Retain upstream source IDs and versions in every metric. Do not dual-write dates or purchase-order statuses to independent modules. Map roles on the server and preserve project-level and field-level permissions. Billing entitlements must never substitute for authorization.

This release contains no live Bidlark connection, cross-service event consumer or estimate importer for proprietary formats. Standalone OIDC is supported through explicit issuer/subject mappings; shared Bidlark identity remains later integration. The JSON interchange and pure metric functions are the integration seam, not a claim that those connectors exist.

## Standalone expansion

`analysis.ts` computes production windows, working-calendar dependency scenarios, approved financial projections and personal resource availability. `reporting.ts` defines nine report tables; `exports.ts` consumes the same immutable snapshot as the UI. Branding and portfolio scope are frozen at export time, and downloads recheck current project and field permissions.

Organization memberships override legacy home-organization roles per session. `organizations.ts` handles creation/switching/membership grants. `oidc.ts` uses openid-client code flow with PKCE, state and nonce; local roles always remain authoritative. Mapping an SSO account requires the home organization's administrator. No email-based automatic account linking occurs.

`notifications.ts` writes durable notifications within source transactions and generates deduplicated reminders. `jobs.ts` runs reminders, opt-in retention and configured encrypted backups with one job at a time per process. `backup.ts` uses a consistent SQL snapshot, a trusted table allowlist and authenticated encryption; restore requires an empty database and excludes active sessions.

Resource calendars are organization-owned. Resource changes are audited and replayed alongside project events for historical projections. Project calculations receive only authorized source records; financial and management-comment records are filtered on the server.

## Scheduled delivery and hosted entitlements

`schedules.ts` stores timezone-aware daily/weekly/monthly schedules and unique recipient jobs. Workers claim jobs with SQL locks and leases, freeze the reporting time and snapshot, recheck tenant/project/role access before each attempt, and retry transient SMTP errors up to five times. A paused schedule or revoked access stops delivery. Internal recipients receive only authorized report attachments; customer recipients receive expiring allowlisted single-project links. Tokens exist in the protected outgoing payload until SMTP accepts the message, then the payload is removed. Delivery is at-least-once: an SMTP connection loss after acceptance can produce a duplicate with the same Message-ID. DST spring gaps skip that local day; repeated fall hours run once.

`signup.ts` optionally creates new isolated workspaces after a one-use expiring email verification. Password hashes, not passwords, are staged. `billing.ts` defaults to the fully included open-source edition. Optional Stripe mode creates server-priced Checkout sessions and organization-bound portal sessions; raw signed webhooks reconcile the current subscription, deduplicate event IDs, and enforce dashboard access without relaxing role checks. No client-supplied price, customer or organization can grant entitlement.
