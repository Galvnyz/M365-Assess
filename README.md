# M365 Assess

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/M365-Assess/assets/m365-assess-logo-white.png" />
  <source media="(prefers-color-scheme: light)" srcset="src/M365-Assess/assets/m365-assess-logo.png" />
  <img src="src/M365-Assess/assets/m365-assess-logo.png" alt="M365 Assess" width="500" />
</picture>

### Comprehensive M365 Security Assessment Tool

**Read-only Microsoft 365 security assessment for IT consultants and administrators**

[![CI](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml/badge.svg)](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-check%20CI-informational)](https://github.com/Galvnyz/M365-Assess/actions/workflows/ci.yml)
[![PowerShell 7.x](https://img.shields.io/badge/PowerShell-7.x-blue?logo=powershell&logoColor=white)](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)
[![Read-Only](https://img.shields.io/badge/Operations-Read--Only-brightgreen)](.)
[![Version](https://img.shields.io/badge/version-2.4.0-blue)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Who Is This For?

- **Security Administrator** -- Run CIS benchmark checks against production M365 tenants and get actionable findings with remediation guidance
- **Compliance Officer** -- Map findings to NIST, SOC 2, HIPAA, ISO 27001, and 10+ frameworks simultaneously from a single scan
- **IT Consultant / vCISO** -- Generate branded, white-label assessment reports for client engagements with custom logos and colors
- **Auditor** -- Export an XLSX compliance matrix with per-control framework alignment evidence across 15 frameworks
- **DevOps / CI Pipeline** -- Automated posture monitoring with non-interactive mode, certificate auth, and managed identity support

---

Run a single command to produce CSV reports, a branded HTML assessment report, and an XLSX compliance matrix covering identity, email, security, devices, collaboration, and compliance baselines. **274 security checks** mapped across **15 compliance frameworks**.

## What's New in v2.2.0

| Feature | Description |
|---------|-------------|
| **Roadmap CSV Export** | "Download CSV" button in the Remediation Roadmap exports your prioritized task list — reflecting any custom lane assignments — ready to paste into a project tracker |
| **Evidence Field** | Five key checks (CA MFA admin policy, security defaults, Defender anti-phishing, EXO modern auth, SharePoint sharing) now embed structured evidence data in the report, viewable in an expandable panel per finding |
| **AD/Hybrid Dashboard Panel** | When the ActiveDirectory section is included, the report home view shows hybrid sync status, last sync time, password hash sync state, and AD security finding counts |

## Installation

### From PSGallery (recommended)

```powershell
Install-Module M365-Assess -Scope CurrentUser
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

Graph and EXO dependencies are declared in the manifest and installed automatically.

### From Source

```powershell
git clone https://github.com/Galvnyz/M365-Assess.git
cd M365-Assess
Install-Module Microsoft.Graph -Scope CurrentUser
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser

Import-Module ./src/M365-Assess
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

> **Downloaded the ZIP instead of cloning?** Windows marks ZIP-extracted files as "from the internet," which blocks execution under the default `RemoteSigned` policy. Unblock all scripts after extracting:
> ```powershell
> Get-ChildItem -Path .\M365-Assess\src -Recurse -Filter *.ps1 | Unblock-File
> ```
> This is not needed when using `git clone`.

Results land in a timestamped folder with CSV data + HTML report + XLSX compliance matrix.

> **New to M365 Assess?** See the [Quickstart guide](docs/QUICKSTART.md) for step-by-step setup on a fresh Windows machine.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **PowerShell 7.x** (`pwsh`) | Primary runtime. [Install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) |
| **Microsoft.Graph** | `Install-Module Microsoft.Graph -Scope CurrentUser` |
| **ExchangeOnlineManagement** | `Install-Module ExchangeOnlineManagement -Scope CurrentUser` |
| **ImportExcel** *(optional)* | `Install-Module ImportExcel -Scope CurrentUser` for XLSX compliance matrix export |

### Platform Support

| Platform | Status |
|----------|--------|
| **Windows** | Fully tested |
| **macOS** | Experimental |
| **Linux** | Experimental |

macOS and Linux are supported by PowerShell 7 but have not been fully tested. If you run into issues, please [open an issue](https://github.com/Galvnyz/M365-Assess/issues/new) with your OS version, PowerShell version, terminal app, and the assessment log file.

## Interactive Console

Running with no parameters launches an interactive wizard that walks you through section selection, tenant ID, authentication method, and output folder.

```powershell
Import-Module ./src/M365-Assess
Invoke-M365Assessment
```

During execution, the console displays real-time streaming progress for each security check with color-coded status indicators:

<div align="center">
<img src="docs/images/console-progress.png" alt="M365 Assess console showing real-time security check progress" width="700" />
</div>

<details>
<summary>ASCII Banner</summary>

```
      ███╗   ███╗ ██████╗  ██████╗ ███████╗
      ████╗ ████║ ╚════██╗ ██╔════╝ ██╔════╝
      ██╔████╔██║  █████╔╝ ██████╗  ███████╗
      ██║╚██╔╝██║  ╚═══██╗ ██╔══██╗ ╚════██║
      ██║ ╚═╝ ██║ ██████╔╝ ╚█████╔╝ ███████║
      ╚═╝     ╚═╝ ╚═════╝   ╚════╝  ╚══════╝
       █████╗ ███████╗███████╗███████╗███████╗███████╗
      ██╔══██╗██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝
      ███████║███████╗███████╗█████╗  ███████╗███████╗
      ██╔══██║╚════██║╚════██║██╔══╝  ╚════██║╚════██║
      ██║  ██║███████║███████║███████╗███████║███████║
      ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝╚══════╝
```

</details>

## Available Sections

| Section | Collectors | What It Covers |
|---------|-----------|----------------|
| **Tenant** | Tenant Info | Organization profile, verified domains, security defaults |
| **Identity** | User Summary, MFA Report, Admin Roles, Conditional Access, App Registrations, Password Policy, Entra Security Config | User accounts, MFA status, RBAC, CA policies, app registrations, consent settings, password protection |
| **Licensing** | License Summary | SKU allocation and assignment counts |
| **Email** | Mailbox Summary, Mail Flow, Email Security, EXO Security Config, DNS Authentication | Mailbox types, transport rules, anti-spam/phishing, modern auth, audit settings, external sender tagging, SPF/DKIM/DMARC |
| **Intune** | Device Summary, Compliance Policies, Config Profiles, Intune Security Config, Mobile Encryption, Port Storage, App Control, FIPS, Device Inventory, Auto Discovery, Removable Media | Managed devices, compliance state, configuration profiles, CMMC L2 security controls. Includes an Intune Overview dashboard with device metrics and category coverage grid. |
| **Security** | Secure Score, Improvement Actions, Defender Policies, Defender Security Config, DLP Policies, Stryker Incident Readiness | Microsoft Secure Score, Defender for Office 365, anti-phishing/spam/malware, Safe Links/Attachments, data loss prevention, incident readiness checks (stale admins, CA exclusions, break-glass, device wipe audit) |
| **Collaboration** | SharePoint & OneDrive, SharePoint Security Config, Teams Access, Teams Security Config, Forms Security Config | Sharing settings, external sharing controls, sync restrictions, Teams meeting policies, third-party app restrictions, Forms phishing/data sharing settings |
| **Hybrid** | Hybrid Sync | Microsoft Entra Connect sync status and domain configuration |
| **PowerBI** | Power BI Security Config | 11 CIS 9.1.x tenant setting checks: guest access, external sharing, publish to web, sensitivity labels, service principal restrictions. Requires MicrosoftPowerBIMgmt module. |
| **Inventory** *(opt-in)* | Mailbox, Group, Teams, SharePoint, OneDrive Inventory | Per-object M&A inventory: mailboxes, distribution lists, M365 groups, Teams, SharePoint sites, OneDrive accounts |
| **ActiveDirectory** *(opt-in)* | AD Domain & Forest, AD DC Health, AD Replication, AD Security | Domain/forest topology, DC health via dcdiag, replication partners and lag, password policies, privileged group membership. Includes a hybrid sync dashboard panel in the report home view. Requires RSAT or domain controller access. |
| **SOC2** *(opt-in)* | Security Controls, Confidentiality Controls, Audit Evidence, Readiness Checklist | SOC 2 Trust Services Criteria assessment: security and confidentiality controls, 30-day audit log evidence collection, organizational readiness checklist for non-automatable criteria (CC1-CC5, CC8-CC9) |
| **ValueOpportunity** *(opt-in)* | License Utilization, Feature Adoption, Feature Readiness | Analyzes license utilization and feature adoption to identify features your tenant pays for but does not use. Produces an adoption roadmap with quick wins. |

```powershell
# Run specific sections
Invoke-M365Assessment -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'

# Run everything including opt-in sections
Invoke-M365Assessment -Section Tenant,Identity,Licensing,Email,Intune,Security,Collaboration,PowerBI,Hybrid,Inventory,ActiveDirectory,SOC2,ValueOpportunity -TenantId 'contoso.onmicrosoft.com'
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Section` | string[] | Tenant, Identity, Licensing, Email, Intune, Security, Collaboration, PowerBI, Hybrid | Sections to assess. Add `Inventory`, `ActiveDirectory`, `SOC2`, `ValueOpportunity` opt-in sections. Use `All` to run every section. |
| `-TenantId` | string | *(wizard prompt)* | Tenant ID or `*.onmicrosoft.com` domain |
| `-OutputFolder` | string | `.\M365-Assessment` | Base output directory |
| `-SkipConnection` | switch | | Skip service connections (use pre-existing) |
| `-ClientId` | string | | App Registration client ID for certificate auth |
| `-CertificateThumbprint` | string | | Certificate thumbprint for app-only auth |
| `-ClientSecret` | SecureString | | App Registration client secret for app-only auth |
| `-UserPrincipalName` | string | | UPN for interactive auth (avoids WAM broker issues) |
| `-UseDeviceCode` | switch | | Use device code flow for headless environments |
| `-ManagedIdentity` | switch | | Use Azure managed identity auth (VMs, App Service, Functions) |
| `-ConnectionProfile` | string | | Name of a saved connection profile from `.m365assess.json` |
| `-NonInteractive` | switch | | Skip all interactive prompts; log errors and exit on required module issues, skip sections for optional ones |
| `-M365Environment` | string | `commercial` | Cloud environment: `commercial`, `gcc`, `gcchigh`, `dod` |
| `-QuickScan` | switch | | Run only Critical and High severity checks for faster CI/CD or daily monitoring |
| `-CompactReport` | switch | | Generate a compact report (omits cover page, executive summary, and compliance overview) |
| `-WhiteLabel` | switch | | Hide M365 Assess GitHub link and Galvnyz attribution from the report footer |
| `-SkipPurview` | switch | | Skip Purview/DLP collector and connection (saves ~46s) |
| `-DryRun` | switch | | Preview sections, services, scopes, and check counts without connecting |
| `-OpenReport` | switch | | Auto-open the HTML report in the default browser after generation |
| `-SaveBaseline` | string | | Save a policy baseline snapshot with this label for future drift comparison |
| `-CompareBaseline` | string | | Compare the current run against a previously saved baseline and show drift in the XLSX |
| `-AutoBaseline` | switch | | Automatically save and compare against the most recent baseline for this tenant |
| `-ListBaselines` | switch | | List all saved baselines for the current tenant and exit |

### Interactive Wizard

When no connection parameters are provided (`-TenantId`, `-SkipConnection`, `-ClientId`, or `-ManagedIdentity`), an interactive wizard prompts for tenant, auth method, and output folder. If `-Section` or `-OutputFolder` are provided on the command line, those wizard steps are skipped automatically.

See [Authentication](AUTHENTICATION.md) for detailed auth examples and App Registration setup.

## Connection Profiles

Connection profiles let you save tenant and auth settings once and reuse them across runs. Profiles are stored in `.m365assess.json` at the module root.

### Create a profile

**Interactive (browser sign-in):**
```powershell
New-M365ConnectionProfile -ProfileName 'Contoso' `
    -TenantId 'contoso.onmicrosoft.com' `
    -AuthMethod Interactive
```

**Device code (headless / remote sessions):**
```powershell
New-M365ConnectionProfile -ProfileName 'ContosoDevice' `
    -TenantId 'contoso.onmicrosoft.com' `
    -AuthMethod DeviceCode
```

**Certificate / app-only (CI/CD, unattended):**
```powershell
New-M365ConnectionProfile -ProfileName 'ContosoCert' `
    -TenantId 'contoso.onmicrosoft.com' `
    -AuthMethod Certificate `
    -ClientId 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' `
    -CertificateThumbprint 'ABCDEF1234567890...' `
    -AppName 'M365-Assess App Reg'
```

### Use a profile

```powershell
# Run full assessment using a saved profile
Invoke-M365Assessment -ConnectionProfile 'Contoso'

# QuickScan using a cert-auth profile -- no interactive prompts
Invoke-M365Assessment -ConnectionProfile 'ContosoCert' -QuickScan -NonInteractive
```

### Manage profiles

```powershell
# List all saved profiles
Get-M365ConnectionProfile

# View a specific profile
Get-M365ConnectionProfile -ProfileName 'Contoso'

# Update an existing profile (upsert)
Set-M365ConnectionProfile -ProfileName 'Contoso' -TenantId 'contoso.onmicrosoft.com' -AuthMethod DeviceCode

# Remove a profile
Remove-M365ConnectionProfile -ProfileName 'OldTenant'

# Remove all profiles
Remove-M365ConnectionProfile -All
```

> Profiles are stored per-install in `.m365assess.json` at the module root. For GCC/GCC High/DoD tenants, pass `-M365Environment gcc` (or `gcchigh`, `dod`) when creating the profile.

## Module Helper

The orchestrator detects missing or incompatible PowerShell modules **before** connecting to any service. Detection is section-aware -- only modules needed by the selected sections are checked.

| Module | Condition | Severity | Action |
|--------|-----------|----------|--------|
| Microsoft.Graph.Authentication | Not installed | Required | Install latest |
| ExchangeOnlineManagement | Not installed | Required | Install pinned 3.7.1 |
| ExchangeOnlineManagement | Version >= 3.8.0 | Required | Downgrade to 3.7.1 |
| msalruntime.dll | Missing (Windows + EXO 3.8.0+) | Required | Auto-copy from module path |
| MicrosoftPowerBIMgmt | Not installed | Optional | Skip PowerBI section |

In interactive mode, the repair flow presents two tiers of prompts:

1. **Tier 1 -- Install missing modules** -- single prompt to install all missing modules to `CurrentUser` scope
2. **Tier 2 -- EXO downgrade** -- separate confirmation to uninstall EXO >= 3.8.0 and install 3.7.1 (due to the [MSAL conflict](docs/COMPATIBILITY.md))

After repair, modules are re-validated. If issues remain, the exact manual commands are displayed and the script exits.

### Headless / Non-Interactive Mode

Add `-NonInteractive` (or run in a non-interactive session) to suppress all prompts:

```powershell
# CI/CD pipeline -- exit cleanly if modules are missing
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId 'app-id' -CertificateThumbprint 'thumbprint' `
    -NonInteractive
```

**Behavior in non-interactive mode:**

- **Required module issues** -- each issue is logged with the exact install command, then the script exits with an error
- **Optional module issues** -- the dependent section is removed from the run and a warning is logged; the assessment continues with remaining sections
- **Blocked scripts (ZIP download)** -- the unblock command is logged and the script exits

The assessment log (`_Assessment-Log_<tenant>.txt`) captures all module issue details and fix commands for operator review.

### Blocked Script Detection

On Windows, files extracted from a ZIP are tagged with an NTFS Zone.Identifier that blocks execution under `RemoteSigned` policy. The orchestrator detects this automatically:

- **Interactive** -- prompts to run `Unblock-File` on all `.ps1` files
- **Non-interactive** -- logs the command and exits

## Output Structure

```
M365-Assessment/
  Assessment_YYYYMMDD_HHMMSS_<tenant>/
    01-Tenant-Info.csv
    02-User-Summary.csv
    03-MFA-Report.csv
    04-Admin-Roles.csv
    05-Conditional-Access.csv
    06-App-Registrations.csv
    07-Password-Policy.csv
    07b-Entra-Security-Config.csv
    08-License-Summary.csv
    09-Mailbox-Summary.csv
    10-Mail-Flow.csv
    11-EXO-Email-Policies.csv
    11b-EXO-Security-Config.csv
    12-DNS-Email-Authentication.csv
    13-Device-Summary.csv
    14-Compliance-Policies.csv
    15-Config-Profiles.csv
    15b-Intune-Security-Config.csv
    16-Secure-Score.csv
    17-Improvement-Actions.csv
    18-Defender-Policies.csv
    18b-Defender-Security-Config.csv
    19-DLP-Policies.csv
    19b-Compliance-Security-Config.csv
    19c-Purview-Retention-Config.csv
    20-SharePoint-OneDrive.csv
    20b-SharePoint-Security-Config.csv
    21-Teams-Access.csv
    21b-Teams-Security-Config.csv
    21c-Forms-Security-Config.csv
    22-PowerBI-Security-Config.csv
    23-Hybrid-Sync.csv
    _Assessment-Summary_<tenant>.csv     # Status of every collector
    _Assessment-Log_<tenant>.txt         # Timestamped execution log
    _Assessment-Issues_<tenant>.log      # Issue report with recommendations
    _Assessment-Report_<tenant>.html     # Self-contained HTML report
    _Compliance-Matrix_<tenant>.xlsx     # Framework compliance matrix (requires ImportExcel)
```

## Report Preview

The self-contained HTML report opens in any browser with no dependencies. Click through from the executive overview to individual security domains, drill into findings, and review compliance posture across 15 frameworks — all in a single offline file.

<div align="center">

<img src="docs/images/cover-page.png" alt="v2.0.0 executive overview — Microsoft Secure Score, critical/fail/warning summary cards, MFA distribution, and domain posture breakdown" width="700" />

<br /><br />

<img src="docs/images/exec-summary.png" alt="Entra ID findings table with severity chips, check IDs, framework mappings, and collector attribution" width="700" />

<br /><br />

<img src="docs/images/email-section.png" alt="Exchange Online findings — mail flow rules, recipient settings, authentication policies, and audit configuration checks" width="700" />

<br /><br />

<img src="docs/images/intune-overview.png" alt="Intune findings — device compliance, encryption, VPN, FIPS, and mobile security policy checks" width="700" />

<br /><br />

<img src="docs/images/compliance-overview.png" alt="Framework coverage view showing CMMC controls mapped to automated findings with severity and check ID columns" width="700" />

</div>

> See [docs/sample-report/_Example-Report.html](docs/sample-report/_Example-Report.html) for a full PII-scrubbed example report.

## Project Structure

```
M365-Assess/
  src/M365-Assess/                  # Publishable module (ships to PSGallery)
    M365-Assess.psd1                # Module manifest
    M365-Assess.psm1                # Module loader
    Invoke-M365Assessment.ps1       # Orchestrator -- main entry point
    Orchestrator/                   # Decomposed orchestrator modules (wizard, helpers, maps)
    Common/                         # Shared helpers (report, compliance, DNS)
    Entra/                          # Users, MFA, admin roles, CA, apps, licensing
    Exchange-Online/                # Mailboxes, mail flow, email security
    Intune/                         # Devices, compliance, config profiles
    Security/                       # Secure Score, Defender, DLP, Incident Readiness
    Collaboration/                  # SharePoint, OneDrive, Teams
    PowerBI/                        # Power BI tenant security (CIS 9.x)
    Purview/                        # DLP policies, audit retention
    ActiveDirectory/                # Hybrid sync, AD domain/DC/replication/security
    Inventory/                      # M&A inventory
    SOC2/                           # SOC 2 readiness assessment
    assets/                         # Branding (logos, background) + SKU data
    controls/                       # Control registry + 15 framework mappings
  tests/                            # Pester test suite
  docs/                             # Detailed documentation
  Setup/                            # App Registration provisioning scripts
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Quickstart](docs/QUICKSTART.md) | Step-by-step setup on a fresh Windows machine |
| [Authentication](AUTHENTICATION.md) | Interactive, certificate, device code, managed identity, and pre-existing connection methods |
| [HTML Report](REPORT.md) | Report features, custom branding, `-NoBranding`, standalone generation |
| [Compliance](COMPLIANCE.md) | 15 frameworks, XLSX export, CheckId system, control registry |
| [Compatibility](docs/COMPATIBILITY.md) | Module versions, dependency matrix, known incompatibilities |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common errors, module conflicts, permission issues |
| [CheckId Guide](docs/CheckId-Guide.md) | CheckId naming convention and mapping reference |
| [Changelog](CHANGELOG.md) | Release history and version notes |
| [Security](SECURITY.md) | Vulnerability reporting and security policy |

## Individual Scripts

Collectors can be run standalone by dot-sourcing the required helpers first:

```powershell
# Load the module (makes helpers and Connect-Service available)
Import-Module ./src/M365-Assess

# Connect to the required service
Connect-Service -Service Graph -Scopes 'User.Read.All','UserAuthenticationMethod.Read.All'

# Run a single collector
. ./src/M365-Assess/Entra/Get-MfaReport.ps1
```

### Standalone Scripts

Individual collectors and report generation can run independently of the full assessment:

| Script | Purpose |
|--------|---------|
| `src/M365-Assess/Entra/Get-MfaReport.ps1` | MFA enrollment and capability report |
| `src/M365-Assess/Entra/Get-InactiveUsers.ps1` | Users inactive for 90+ days |
| `src/M365-Assess/Exchange-Online/Get-MailFlowReport.ps1` | Mail flow rules and connectors |
| `src/M365-Assess/Common/Export-AssessmentReport.ps1` | Regenerate HTML report from existing CSVs |
| `src/M365-Assess/Common/Export-ComplianceMatrix.ps1` | Generate XLSX compliance matrix |

Each collector requires a Graph or Exchange Online connection first:

```powershell
Import-Module ./src/M365-Assess
Connect-Service -Service Graph -Scopes 'User.Read.All','AuditLog.Read.All'
. ./src/M365-Assess/Entra/Get-InactiveUsers.ps1 -DaysInactive 90
```

## Getting Help

```powershell
Import-Module ./src/M365-Assess
Get-Help Invoke-M365Assessment -Full
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">
<sub>Built by <a href="https://github.com/Daren9m">Daren9m</a> and contributors &nbsp;·&nbsp; Developed with <a href="https://claude.ai/code">Claude Code</a> (Anthropic)</sub>
</div>
