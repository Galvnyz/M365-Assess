# Security Policy

## Scope

M365 Assess is a **read-only** assessment tool. It connects to Microsoft 365 services using `Get-*` cmdlets and read-scoped Microsoft Graph API calls. It does not create, modify, or delete any tenant configuration.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |


## Reporting a Vulnerability

If you discover a security issue in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use [GitHub Security Advisories](https://github.com/Galvnyz/M365-Assess/security/advisories/new)
3. Include steps to reproduce and any relevant logs (with tenant PII redacted)

You should receive a response within 72 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Design Principles

- **Read-only operations**: All collectors use read-only cmdlets and Graph API scopes. No write permissions are requested or used.
- **No credential storage**: The tool never stores credentials, tokens, or secrets to disk. Authentication is delegated to Microsoft's identity libraries (MSAL).
- **Minimal permissions**: Each collector documents exactly which API permissions it requires. Certificate-based auth scopes are limited to the minimum needed.
- **PII in output**: Assessment output files contain tenant data (usernames, domains, policy names). Treat output folders as confidential and share only through secure channels.
- **Sample reports**: The included sample report in `docs/sample-report/` has all tenant PII replaced with fictional Contoso data.
