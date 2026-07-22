# Security policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Please do not open a public issue containing exploit details or credentials. Use GitHub's private vulnerability reporting flow for this repository.

Never include live API keys, tokens, private drafts, runtime data, or local filesystem contents in a report.

## Deployment boundary

Tweet Lab is a single-operator, local-first application. It binds to `127.0.0.1` by default and does not implement user accounts or session authentication. Do not expose it directly to the public internet. Put any remote access behind an authenticated reverse proxy, VPN, or zero-trust access layer.

The API can read and modify drafts and can trigger configured external adapters. Treat access to the server as operator access.

## Secret handling

- Keep secrets in a private environment file outside the repository.
- Never commit `data/tweet-lab.json`; it can contain drafts, contacts, analytics, and audit records.
- Use least-privilege, read-only X credentials where possible.
- Postiz writes remain blocked unless both the operator intentionally schedules an approved draft and server-side credentials are configured.
- Rotate any credential that was ever committed, even if the commit was later removed.
