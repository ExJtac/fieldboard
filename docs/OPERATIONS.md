# Operating Fieldboard v0.2

## Local workspace

Run `npm ci && npm run build && npm start`, then open `http://127.0.0.1:4310`. First-run setup creates the initial organization and administrator. There is no default production password. Local data persists in `.data/postgres`; run only one process per embedded directory. `DATA_DIR` changes that path. `DATABASE_URL` selects a PostgreSQL server instead and takes precedence over the embedded path.

`npm run dev` hot-reloads frontend changes. Restart the server after backend changes. Preserve administrator credentials in a password manager. Passwords use scrypt; sessions use hashed random 256-bit tokens with a 12-hour lifetime. Password changes revoke existing sessions. The service has no password-reset email delivery.

A private `PILOT_FIXTURE=/absolute/path/to/project.json` may override sample project metadata. Customer data and local fixtures must remain outside the public repository. All sample projects remain marked as samples.

## Hosted deployment

Use a dedicated hostname rooted at `/`. The CAS-TX `/Dashboard` page is the public product promotion, not a shared customer workspace. Create a private `.env` containing:

```dotenv
APP_ORIGIN=https://dashboard.example.com
SETUP_TOKEN=YOUR_RANDOM_INSTALLATION_TOKEN
POSTGRES_PASSWORD=YOUR_RANDOM_DATABASE_PASSWORD
```

Generate your own secrets using a password manager or `openssl rand -hex 32`. The Compose example expects URL-safe database credentials. Start with `docker compose up -d --build`. Put an HTTPS reverse proxy in front of the loopback port 4310. The database is not exposed on a host port. Production refuses startup without an HTTPS origin and setup token; enter the token only during first-run installation. Use `TRUST_PROXY=1` only behind one trusted ingress.

Compose persists PostgreSQL records and ClamAV definitions in named volumes. `docker compose down -v` destroys those volumes; it is not an upgrade procedure. Back up first, rebuild the image, and retain the volumes during upgrades. Migrations are additive and idempotent. Changing `DATABASE_URL` does not move existing data; use tested backup/restore into an empty destination.

For native PostgreSQL, supply `NODE_ENV=production`, `APP_ORIGIN`, `SETUP_TOKEN` and a dedicated database/role. HTTPS deployments use Secure, HttpOnly, SameSite=Strict session cookies. The temporary OIDC browser-binding cookie uses SameSite=Lax for the provider callback.

## Permissions and publications

| Role          | Access                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------- |
| Administrator | Organization administration, every organization project, approvals and financials             |
| PM            | Organization projects, operational/financial records and approvals; no account administration |
| Foreman       | Assigned projects, daily reports, issues, comments and uploads                                |
| Purchasing    | Assigned projects, materials, issues, comments and requests                                   |
| Accountant    | Assigned projects and financial submissions; approval requires a PM/admin                     |
| Viewer        | Approved customer publications only                                                           |

Internal roles can inspect project labor hours, but only admin/PM/accountant can read financial records or management comments. Payroll rates/salaries are not stored. Publications use an explicit allowlist that excludes internal labor, money, comments, source IDs, documents and pending revisions. Links are bearer credentials shown once and stored only as hashes, with expiry/revocation. Revocation cannot retract a previously downloaded copy.

## Attachment handling

Uploads accept PDF/PNG/JPEG signatures, at most 8 MB. File bytes stay in the authorized project database. Downloads require both project access and a clean scanner result. Missing definitions, scanner errors, detections and timeouts leave files quarantined. A manager can rescan after the scanner is available. Set `CLAMSCAN_PATH` to an absolute executable path for native installations and maintain its definitions. Never configure a script that simply returns success.

## Multiple organizations and SSO

Settings → Organizations creates an isolated organization and grants its creator an administrator membership. The header organization picker changes only the current session. Administrators can grant an existing installation account membership, then assign projects in Team access. Removing membership revokes sessions; it does not remove memberships in other organizations. The accountant role has assigned-project access and may submit financial entries; PM/admin approve them. Financial values are available only to admin/PM/accountant. Management comments follow the same restriction; external viewers still receive publications only.

Optional OpenID Connect uses the maintained [openid-client implementation](https://github.com/panva/openid-client/blob/main/examples/oidc.ts). Set `OIDC_ISSUER` (HTTPS), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` as required by your provider, and `APP_ORIGIN`. Register the exact redirect URI `APP_ORIGIN/api/auth/oidc/callback`. The application uses authorization-code flow, S256 PKCE, state and nonce, with a ten-minute one-use browser-bound flow. Map the provider's stable subject to a local account in Settings. Email claims never automatically link accounts. Only the account's home organization can map its login identity. Keep a password administrator for provider outages.

## Scanning in Docker

The runtime now includes ClamAV. Compose supplies a signature-updater service and a shared read-only signature volume to the app. Files remain quarantined until definitions are available; scanner errors never clear a file. Monitor updater logs and signature age. `scripts/clamav-docker.mjs` is an optional native-host bridge to an existing scanner container, configured with `CLAMAV_CONTAINER`. It is not required inside Compose.

## Encrypted backups and recovery

Generate and protect a 32-byte hexadecimal backup key with `openssl rand -hex 32`. Supply it as `BACKUP_KEY` through your secrets mechanism. Do not commit it or store the sole copy beside the backups. `BACKUP_DIR` and optional `BACKUP_INTERVAL_HOURS` (default 24) enable consistent in-process scheduled backups. The first check runs within a minute. Backup files use authenticated AES-256-GCM encryption and mode 0600. Backups include identity mappings, source records, files, audit history and saved exports, but not active sessions or OIDC login flows.

For a manual backup, stop an embedded-database app first; PostgreSQL server backups can run while the app is active:

```sh
npm run backup -- create /private/backups/fieldboard.fbbackup
```

Restore into a **new, empty** database/directory with the same `BACKUP_KEY`:

```sh
DATA_DIR=/private/fieldboard-restore npm run backup -- restore /private/backups/fieldboard.fbbackup
```

When `DATABASE_URL` is set it takes precedence over `DATA_DIR`; point it at a new empty PostgreSQL database for recovery. The tool refuses populated destinations. Recovered users sign in again. Verify project/history/file counts and representative exports before changing traffic. Move encrypted copies off-host and monitor backup completion logs; encryption cannot recover a lost key.

## Retention, notifications and telemetry

Settings → Branding and retention can opt into cleanup of **read notifications** and old saved exports. Default retention is 90 and 365 days respectively; automatic cleanup is off until enabled. Source/audit records are retained, publication validity is enforced by expiry/revocation, and no automatic purge removes the history behind metrics. Manual cleanup is restricted to the current administrator's organization. The in-process worker checks due reminders every minute and artifact retention hourly, using durable unique notification keys to prevent duplicates. Preferences control mentions, approvals, changes and reminders.

Settings → Operations displays database/scanner configuration and request counts/error totals. The server records bounded recent response durations and exposes p95 to administrators. `/api/health` continues to verify database availability. Use an external process supervisor, TLS ingress and log monitoring for a hosted installation. Configure off-host backup monitoring independently.

Native PostgreSQL workflows, encryption/recovery, actual ClamAV execution and a bounded load run are validated; see [validation](VALIDATION.md).

## Scheduled report email

Set `SMTP_HOST`, `SMTP_FROM` (one email address), `SMTP_PORT` (default 587), and optionally `SMTP_USER`/`SMTP_PASSWORD`. Use `SMTP_SECURE=1` for implicit TLS on port 465. Remote SMTP requires TLS with certificate verification; plain SMTP is allowed only to a loopback test server. Keep `APP_ORIGIN` equal to the public HTTPS origin so customer links point to the correct host. The Compose recipe passes these settings through.

Project → Reports → New schedule selects cadence, local delivery time, timezone, period, recipients and layout. Internal recipients get PDF/Excel files filtered by their current project and financial permissions. External email addresses get an approved publication link with expiry. Portfolio schedules are internal only. Changes use version checks. Pause prevents queued messages from being sent. Send now creates a distinct run; the worker checks every minute. Recent deliveries show queued, processing, accepted by SMTP or failed. A failed run can be sent again after its cause is resolved.

Jobs use database leases, unique run/recipient keys and five attempts with backoff. A restart resumes durable work. SMTP acceptance is not a guarantee of inbox delivery; use your provider's bounce/delivery monitoring. An ambiguous connection loss after acceptance can cause duplicate mail, with the same Message-ID. At a spring DST gap the nonexistent local time is skipped; a repeated fall time runs only once. Missed schedules after downtime produce one current catch-up report, not a flood of historical messages. Snapshot filters are frozen per run; current permission checks can still cancel delivery.

Publication tokens are normally stored as hashes. A scheduled message necessarily holds its link in its protected outgoing payload until SMTP acceptance; that payload is then discarded. Backups are encrypted. Protect the database and SMTP credentials accordingly.

## Verified signup and optional hosted subscriptions

The default `BILLING_MODE=open_source` includes every installed dashboard feature without payments. It is the recommended mode for an independent self-hosted workspace. `ALLOW_SIGNUP=1` enables public workspace registration only when SMTP and `APP_ORIGIN` are configured. A new owner must follow the one-hour, one-use email verification link before their organization and session are created. Existing addresses receive the same generic response and can sign in. Installation setup remains protected by the setup token.

For an optional hosted paid edition, configure a recurring dashboard Price in your own Stripe account. Set `BILLING_MODE=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`; `STRIPE_ADDITIONAL_PRICE_IDS` can allow comma-separated legacy/dashboard plan prices. Register `APP_ORIGIN/api/billing/webhook` for `checkout.session.completed` and subscription created/updated/deleted events. Enable the Stripe customer portal for your product. Secrets must be server-side; never add them to frontend variables.

Organization administrators activate access in Dashboard access, then manage the subscription through the provider portal. The app grants access only after a valid signed webhook reconciles an active/trialing recognized subscription with an unexpired period. Cancel-at-period-end stays active until expiry; canceled, unpaid or expired subscriptions are blocked. Organization switching and billing management stay available when dashboard access is inactive. Existing publication links retain their explicit expiry and can still be revoked. Role and project permissions remain enforced.

Local tests use a real Stripe signature verifier and an injected provider client. Before turning on paid hosting, use your own Stripe sandbox to verify checkout, payment failure, cancellation, portal access and webhook delivery with the exact deployed endpoint. No real payment or third-party account was created during this release validation. SSO likewise needs acceptance against your configured provider. These settings are optional and do not block standalone open-source use.
