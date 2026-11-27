# Contributing

Run `npm ci`, `npm test` and `npm run build`. Use focused regression tests for metric, authorization and persistence changes. Preserve approved baselines, history, unknown-data semantics and source lineage. Keep customer fixtures and runtime data out of pull requests. Do not introduce live AI/API calls into tests or sample startup.

Submit a pull request describing the behavior changed and how it was verified. Prefer small domain functions and explicit permission checks. Report security issues privately to the repository maintainer rather than posting credentials, exploit tokens or private customer records in a public issue.
