# Initial release validation

Verified on November 26, 2026:

- 24 automated tests passed against the embedded PostgreSQL engine, including the disk persistence reopen test.
- TypeScript checking and the Vite production frontend build passed.
- `npm audit` reported zero vulnerabilities at the time of this release.
- Browser test: a submitted 16-hour sample report did not affect the KPI until approval; approval produced exactly 16 approved field hours.
- Desktop and narrow mobile layouts were inspected. A mobile filter overflow was fixed and checked again.
- PDF export was rendered and inspected; Excel output was reopened and its approved-hours value checked against the saved snapshot.
- Scope/permission tests cover organization isolation, project assignments, customer viewer restrictions, CSRF checks, duplicate approvals, optimistic conflicts and publication expiry/revocation.
- Imports remap IDs atomically; invalid references roll back. Templates reset completion, releases, dates and receipts.

`docs/images/dashboard.png` shows synthetic local QA data, not a live customer project. Browser QA used an isolated local database, separate from the new user's workspace.

Not verified in this release: native PostgreSQL server deployment, Docker runtime, managed hosting under concurrent customer load, real ClamAV execution, SSO, live Bidlark integration, disaster recovery and enterprise security review. See OPERATIONS.md and RELEASE-SCOPE.md before customer deployment.
