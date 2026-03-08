# M365 Assess

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="Common/assets/m365-assess-logo-white.png" />
  <source media="(prefers-color-scheme: light)" srcset="Common/assets/m365-assess-logo.png" />
  <img src="Common/assets/m365-assess-logo.png" alt="M365 Assess" width="400" />
</picture>

### Comprehensive M365 Security Assessment Tool

**Read-only Microsoft 365 security assessment for IT consultants and administrators**

[![PowerShell 7.x](https://img.shields.io/badge/PowerShell-7.x-blue?logo=powershell&logoColor=white)](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)
[![Pester 5.x](https://img.shields.io/badge/Tests-Pester%205.x-green)](https://pester.dev/)
[![Read-Only](https://img.shields.io/badge/Operations-Read--Only-brightgreen)](.)
[![Version](https://img.shields.io/badge/version-0.3.0-blue)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

Run a single command to produce a comprehensive set of CSV reports and a branded HTML assessment report covering identity, email, security, devices, collaboration, and compliance baselines. Designed for IT consultants and administrators assessing Microsoft 365 environments.

## Quick Start

```powershell
# Clone the repository
git clone https://github.com/Daren9m/M365-Assess.git
cd M365-Assess

# Run the full M365 assessment (interactive wizard launches if no params given)
.\Invoke-M365Assessment.ps1

# Or specify tenant directly
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com'

# Results land in a timestamped folder with CSV data + HTML report
Get-ChildItem .\M365-Assessment\Assessment_* -Directory | Sort-Object Name -Descending | Select-Object -First 1
```

## Interactive Console App

Running the orchestrator with no parameters launches a full interactive wizard:

```powershell
.\Invoke-M365Assessment.ps1
```

The console app walks you through four steps:

1. **Select sections** — toggle assessment sections on/off (Tenant, Identity, Email, etc.)
2. **Tenant ID** — enter your tenant ID or `*.onmicrosoft.com` domain
3. **Authentication** — choose Interactive, Certificate-based, or Skip (pre-existing connections)
4. **Output folder** — confirm or change the output directory

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

        ░▒▓█  M365 Environment Assessment  █▓▒░
        ░▒▓█  by  D A R E N 9 M            █▓▒░
```

During execution, the console displays real-time progress with status indicators for each collector (`✓` complete, `○` skipped, `✗` failed) plus item counts and timing. The completion banner summarizes results and links to the HTML report.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **PowerShell 7.x** (`pwsh`) | Primary runtime. [Install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) |
| **Windows PowerShell 5.1** | Required only for the ScubaGear section. Ships with Windows. |
| **Microsoft.Graph** | Core Graph module for Entra ID, licensing, Intune, security collectors |
| **ExchangeOnlineManagement** | Exchange Online and Purview collectors |

Install the core modules:

```powershell
Install-Module Microsoft.Graph, ExchangeOnlineManagement -Scope CurrentUser
```

ScubaGear and its 8 dependencies are installed automatically the first time you run that section.

## M365 Assessment Suite

The orchestrator (`Invoke-M365Assessment.ps1`) connects to the required services, dispatches collectors across 8 standard sections, and exports CSV reports plus a branded HTML report into a timestamped folder. All operations are strictly read-only (`Get-*` cmdlets only). Failures in one section do not block others.

### Available Sections

| Section | Collectors | What It Covers |
|---------|-----------|----------------|
| **Tenant** | Tenant Info | Organization profile, verified domains, security defaults |
| **Identity** | User Summary, MFA Report, Admin Roles, Conditional Access, App Registrations, Password Policy, Entra Security Config | User accounts, MFA status, RBAC, CA policies, app registrations, consent settings, password protection |
| **Licensing** | License Summary | SKU allocation and assignment counts |
| **Email** | Mailbox Summary, Mail Flow, Email Security, EXO Security Config, DNS Authentication | Mailbox types, transport rules, anti-spam/phishing, modern auth, audit settings, external sender tagging, SPF/DKIM/DMARC |
| **Intune** | Device Summary, Compliance Policies, Config Profiles | Managed devices, compliance state, configuration profiles |
| **Security** | Secure Score, Improvement Actions, Defender Policies, Defender Security Config, DLP Policies | Microsoft Secure Score, Defender for Office 365, anti-phishing/spam/malware, Safe Links/Attachments, data loss prevention |
| **Collaboration** | SharePoint & OneDrive, SharePoint Security Config, Teams Access, Teams Security Config | Sharing settings, external sharing controls, sync restrictions, Teams meeting policies, third-party app restrictions |
| **Hybrid** | Hybrid Sync | Azure AD Connect sync status and domain configuration |
| **Inventory** *(opt-in)* | Mailbox Inventory, Group Inventory, Teams Inventory, SharePoint Inventory, OneDrive Inventory | Per-object M&A inventory: all mailboxes (user/shared/room/equipment), distribution lists, M365 groups, Teams with owners and channels, SharePoint sites with storage, OneDrive accounts with usage |
| **ScubaGear** *(opt-in)* | CISA Baseline Scan | CISA SCuBA security baseline compliance (see below) |

### Running Specific Sections

```powershell
# Run only Identity and Email
.\Invoke-M365Assessment.ps1 -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'

# Run only M&A Inventory (opt-in)
.\Invoke-M365Assessment.ps1 -Section Inventory -TenantId 'contoso.onmicrosoft.com'

# Run everything including ScubaGear (opt-in)
.\Invoke-M365Assessment.ps1 -Section Tenant,Identity,Licensing,Email,Intune,Security,Collaboration,Hybrid,ScubaGear -TenantId 'contoso.onmicrosoft.com'
```

### Output Structure

```
M365-Assessment/
  Assessment_YYYYMMDD_HHMMSS/
    01-Tenant-Info.csv
    02-User-Summary.csv
    03-MFA-Report.csv
    04-Admin-Roles.csv
    05-Conditional-Access.csv
    06-App-Registrations.csv
    07-Password-Policy.csv
    07b-Entra-Security-Config.csv     # CIS-aligned Entra ID configuration
    08-License-Summary.csv
    09-Mailbox-Summary.csv
    10-Mail-Flow.csv
    11-Email-Security.csv
    11b-EXO-Security-Config.csv       # CIS-aligned EXO configuration
    12-DNS-Authentication.csv
    13-Device-Summary.csv
    14-Compliance-Policies.csv
    15-Config-Profiles.csv
    16-Secure-Score.csv
    17-Improvement-Actions.csv
    18-Defender-Policies.csv
    18b-Defender-Security-Config.csv  # CIS-aligned Defender configuration
    19-DLP-Policies.csv
    20-SharePoint-OneDrive.csv
    20b-SharePoint-Security-Config.csv # CIS-aligned SharePoint security
    21-Teams-Access.csv
    21b-Teams-Security-Config.csv     # CIS-aligned Teams configuration
    22-Hybrid-Sync.csv
    28-Mailbox-Inventory.csv          # Per-mailbox detail (opt-in Inventory section)
    29-Group-Inventory.csv            # Distribution lists and M365 groups
    30-Teams-Inventory.csv            # Teams with owners, members, channels
    31-SharePoint-Inventory.csv       # Per-site storage and activity
    32-OneDrive-Inventory.csv         # Per-user OneDrive storage and activity
    _Assessment-Summary.csv           # Status of every collector
    _Assessment-Log.txt               # Timestamped execution log
    _Assessment-Issues.log            # Issue report with recommendations
    _Assessment-Report.html           # Branded HTML report
```

Start with `_Assessment-Report.html` for a presentation-ready overview, or `_Assessment-Summary.csv` for programmatic access.

### Authentication

**Interactive (default)** — a browser window opens for each service:

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com'
```

**Interactive with UPN** — avoids WAM broker errors on some systems:

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' -UserPrincipalName 'admin@contoso.onmicrosoft.com'
```

**Certificate-based app-only** — for unattended or scheduled runs:

```powershell
.\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456'
```

**Pre-existing connections** — if you already ran `Connect-MgGraph` and `Connect-ExchangeOnline`:

```powershell
.\Invoke-M365Assessment.ps1 -SkipConnection
```

### Console Output

The orchestrator provides real-time console feedback during execution:

- **Progress table** — shows each collector's status, item count, and duration as it runs
- **Pre-flight checks** — validates module versions and permissions before connecting
- **Issue summary** — logs errors and warnings with recommended actions
- **Completion banner** — links to the output folder and HTML report

All console output is also written to `_Assessment-Log.txt` for reference.

### HTML Report

The assessment automatically generates a self-contained HTML report (`_Assessment-Report.html`) that can be emailed directly to clients — no external dependencies, no assets folder needed. All logos are base64-encoded, styles and scripts are embedded inline.

**Report features:**

- **Cover page** with M365 Assess branding and tenant name
- **Organization profile card** — non-collapsible header showing org name, primary domain, creation date, and security defaults status
- **Executive summary** with section/collector stat cards and issue overview
- **Identity KPIs** — stat cards for total users, licensed users, MFA adoption %, SSPR enrollment %, and guest user count (MFA/SSPR exclude non-capable accounts from the denominator)
- **Section-by-section data tables** with executive descriptions explaining what each area covers and why it matters
- **Collapsible sub-sections** — detail tables fold under expandable headings with row counts, keeping the report scannable
- **Sortable column headers** — click any column header to sort ascending/descending
- **CIS Compliance Summary** — findings mapped to the CIS Microsoft 365 Foundations Benchmark v6.0.1 with compliance score, pass/fail/warning stat cards, and color-coded findings table
- **Security config highlighting** — Entra, EXO, Defender, SharePoint, and Teams security config tables show color-coded status badges (Pass/Fail/Warning/Review) with row-level tinting
- **Microsoft Secure Score** — visual stat cards and progress bar showing current score, points earned, and comparison to the M365 global average
- **Issues & recommendations** with severity badges and remediation guidance
- **Print-friendly styling** — open in any browser and print to PDF with automatic page breaks

The report generator can also be run standalone to regenerate the HTML from existing CSV data without re-running the assessment:

```powershell
.\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_YYYYMMDD_HHMMSS'
```

### Custom Branding

To use your own logo and background in the HTML report, place your images in `Common/assets/`:

| File | Purpose | Format | Recommended Size |
|------|---------|--------|-----------------|
| `m365-assess-logo.png` | Report cover page logo | PNG | 400 x 120 px |
| `m365-assess-logo-white.png` | Light-on-dark variant (optional) | PNG | 400 x 120 px |
| `m365-assess-bg.png` | Cover page background | PNG | 1200 x 800 px |

The report engine base64-encodes these images into the HTML at generation time, so the output file is fully self-contained. Simply replace the files with your own branding and re-run the report generator.

## ScubaGear Integration (CISA Baseline Compliance)

[CISA ScubaGear](https://github.com/cisagov/ScubaGear) assesses your M365 tenant against the Secure Cloud Business Applications (SCuBA) security baselines. It is included as an **opt-in** section because it requires Windows PowerShell 5.1, handles its own authentication, and takes several minutes to complete.

**How it works**: The orchestrator transparently shells out to `powershell.exe` (Windows PowerShell 5.1) to run ScubaGear. You stay in PowerShell 7 — the version bridging is handled automatically.

**First run**: ScubaGear and all 8 of its dependencies (OPA, Microsoft.Graph.Authentication, ExchangeOnlineManagement, SharePoint PnP, Teams, PowerApps, etc.) are auto-installed via `Initialize-SCuBA`. This may take 5-10 minutes. Subsequent runs are faster.

**Products scanned** (all 7 by default): Entra ID, Defender, Exchange Online, Power Platform, Power BI, SharePoint, Teams.

```powershell
# Run ScubaGear scan only
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.com'

# Combine with other sections
.\Invoke-M365Assessment.ps1 -Section Tenant,Identity,ScubaGear -TenantId 'contoso.onmicrosoft.com'

# Scan specific products
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.com' -ScubaProductNames aad,exo

# Government tenant (GCC)
.\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.us' -M365Environment gcc
```

ScubaGear produces native HTML and JSON reports in the `ScubaGear-Report/` subfolder alongside the parsed `23-ScubaGear-Baseline.csv`.

## Individual Scripts

Every collector can also be run standalone outside the orchestrator:

```powershell
# Connect to the required service first
. .\Common\Connect-Service.ps1
Connect-Service -Service Graph -Scopes 'User.Read.All','UserAuthenticationMethod.Read.All'

# Run a single collector
.\Entra\Get-MfaReport.ps1

# Export directly to CSV
.\Entra\Get-MfaReport.ps1 -OutputPath '.\mfa-report.csv'
```

## Project Structure

```
M365-Assess/
  Invoke-M365Assessment.ps1      # Orchestrator - main entry point
  ActiveDirectory/                # Hybrid sync, AD domain/DC/replication/security
  Collaboration/                  # SharePoint, OneDrive, Teams
  Common/                         # Shared helpers (Connect-Service, Export-AssessmentReport)
    assets/                       # Branding assets (logo, backgrounds) — see Custom Branding
  Entra/                          # Users, MFA, admin roles, CA, apps, licensing, security config
  Exchange-Online/                # Mailboxes, mail flow, email security, EXO config
  Inventory/                      # M&A inventory: mailboxes, groups, Teams, SharePoint, OneDrive
  Intune/                         # Devices, compliance, config profiles
  Networking/                     # Port scanning, DNS, connectivity
  Purview/                        # DLP policies, audit retention
  Security/                       # Secure Score, Defender, DLP, ScubaGear
  Windows/                        # Installed software, services
  tests/                          # Pester 5.x tests (mirrors folder structure)
```

## Getting Help

Every script includes comment-based help:

```powershell
Get-Help .\Invoke-M365Assessment.ps1 -Full
Get-Help .\Security\Invoke-ScubaGearScan.ps1 -Examples
Get-Help .\Entra\Get-MfaReport.ps1 -Full
```

Run the test suite:

```powershell
pwsh -NoProfile -Command "Invoke-Pester -Path './tests' -Output Detailed"
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
<sub>Built by <a href="https://github.com/Daren9m">Daren9m</a> and contributors</sub>
</div>
