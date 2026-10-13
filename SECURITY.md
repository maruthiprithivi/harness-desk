# Security

## Report privately

Use [GitHub's private vulnerability report form](https://github.com/maruthiprithivi/harness-desk/security/advisories/new). Do not post exploit details, credentials, private transcripts or real configuration in public issues.

Include the version, platform, expected impact and a minimal synthetic reproduction. Remove sensitive data from attachments. Maintainer response times are not guaranteed.

## Supported releases

The current preview is the supported release line. Fixes arrive in newer previews; earlier builds may require upgrading. Native Windows acceptance and some live agent checks remain incomplete.

## Local trust boundary

Harness Desk runs under your account and can edit explicitly selected configuration. Loopback binding, Host/Origin checks and request tokens protect its browser interface. It is not a sandbox against malicious local processes, extensions or a compromised agent.

Agent requests and verification can reach providers and start hooks or tools. Review generated scripts before execution. Portable file checks cannot prevent every hostile concurrent filesystem replacement.

No remote telemetry service is required. Keep generated data private and review outbound context. See [privacy and recovery](docs/privacy.md).
