# Fieldboard v0.1 release scope

This is a working standalone beta with persisted records and complete core operating workflows. It is not a claim that every enterprise feature in the longer dashboard specification is finished.

## Implemented and exercised

Project setup and portfolio; sections and releases; editable task definitions; approval-controlled schedule revisions; quantity/earned/manual progress; approved field hours; PM/overtime separation; material allocations, holds and delivery risks; crew assignments and potential conflicts; issues/RFIs; report submission/approval/rejection/voiding; audited versioned changes; filtered source drilldown; historic baseline reconstruction; PDF/Excel/JSON snapshot exports; customer publication/expiry/revocation; project templates and JSON setup interchange; attachment quarantine; server role and project checks; saved layouts and filters; responsive screens and stale-state warnings.

The public sample is synthetic and visibly marked. Missing actual records, financial inputs, baseline dates or confirmations remain unavailable. A separately supplied local customer fixture is excluded from the public source tree.

## Verification

The initial release was exercised with automated tests for formulas and API workflows, TypeScript checking, a production frontend build, dependency auditing, a browser submission-to-approval workflow, desktop/mobile inspection, and rendered PDF/Excel inspection. Disk persistence is tested by closing and reopening the embedded database. See the release record for the actual final test count.

The Docker recipe and node-postgres adapter are supplied; a deployed multi-user PostgreSQL environment and a real ClamAV installation have not been validated in this local release. Customer deployment requires staging verification and a tested backup/restore plan.

## Remaining specification work

- Native Bidlark, Interactive Gantt and Material & Manpower module integration with upstream source ownership and event reconciliation.
- SSO/OIDC, multiple organization memberships, self-service tenant signup and subscription entitlements. The open-source install currently has one organization and no billing.
- Detailed resource calendars and person-level availability; critical path/float and dependency-driven forecasts; approved cost inputs and financial projections.
- Full progress S-curves, production forecasting and configurable multi-factor health policies. Current health supports a schedule-delay threshold and recorded material/blocker risk.
- Comments, mentions, automatic reminders, richer risk probability/impact scoring, submittals and customizable escalation policies.
- Additional report-specific layouts and company-logo customization. The current branded project report includes the organization name, selected metrics, labor data, milestones, constraints and calculation evidence.
- Automated emailed reports, retention administration, managed backup jobs and production observability/load qualification.

These are documented future work, not hidden buttons or mocked integrations. Core actions present in the UI call real APIs and persist their results.
