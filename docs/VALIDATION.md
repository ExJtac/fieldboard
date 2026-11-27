# v0.2.0 validation record

Validation performed locally on November 26, 2026 (America/Denver), using synthetic fixtures only.

## Automated verification

- Full test suite: 54 tests, covering the original core flows plus forecasts, EVM, availability, approvals, collaboration, identity, backup encryption/recovery and dependency interchange.
- TypeScript and Vite production build pass.
- Native PostgreSQL idle-connection termination recovers without crashing the service; shutdown waits for connection sockets before temporary database cleanup.
- All nine report layouts produce PDF and Excel; generated Excel workbooks are reopened and their expected sheets checked.
- Native PostgreSQL 14: all 27 expanded workflow, delivery, signup and billing tests pass against the same SQL adapter used for server PostgreSQL.
- Native PostgreSQL backup and restore: restored table counts and audit history match the source; restoration refuses a nonempty destination. Embedded recovery also checks file content and authenticated-encryption failure on tampering/wrong keys.
- Native PostgreSQL load fixture: 100 tasks and 100 approved reports, 80 dashboard reads, eight concurrent requests. p95 265 ms; maximum 271 ms on this host. This is a local staging measurement, not an SLA.
- OIDC: local protocol fixture signs RS256 identity tokens; code exchange checks state, PKCE, nonce, issuer/subject mapping and replay denial. A real customer provider is deployment configuration.
- Real ClamAV engine with downloaded main/daily/bytecode signatures: a clean PDF is downloadable after scanning; a PDF containing the harmless EICAR antivirus test file is quarantined and download is denied.

- SMTP: a local protocol server accepts real PDF/Excel messages and external publication links, simulates transient rejection, and verifies durable retries, pause/version checks, permission revocation and DST schedules. No real recipients were contacted.
- Stripe: signed webhook verification, replay deduplication, subscription reconciliation, expiry/cancellation gates, server-owned checkout parameters and customer portal routing pass contract tests. No real checkout payment was attempted.
- Signup: the local SMTP verification link creates an isolated organization only once; unauthenticated/replayed access is denied.
- Container: the final Compose application and PostgreSQL 17 start successfully; an isolated trusted test HTTPS proxy verifies setup/login, Secure HttpOnly cookies and project persistence. ClamAV clears a clean file and denies embedded EICAR.

## Browser and visual checks

Browser acceptance uses the separate `.data/qa` sample workspace, never the user's local workspace. Analysis curves and production tables, comment submission, specialized report generation, financial screens, resource availability, schedule create/edit/pause and open-source access settings are checked. Desktop and mobile layouts and browser console errors are reviewed. PDF output is rendered with Poppler for visual inspection.

## Reproduce

```sh
npm ci
npm test
npm run build
npm audit
PG_TEST_ADMIN_URL=postgresql://user:password@127.0.0.1:5432/postgres npx tsx scripts/verify-postgres.ts
CLAMAV_CONTAINER=fieldboard-scanner npx tsx scripts/verify-scanner.ts
npx tsx scripts/verify-exports.ts
```

The PostgreSQL script creates uniquely named temporary databases on a dedicated staging instance, runs tests, measures load, verifies recovery and removes only those databases. The scanner script requires a running maintained ClamAV container. It creates an isolated in-memory app and does not touch customer data.

CI repeats the normal suite/build/audit and runs the expanded native PostgreSQL workflow tests against PostgreSQL 17. Deployment-specific TLS/SSO/SMTP/Stripe credentials and off-host backup custody remain the operator's responsibility.
