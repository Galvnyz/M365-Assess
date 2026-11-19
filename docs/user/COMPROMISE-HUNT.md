# Compromise Indicators

The standard assessment answers "is this tenant configured securely?". The opt-in **Compromise** section answers a different question: "are there signs this tenant has already been compromised?". It looks for the artefacts an intruder typically leaves behind after taking over a mailbox or an account.

It is a point-in-time hunt, not monitoring. It does not replace Microsoft Defender, Microsoft Sentinel or any other SIEM, and it takes no action in the tenant.

## Running it

```powershell
# Compromise checks only
Invoke-M365Assessment -TenantId contoso.onmicrosoft.com -Section Compromise

# Alongside a normal assessment, reviewing 14 days of directory audit history
Invoke-M365Assessment -TenantId contoso.onmicrosoft.com `
    -Section Tenant,Identity,Email,Security,Compromise -CompromiseLookbackDays 14
```

The section is never included by `-Section All`. It reads the inbox rules of every mailbox, one mailbox at a time, so on a large tenant it can run for a long time. Name it explicitly when you want it.

### Permissions

No new consent is needed. The section uses only access that other sections already request:

| Scope | Needs |
|---|---|
| Mailbox checks | Exchange Online, `View-Only Organization Management` |
| Directory checks | Microsoft Graph `AuditLog.Read.All`, `Directory.Read.All`, `Organization.Read.All` |

The two halves run independently. If Exchange Online cannot be reached, the directory checks still run, and the other way round.

## What it checks

| Check | Looks for | Result when found | MITRE ATT&CK |
|---|---|---|---|
| `IOC-INBOXRULE-001` | Inbox rules that forward or redirect mail to an address outside your accepted domains | Fail | T1114.003 |
| `IOC-INBOXRULE-002` | Inbox rules that delete or bury mail and also match finance or security keywords, use a punctuation-only name, or move mail to RSS or Conversation History folders | Warning | T1564.008 |
| `IOC-FORWARD-001` | Mailbox-level forwarding to an external address | Warning | T1114.003 |
| `IOC-CONSENT-001` | Consent and permission grants in the window that include mail, file or directory-write permissions | Warning | T1528 |
| `IOC-SPCRED-001` | Secrets or certificates added to applications and service principals in the window | Warning | T1098.001 |
| `IOC-ROLEADD-001` | Members added to high-privilege directory roles in the window | Warning | T1098.003 |

**Fail** means the artefact is strongly associated with compromise and should be treated as an incident until explained. **Warning** means the event is often legitimate (a planned secret rotation, an approved admin) and needs a person to confirm it.

## Reading the results

Each check reports one of three outcomes:

| Outcome | Meaning |
|---|---|
| Indicators found (Fail or Warning) | Something matched. The report lists each event with the account, the target and what was found. |
| Pass | Nothing matched, **and** everything in scope was examined. The result states how much was examined, for example "examined 412 of 412 mailboxes". |
| Unknown ("not evaluated") | The check could not examine everything, for example a query was refused or some mailboxes could not be read. No conclusion can be drawn. The reason is given under "Limits of this check". |

A check never reports Pass on incomplete data. If the rules of 3 mailboxes out of 400 could not be read and nothing was found in the other 397, the result is Unknown, not Pass. If indicators were found and coverage was incomplete, the indicators are still reported, with a note that more may exist.

**A clean result is not proof that the tenant is uncompromised.** It covers only what these checks examine, over the window they could see.

Compromise results are not part of the posture score, the framework pass rates or the remediation roadmap. They appear in their own "Signs of compromise" section of the HTML report, on a "Compromise Indicators" sheet in the XLSX, and in the two `*-Compromise-*.csv` files in the assessment folder. The CSV files hold the full event lists; the report shows the first 50 events per check.

## Limits you should know about

- **Audit log retention.** Entra ID keeps directory audit logs for 7 days without a premium licence and 30 days with Entra ID P1 or P2. The directory checks state the window that was really visible. Asking for 30 days on a tenant that keeps 7 gives you 7.
- **Inbox rules have no creation date.** The hunt shows current rules and cannot say when a rule was added.
- **Hidden rules.** Rules hidden through direct MAPI manipulation are not returned by `Get-InboxRule`, even with `-IncludeHidden`.
- **Legitimate activity matches too.** Real forwarding, real clean-up rules and routine secret rotations look the same as malicious ones. Every hit needs a human decision.
- **Fixed lists.** High-impact permissions and privileged roles are matched against fixed lists in the collector. Custom roles and role activations through PIM are not listed.
- **Not covered yet.** Sign-in anomalies, Identity Protection risk signals, federation and Conditional Access tampering, and MFA method changes are planned as further checks.

## If the hunt finds something

1. Do not delete the artefact straight away. Record it first: the report and CSV are your evidence.
2. Confirm with the mailbox or application owner whether they made the change.
3. If it is unexpected, treat the account as compromised: reset the password, revoke sessions, review registered MFA methods and recent sign-ins, then remove the rule, grant, credential or role assignment.
4. Check what the attacker could reach through it (mail sent to the external address, data the application could read).
5. Follow your incident response process and any notification obligations.

When sharing results outside your organisation, use `-EvidencePackage -Redact` and review the package first. See [EVIDENCE-PACKAGE.md](EVIDENCE-PACKAGE.md) for what redaction does and does not remove.
