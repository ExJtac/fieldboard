# Operating Fieldboard

## Local workspace

`npm ci && npm run build && npm start` serves the built app on `127.0.0.1:4310`. Data persists in `.data/postgres`. Stop the process before moving or backing up an embedded database. Port and directory may be set through `PORT` and `DATA_DIR`.

First-run setup creates one organization and one administrator. A password must contain at least 12 characters. Passwords use scrypt with a random salt; sessions use random 256-bit tokens, hashed in the database, with a 12-hour expiry. There is no account recovery email service. Administrators create additional accounts and assign projects. Preserve administrator credentials in your own password manager.

A private fixture override may be supplied as `PILOT_FIXTURE=/absolute/path/to/project.json`. It overrides sample project metadata, always retains the sample flag, and must not be committed. The public repository ships only generic sample data.

## HTTPS and PostgreSQL deployment

Use a dedicated hostname rooted at `/`, such as `dashboard.example.com`. Subpath mounting is not supported in v0.1. The CAS-TX `/Dashboard` route is a product page, not a shared production workspace.

Create an ignored `.env` with these values. Generate your own database password and setup token, for example using `openssl rand -hex 32`. Use URL-safe hexadecimal credentials in the Compose example.

```dotenv
APP_ORIGIN=https://dashboard.example.com
SETUP_TOKEN=YOUR_RANDOM_SETUP_TOKEN
POSTGRES_PASSWORD=YOUR_RANDOM_DATABASE_PASSWORD
```

Then run:

```sh
docker compose up -d --build
```

The app is bound to loopback port 4310. Put your HTTPS reverse proxy in front of it. For example, a Caddy site block can use `reverse_proxy 127.0.0.1:4310`. The database is not published on a host port. Only enable `TRUST_PROXY=1` behind one trusted reverse proxy; do not expose the upstream port directly.

The production process refuses to start without an HTTPS `APP_ORIGIN` and `SETUP_TOKEN`. Enter the setup token in the first-run form. After setup, the endpoint refuses further installation attempts. Secure, HttpOnly, SameSite=Strict cookies are used in production. Keep the runtime environment and setup token private.

For a native installation, set `NODE_ENV=production`, `APP_ORIGIN`, `SETUP_TOKEN`, and a dedicated `DATABASE_URL`; build before starting. Schema setup is additive and idempotent. It does not delete or reseed existing records. Use a dedicated database role and database. The local embedded database and a remote PostgreSQL database are separate stores; changing `DATABASE_URL` does not migrate existing data.

## Access model

| Role          | Access                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Administrator | All organization projects, team access, setup, approvals, publications                            |
| PM            | All organization projects, records, templates, approvals and publications; no team administration |
| Foreman       | Assigned projects; daily reports, issues, uploads; no approvals or schedule administration        |
| Purchasing    | Assigned projects; material records and issues; no approvals or daily time entry                  |
| Viewer        | Published customer snapshots only; no internal project API access                                 |

Internal users can inspect project labor hours. Payroll rates, salaries and approved costs are not stored in this version. Customer publication payloads omit labor hours, rates, notes, reports, source IDs, attachments and pending revisions. Publication links are bearer links: anyone holding a valid link can view its frozen snapshot until expiry or revocation. Link tokens are shown once and stored only as hashes. A revoked link cannot undo a previously downloaded or copied report.

## Attachments

Files must have PDF, PNG or JPEG signatures and be at most 8 MB. Contents are stored in the project's database, not an unprotected public directory. Downloads require both project authorization and a clean scan result.

Set `CLAMSCAN_PATH` to the absolute path of a maintained ClamAV scanner and update its malware definitions through your host's normal service. Uploads are scanned in a private temporary directory. Missing scanner, timeout, scanner error or detection leaves the file quarantined. A PM can request a rescan from Documents. The base Docker image intentionally does not bundle a malware-signature database; extend it with your managed scanner setup before accepting real attachments. Automated tests verify the fail-closed quarantine behavior; real ClamAV execution was not validated in the initial local release.

## Backup and restore

Back up the entire database: it contains projects, audit history, users, attachments, exports and publication snapshots. Encrypt backups, restrict access, store a copy outside the app host and periodically test restoration.

For embedded PostgreSQL: stop the process, copy the complete `.data/postgres` directory to protected backup storage, then restart. Restore to a new directory while stopped, point `DATA_DIR` there and verify `/api/health` plus representative project records before serving users. Never run two processes against the same embedded directory.

For Compose PostgreSQL:

```sh
docker compose exec -T db pg_dump -U fieldboard -d fieldboard -Fc > fieldboard-backup.dump
```

Restore into a separately provisioned test database with `pg_restore`; verify counts, historical reports, attachment access and tenant boundaries. Do not use a development database dump to overwrite a live installation. Preserve the PostgreSQL volume during code upgrades. `docker compose down -v` destroys the volume and is not an upgrade command.

No automatic purge or retention deletion runs in v0.1. Reports and audit events accumulate. Establish your organization's retention policy before production use; export/archive workflows do not permanently erase records.

## Monitoring and scaling

`GET /api/health` verifies database connectivity. Server errors go to stderr without request bodies or credentials. The UI refreshes every 30 seconds and marks failed refreshes stale. Events are written in the same transaction as their records. Dashboard projections query authoritative records on demand; no fire-and-forget rollup jobs are required.

Use PostgreSQL for multiple server processes. The initial rate limiter is process-local; use a shared limiter at your ingress before scaling horizontally. No multi-process load benchmark, disaster-recovery exercise, penetration test or hosted SLA was completed for this beta. CI validates the build and the local PostgreSQL engine. Validate the Compose/native PostgreSQL deployment in your own staging environment before customer rollout.
