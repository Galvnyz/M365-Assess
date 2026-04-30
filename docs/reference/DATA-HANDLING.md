# Data Handling

> **Schema version:** 1.0 (2026-04-26) — sources of authority: this doc, [`SECURITY.md`](../SECURITY.md), [`docs/PERMISSIONS.md`](PERMISSIONS.md).

M365 Assess is a **read-only** assessment tool, but the data it *collects* is sensitive: tenant configuration, user identities, mailbox metadata, admin role assignments, app registrations, audit evidence, and policy contents. This document covers what's collected, where it lands, and how to handle it through the consultant lifecycle.

If you're looking for the short version, see the README's [Output Structure](../README.md#output-structure) and [Security Design Principles](../SECURITY.md#security-design-principles). This document is the deep-dive.

---

## What is collected, by section

The collectors that ship today produce these data classes. Each row lists the **most-sensitive content** in that section's output — the rest is configuration metadata.

| Section | Most-sensitive content | Notes |
|---|---|---|
| **Tenant** | Tenant ID (GUID), display name, verified domains | Domain list reveals subdomain structure; treat as confidential |
| **Identity** | UPNs of all users, sign-in activity, admin-role memberships, MFA method types per user, CA policy bodies, app-registration IDs + redirect URIs | This is the densest PII section |
| **Licensing** | SKU assignments per UPN, license counts | UPN-keyed; treat as PII |
| **Email** | Mailbox owner UPNs, forwarding rules, DKIM keys, SPF/DMARC records | Forwarding rules and audit-bypass settings are sensitive — they reveal compromise vectors |
| **Intune** | Device IDs, primary user UPNs, compliance policy contents, configuration profile bodies | Per-device data; treat as PII |
| **Security** | Defender policies (Safe Links/Safe Attachments allowlists), DLP policy bodies, secure-score history | Allowlists may expose vendor names and internal infrastructure |
| **Collaboration** | SharePoint sharing settings (tenant-level), Teams policies, Forms tenant settings | Tenant-level, not per-document |
| **Inventory** | Mailbox enumeration, group memberships, Teams enumeration, SharePoint sites enumeration | Inventory output can be **very large** (10K+ rows on bigger tenants); see [Storage](#storage) |
| **PowerBI** | Power BI tenant settings, capacity assignments | No per-user data |
| **Hybrid** | On-prem sync state, password-hash-sync timestamps, agent versions | Reveals AD topology hints |
| **ActiveDirectory** | DC names, replication health, AD security findings | Local AD only — runs on a domain-joined machine |
| **SOC2** | Controls evidence pulled from Graph + Purview | Already-collected data restructured for auditors |
| **ValueOpportunity** | License utilization deltas, feature adoption metrics | Aggregated; per-user not exposed |

**Per-section permissions are documented in [`docs/PERMISSIONS.md`](PERMISSIONS.md)** (generated from the runtime maps; CI fails on drift).

---

## Sensitivity classification

| Class | Examples | Handling guidance |
|---|---|---|
| **PII** | UPNs, email addresses, display names, IP addresses (in sign-in logs), device names | Never share unredacted output via email, chat, or unencrypted channels |
| **Tenant identifiers** | Tenant ID GUID, vanity domain, `.onmicrosoft.com` short, app registration IDs | Confidential — useful for an attacker constructing targeted phishing |
| **Configuration secrets** | DKIM public keys (not private), CA policy bodies, app redirect URIs | Configuration not credentials; still confidential |
| **Audit evidence** | Sign-in logs, admin role assignments, MFA method types | High value to an attacker mapping the tenant |
| **Aggregates** | License counts, MFA percentages, secure score, framework coverage % | Generally low-sensitivity; safe to share in proposals (with tenant identity stripped) |

> **No credentials are stored.** M365 Assess delegates authentication to MSAL via the Microsoft Graph SDK. Tokens live in the SDK's secure storage (Windows Credential Manager / macOS Keychain / Linux libsecret) for the runtime of the session and are not persisted to the assessment output folder.

---

## Storage

By default, output lands at:

```
M365-Assessment/
  Assessment_YYYYMMDD_HHMMSS_<tenant>/
    *.csv
    _Assessment.json
    _Assessment-Report_<tenant>.html
    _Compliance-Matrix_<tenant>.xlsx
    _Issues-Found_<tenant>.txt
    Logs/
      assessment-YYYYMMDD-HHMMSS.log
  Baselines/
    <Label>_<TenantGuid>/   # see C1 #780
      *.json
      manifest.json
```

The root `M365-Assessment/` folder defaults to the **current working directory** when you ran `Invoke-M365Assessment`. Use `-OutputFolder <path>` to redirect.

Connection profiles (separately) live under per-user app data:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%/M365-Assess/profiles.json` |
| Linux | `$XDG_CONFIG_HOME/M365-Assess/profiles.json` |
| macOS | `~/.config/M365-Assess/profiles.json` |

Profiles do **not** contain credentials — only `TenantId`, `ClientId`, `CertificateThumbprint` (a public reference; the cert itself lives in the OS cert store), `UserPrincipalName`, `Environment`. Still treat them as confidential.

---

## Sharing securely

For consultant deliverables to clients:

1. **Verify before send** — open the HTML report and grep the CSVs for any sandbox/test data left from prior runs (search for `localhost`, `test`, prior tenant names).
2. **Prefer authenticated channels** — encrypted email (Microsoft Purview Message Encryption, S/MIME) or a per-engagement secure portal. Avoid attachments to general-purpose email or open chat.
3. **Treat ZIP packages as confidential** — when the [`-EvidencePackage` mode (D4 #788)](https://github.com/Galvnyz/M365-Assess/issues/788) ships, the resulting ZIP is the canonical sanitised deliverable. Hash manifest verifies integrity.
4. **Strip tenant identifiers from public artifacts** — for blog posts, conference slides, or sample reports committed to a public repo, scrub UPNs, domain names, IP addresses, and tenant GUIDs.

For internal team review:

- A shared SharePoint site or OneDrive folder with explicit ACLs (no "anyone with the link") is appropriate.
- Per-engagement subfolders so client A's data isn't visible to consultants on client B's engagement.

---

## Redaction

Two redaction surfaces exist or are planned:

- **Today**: collectors do not auto-redact. The HTML report includes `-WhiteLabel` to hide branding/attribution, but tenant identities are present.
- **Planned (D4 #788)**: `-Redact` companion to `-EvidencePackage` will scrub UPNs, IPs, app IDs, and tenant display names, replacing them with stable per-tenant hashes so cross-references still resolve. Useful for sample-report preparation and incident-handling diff workflows.

For ad-hoc redaction today, the simplest path is:

```powershell
# Replace all UPNs with placeholders in a CSV
(Get-Content .\09-Mailbox-Summary.csv) -replace '[\w.-]+@[\w.-]+\.\w+', 'user@redacted.invalid' |
    Set-Content .\09-Mailbox-Summary.redacted.csv
```

Treat hand-rolled redaction as best-effort, not authoritative.

---

## Deletion

Output folders are owned by the user who ran the assessment. To remove:

```powershell
# Remove a single assessment run
Remove-Item -Path '.\M365-Assessment\Assessment_20260425_134522_contoso.com' -Recurse -Force

# Remove all assessment runs but preserve baselines
Get-ChildItem .\M365-Assessment -Directory -Filter 'Assessment_*' | Remove-Item -Recurse -Force

# Nuclear -- everything M365-Assess wrote
Remove-Item .\M365-Assessment -Recurse -Force
```

Connection profiles:

```powershell
# Per-profile remove
Remove-M365ConnectionProfile -ProfileName 'Production'

# Remove all profiles for the current user
Remove-M365ConnectionProfile -All
```

Baselines older than your retention window:

```powershell
# Anything older than 90 days, preserving recent ones
Get-ChildItem .\M365-Assessment\Baselines -Directory |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Recurse -Force
```

---

## Retention recommendations

These are starting points; your engagement contract or compliance regime may dictate longer or shorter windows.

| Artifact | Default retention | Rationale |
|---|---|---|
| Latest assessment per client | Indefinite (until deliverable accepted) | Active consultant artifact |
| Prior assessment runs | 30-90 days | Drift comparison context; longer for compliance audits |
| Baselines | 1 year minimum (CMMC); 7 years for SOC 2 evidence trails | Regulatory bodies expect time-series posture |
| Connection profiles | Until engagement ends | Convenience only; never required to retain |
| Logs | 90 days | Debug context; redact UPNs before any external sharing |
| Sanitised evidence packages (D4) | 7 years for audit trails | Hash manifest survives; auditors verify integrity |

---

## Compliance fit

Working notes for consultants on how M365 Assess output relates to common regimes. **Not legal advice; consult your compliance officer.**

### GDPR

- Output contains personal data (UPNs, sign-in IPs). When operating on EU tenants, treat the assessment output folder as in-scope for Article 32 processing-security obligations.
- Right-to-erasure: when a client asks you to delete their data, the [Deletion](#deletion) commands above remove the assessment artifacts. Baselines under `Baselines/<Label>_<TenantGuid>/` need explicit deletion.
- Cross-border transfer: don't host assessment output on infrastructure outside the data residency commitments you've made to your client.

### HIPAA

- A tenant containing ePHI (Microsoft 365 in healthcare) means the assessment output may incidentally contain ePHI references (mailbox enumeration, group names). Treat as ePHI for storage + transmission.
- BAA: ensure your assessment-running infrastructure is covered if you operate as a Business Associate.

### CMMC v2.0 / NIST 800-171

- Assessment output may contain CUI metadata (DoD contractors). Handle per the contracting flowdown.
- Baselines provide longitudinal evidence for the L2 assessment process. Retain per the contract's RMF cycle.

### SOC 2

- The SOC2 collector output is designed to feed Type 1 and Type 2 evidence packages.
- Hash manifest from `-EvidencePackage` (D4) gives the auditor an integrity-checkable artifact set.

---

## Data flow diagram (mental model)

```
[ M365 Tenant ]                           [ Consultant Workstation ]
      |                                            |
      |  Get-* cmdlets                             |
      |  Read-only Graph                           |
      |  EXO/Purview/PowerBI read APIs             |
      v                                            v
[ Microsoft Graph / EXO / Purview ] -------> [ M365-Assessment/ ]
                                                   |
                                                   |  PII, configuration,
                                                   |  audit evidence
                                                   v
                                           [ HTML / XLSX / CSV / JSON ]
                                                   |
                                                   |  Encrypted channel
                                                   v
                                           [ Client deliverable ]
```

No data leaves the consultant workstation except through the consultant's explicit action. M365 Assess does not phone home, telemetry-report, or update from a remote source at runtime.

---

## Related

- [`SECURITY.md`](../SECURITY.md) — read-only design principles, vulnerability reporting
- [`docs/PERMISSIONS.md`](PERMISSIONS.md) — per-section permissions matrix (generated)
- [`docs/CHECK-STATUS-MODEL.md`](CHECK-STATUS-MODEL.md) — status semantics
- [Issue #788](https://github.com/Galvnyz/M365-Assess/issues/788) — `-EvidencePackage` mode (D4)
- [Issue #786](https://github.com/Galvnyz/M365-Assess/issues/786) — License-adjusted scoring (D2)
