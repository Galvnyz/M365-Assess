# [CRITICAL] Modern Authentication Enabled

**CheckId:** EXO-AUTH-001.1 | **Status:** Fail | **Severity:** Critical | **Effort:** medium | **Horizon:** now

**Suggested labels:** fail, horizon:now, severity:Critical

## Current state
False

## Recommended state
True

## Remediation
Run: Set-OrganizationConfig -OAuth2ClientProfileEnabled $true. Or in Exchange admin center > Settings > Modern authentication > Enable.


