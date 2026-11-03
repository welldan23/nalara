# Security policy

NALARA is in Phase 0 (foundation). There is no public product yet.

## Reporting a vulnerability

Please **do not** open an issue or pull request describing it. Contact the repository owner privately. (GitHub's private vulnerability reporting can be enabled under **Settings → Security** once the repository is public.)

Include:

- what you found and where (file, endpoint, or URL),
- how to reproduce it,
- the impact you expect.

Never include real credentials, session cookies, or personal data in a report. A redacted example is enough.

## Scope

In scope: this repository's code, CI workflows, container and proxy configuration. Out of scope: denial-of-service volume tests, social engineering, and third-party services.

## How the project handles security

- Threat model: [`docs/security/threat-model.md`](docs/security/threat-model.md)
- Architecture and trust boundaries: [`docs/architecture/phase-0.md`](docs/architecture/phase-0.md)
- Incident response and secret rotation: [`docs/runbooks/incident.md`](docs/runbooks/incident.md)
- Dependency and CI policy: [`docs/runbooks/ci-and-dependencies.md`](docs/runbooks/ci-and-dependencies.md)
