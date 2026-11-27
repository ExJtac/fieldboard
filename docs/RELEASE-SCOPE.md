# Fieldboard v0.2 standalone release

The standalone construction-management workflows in the source specification are implemented with persisted records, server authorization, source evidence and tests. See [the acceptance matrix](ACCEPTANCE.md) for the exact mapping and boundaries and [validation](VALIDATION.md) for the test evidence.

New in v0.2: production curves and trends; dependency/critical-path forecast proposals; person calendars and leave; approval-controlled financial register and EVM; expanded requests, risks and submittals; comments/mentions/notifications/reminders; nine report layouts and branding; multiple organizations and optional OIDC; encrypted backups/recovery, retention and telemetry; tested native PostgreSQL and actual attachment scanning; scheduled report delivery, verified signup and optional hosted Stripe subscriptions.

This release does not connect to Bidlark. Live Bidlark/Gantt/procurement adapters remain separate later work. SMTP delivery and Stripe checkout/portal/webhook entitlements are implemented, with local SMTP and signed-webhook contract tests. Their external accounts have not been provisioned or live-tested. No customer data is copied into the public source. Public sample data remains visibly marked, and unavailable measurements remain unavailable.

A deployment requires an HTTPS origin, persistent database storage, maintained scanner definitions and protected backup keys. Optional SSO requires the operator's provider configuration. The app can also run privately on localhost with password authentication and embedded PostgreSQL. See [operations](OPERATIONS.md).
