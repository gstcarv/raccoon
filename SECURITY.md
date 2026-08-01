# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities by emailing: **security@raccoon** (or open a private security advisory on GitHub).

Include:
- Description of the vulnerability and potential impact
- Steps to reproduce
- Affected version(s)
- Any suggested mitigations

We aim to acknowledge reports within 48 hours and provide a fix or mitigation within 14 days for critical issues.

## Security Considerations

### Secrets

- No secrets are ever written to the repository. See `.env.example` for required variables.
- GitHub tokens and webhook secrets are redacted from logs (`[REDACTED]`).
- GIT credentials are injected via `GIT_ASKPASS` — never embedded in remote URLs or written to disk in plaintext.
- MCP configuration files containing tokens are written with `0600` permissions and deleted after use.

### Agent Permissions

- By default, Claude Code runs **without** `--dangerously-skip-permissions`.
- To enable it, set `RACCOON_ALLOW_DANGEROUS_PERMISSIONS=true`. A warning is logged at startup. Only use this inside an isolated container or sandbox.

### Webhook Verification

- All incoming webhooks are verified via HMAC-SHA256 using `timingSafeEqual` to prevent timing attacks.
- Unverified requests are rejected with HTTP 401.

### Rate Limiting

- The `/webhooks` endpoint is rate-limited to 200 requests/minute.

### Network

- The agent process environment has GitHub secrets (`GITHUB_TOKEN`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`) stripped before spawning Claude Code.
