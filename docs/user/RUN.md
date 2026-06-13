# Execution Guide

Complete reference for running M365 Assess assessments. For first-time setup, see [QUICKSTART.md](QUICKSTART.md).

## Execution Modes

### Interactive Wizard (default)

Run with no parameters to launch a step-by-step wizard that walks through section selection, tenant ID, authentication method, report options, and output folder.

```powershell
Invoke-M365Assessment
```

The wizard skips any step you already provided on the command line. For example, passing `-Section Identity,Email` skips the section selection step but still prompts for tenant and auth.

### CLI Parameters

Provide all options on the command line for a single-command assessment:

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -Section Identity,Email
```

### Non-Interactive (-NonInteractive)

Suppresses all interactive prompts. Required modules must be pre-installed. Use this for CI/CD pipelines, scheduled tasks, and headless environments.

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -NonInteractive `
    -ClientId '00000000-...' -CertificateThumbprint 'ABC123'
```

**Behavior:** Required module issues log the fix command and exit with an error. Optional module issues skip the dependent section and continue. Also triggered automatically when `[Environment]::UserInteractive` is false.

## Common Parameter Combinations

### Quick Scan -- Specific Sections

```powershell
Invoke-M365Assessment -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'
```

### Full CIS Audit -- All Standard Sections

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

Runs Tenant, Identity, Licensing, Email, Intune, Security, Collaboration, PowerBI, and Hybrid by default.

### All Sections Including Opt-In

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -Section Tenant,Identity,Licensing,Email,Intune,Security,Collaboration,PowerBI,Hybrid,Inventory,ActiveDirectory,SOC2
```

### Non-Interactive with Certificate Auth

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -CertificateThumbprint 'ABC123DEF456' `
    -NonInteractive
```

### Non-Interactive with Client Secret

```powershell
$secret = ConvertTo-SecureString 'your-secret' -AsPlainText -Force
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' `
    -ClientId '00000000-0000-0000-0000-000000000000' `
    -ClientSecret $secret `
    -NonInteractive
```

### Managed Identity (Azure VM / Functions)

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -ManagedIdentity -NonInteractive
```

### Device Code Flow (headless or multi-profile browsers)

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -UseDeviceCode
```

Displays a code and URL you can open in any browser profile.

### Custom Output Directory

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -OutputFolder 'C:\Reports' -OpenReport
```

### White-Label Client Report

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -WhiteLabel
```

Removes the M365 Assess GitHub link and Galvnyz attribution from the report footer. Ideal for client delivery.

### Compact Report (no Appendix)

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -CompactReport
```

Omits the raw data Appendix tables for a smaller, exec-friendly output.

### Skip Purview to Save Time

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -SkipPurview
```

Skips the Purview (Security & Compliance) connection, saving approximately 46 seconds.

### Baseline and Drift Tracking

```powershell
# Save an auto-labelled baseline after an assessment (label = manual-<timestamp>)
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -SaveBaseline

# Save with a custom label
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -SaveBaseline -BaselineLabel 'PreChange'

# Compare against a previous baseline (adds Drift sheet to XLSX)
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -CompareBaseline 'PreChange'

# Auto-save a baseline after every run
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -AutoBaseline

# List saved baselines for a tenant
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -ListBaselines
```

### Pre-Existing Connections

```powershell
# Connect manually first
Connect-MgGraph -Scopes 'User.Read.All','Directory.Read.All'
Connect-ExchangeOnline

# Then run with -SkipConnection
Invoke-M365Assessment -SkipConnection
```

## Expected Runtimes

Approximate runtimes for a typical SMB tenant (10--500 users). Actual times vary by tenant size and network latency.

| Section | Approximate Runtime |
|---------|-------------------|
| Tenant | ~10 seconds |
| Identity | ~30 seconds |
| Licensing | ~5 seconds |
| Email | ~45 seconds |
| Intune | ~15 seconds |
| Security | ~60 seconds |
| Collaboration | ~20 seconds |
| PowerBI | ~30 seconds |
| Hybrid | ~10 seconds |
| Inventory | ~30 seconds (opt-in) |
| ActiveDirectory | ~15 seconds (opt-in) |
| SOC2 | ~20 seconds (opt-in) |

**Total for default sections:** 5--8 minutes for a full scan (including service connections and report generation).

**Tips to reduce runtime:**
- Use `-SkipPurview` to skip the Purview connection (~46 seconds saved)
- Use `-Section` to run only the sections you need
- Use `-QuickScan` to run only Critical and High severity checks

## Output Files

All output lands in a timestamped subfolder under the output directory:

```
M365-Assessment/Assessment_YYYYMMDD_HHMMSS_<tenant>/
```

| File | Description |
|------|-------------|
| `*.csv` | Per-collector raw data (one CSV per collector, numbered by section) |
| `_Assessment-Report_<tenant>.html` | Self-contained HTML report -- opens in any browser |
| `_Assessment-Report_<tenant>.pdf` | PDF version (generated when wkhtmltopdf is installed) |
| `_Compliance-Matrix_<tenant>.xlsx` | Framework compliance matrix with dynamic columns (requires ImportExcel module) |
| `_Assessment-Log_<tenant>.txt` | Timestamped execution log with connection details and timing |
| `_Assessment-Issues_<tenant>.log` | Issue report with recommendations for failed or warning checks |
| `_Assessment-Summary_<tenant>.csv` | Status of every collector (Success, Warning, Skipped, Failed) |
| `_<Framework>-Catalog_<tenant>.html` | Per-framework catalog exports (when using `-FrameworkExport`) |

## Environment Support

M365 Assess supports four Microsoft 365 cloud environments:

| Environment | Flag | Notes |
|-------------|------|-------|
| **Commercial** | `-M365Environment commercial` | Default. Auto-detected when not specified. |
| **GCC** | `-M365Environment gcc` | US Government Community Cloud |
| **GCC High** | `-M365Environment gcchigh` | Sovereign cloud endpoints |
| **DoD** | `-M365Environment dod` | Sovereign cloud endpoints |

The environment is **auto-detected** from tenant metadata when `-M365Environment` is not explicitly specified. Specify the flag only when auto-detection fails or you want to override.

```powershell
# GCC High tenant
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.us' -M365Environment gcchigh
```

## Authentication Methods

| Method | Parameters | Best For |
|--------|-----------|----------|
| Interactive (browser) | `-TenantId` | Ad-hoc assessments |
| Device code | `-TenantId -UseDeviceCode` | Multi-profile browsers, remote sessions |
| UPN hint | `-TenantId -UserPrincipalName admin@contoso.com` | Bypassing WAM broker errors |
| Certificate | `-TenantId -ClientId -CertificateThumbprint` | Production automation |
| Client secret | `-TenantId -ClientId -ClientSecret` | Testing (less secure than cert) |
| Managed identity | `-TenantId -ManagedIdentity` | Azure VMs, Functions, Automation |
| Pre-existing | `-SkipConnection` | Manual connection management |

See [AUTHENTICATION.md](AUTHENTICATION.md) for App Registration setup and detailed auth examples.

## Report Customization Flags

| Flag | Effect |
|------|--------|
| `-WhiteLabel` | Remove M365 Assess attribution from the report footer |
| `-CompactReport` | Omit the Appendix (raw data tables) for a smaller exec-friendly report |
| `-SkipPurview` | Skip the Purview connection and DLP/retention collectors (~46s saved) |
| `-OpenReport` | Open the HTML report in the default browser after generation |

## Troubleshooting

**Assessment exits immediately with module errors**
In non-interactive mode, missing required modules cause an immediate exit. Check `_Assessment-Log_<tenant>.txt` for the exact `Install-Module` commands to run.

**PowerBI section is skipped**
Install the optional module: `Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser`

**Purview section adds ~46 seconds**
The Purview (Security & Compliance) connection is slow. Use `-SkipPurview` if DLP/retention assessment is not needed.

**Browser does not open for authentication**
Use `-UseDeviceCode` for device code flow, or `-UserPrincipalName admin@contoso.com` to bypass WAM broker issues.

**Execution policy blocks scripts (ZIP download)**
```powershell
Get-ChildItem -Path .\M365-Assess\src -Recurse -Filter *.ps1 | Unblock-File
```

## Available Sections

| Section | Collectors | What It Covers |
|---------|-----------|----------------|
| **Tenant** | Tenant Info | Organization profile, verified domains, security defaults |
| **Identity** | User Summary, MFA Report, Admin Roles, Conditional Access, App Registrations, Password Policy, Entra Security Config | User accounts, MFA status, RBAC, CA policies, app registrations, consent settings, password protection |
| **Licensing** | License Summary | SKU allocation and assignment counts |
| **Email** | Mailbox Summary, Mail Flow, Email Security, EXO Security Config, DNS Authentication | Mailbox types, transport rules, anti-spam/phishing, modern auth, audit settings, external sender tagging, SPF/DKIM/DMARC |
| **Intune** | Device Summary, Compliance Policies, Config Profiles, Intune Security Config, Mobile Encryption, Port Storage, App Control, FIPS, Device Inventory, Auto Discovery, Removable Media | Managed devices, compliance state, configuration profiles, CMMC L2 security controls. Includes an Intune Overview dashboard with device metrics and category coverage grid. |
| **Security** | Secure Score, Improvement Actions, Defender Policies, Defender Security Config, DLP Policies, Critical Exposure | Microsoft Secure Score, Defender for Office 365, anti-phishing/spam/malware, Safe Links/Attachments, data loss prevention, critical exposure checks (stale admins, CA exclusions, break-glass, device wipe audit) |
| **Collaboration** | SharePoint & OneDrive, SharePoint Security Config, Teams Access, Teams Security Config, Forms Security Config | Sharing settings, external sharing controls, sync restrictions, Teams meeting policies, third-party app restrictions, Forms phishing/data sharing settings |
| **Hybrid** | Hybrid Sync | Microsoft Entra Connect sync status and domain configuration |
| **PowerBI** | Power BI Security Config | 11 CIS 9.1.x tenant setting checks: guest access, external sharing, publish to web, sensitivity labels, service principal restrictions. Requires MicrosoftPowerBIMgmt module. |
| **Inventory** *(opt-in)* | Mailbox, Group, Teams, SharePoint, OneDrive Inventory | Per-object M&A inventory: mailboxes, distribution lists, M365 groups, Teams, SharePoint sites, OneDrive accounts |
| **ActiveDirectory** *(opt-in)* | AD Domain & Forest, AD DC Health, AD Replication, AD Security | Domain/forest topology, DC health via dcdiag, replication partners and lag, password policies, privileged group membership. Includes a hybrid sync dashboard panel in the report home view. Requires RSAT or domain controller access. |
| **SOC2** *(opt-in)* | Security Controls, Confidentiality Controls, Audit Evidence, Readiness Checklist | SOC 2 Trust Services Criteria assessment: security and confidentiality controls, 30-day audit log evidence collection, organizational readiness checklist for non-automatable criteria (CC1-CC5, CC8-CC9) |
| **ValueOpportunity** *(opt-in)* | License Utilization, Feature Adoption, Feature Readiness | Analyzes license utilization and feature adoption to identify features your tenant pays for but does not use. Produces an adoption roadmap with quick wins. |

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
| `-ConnectionProfile` | string | | Name of a saved connection profile (per-user app-data; legacy `.m365assess.json` at module root still readable) |
| `-NonInteractive` | switch | | Skip all interactive prompts; log errors and exit on required module issues, skip sections for optional ones |
| `-M365Environment` | string | `commercial` | Cloud environment: `commercial`, `gcc`, `gcchigh`, `dod` |
| `-QuickScan` | switch | | Run only Critical and High severity checks for faster CI/CD or daily monitoring |
| `-CompactReport` | switch | | Generate a compact report (omits cover page, executive summary, and compliance overview) |
| `-WhiteLabel` | switch | | Hide M365 Assess GitHub link and Galvnyz attribution from the report footer |
| `-SkipPurview` | switch | | Skip Purview/DLP collector and connection (saves ~46s) |
| `-DryRun` | switch | | Preview sections, services, scopes, and check counts without connecting |
| `-OpenReport` | switch | | Auto-open the HTML report in the default browser after generation |
| `-SaveBaseline` | switch | | Save a policy baseline snapshot for future drift comparison. Auto-labels as `manual-<timestamp>`; combine with `-BaselineLabel` for a custom label |
| `-BaselineLabel` | string | | Optional custom label to use with `-SaveBaseline` (e.g. `'sprint-end'`). Ignored without `-SaveBaseline` |
| `-CompareBaseline` | string | | Compare the current run against a previously saved baseline and show drift in the XLSX |
| `-AutoBaseline` | switch | | Automatically save and compare against the most recent baseline for this tenant |
| `-ListBaselines` | switch | | List all saved baselines for the current tenant and exit |

When no connection parameters are provided (`-TenantId`, `-SkipConnection`, `-ClientId`, or `-ManagedIdentity`), an interactive wizard prompts for tenant, auth method, and output folder. If `-Section` or `-OutputFolder` are provided on the command line, those wizard steps are skipped automatically.

## Connection Profiles

Connection profiles let you save tenant and auth settings once and reuse them across runs. Profiles are stored per-user under `%APPDATA%\M365-Assess\profiles.json` (Windows) or `~/.config/M365-Assess/profiles.json` (Linux/macOS). Profiles created on older versions at the module-root `.m365assess.json` continue to load; they're migrated to the new location on the next save. For GCC/GCC High/DoD tenants, pass `-M365Environment gcc` (or `gcchigh`, `dod`) when creating the profile.

### Create a profile

```powershell
# Interactive (browser sign-in)
New-M365ConnectionProfile -ProfileName 'Contoso' -TenantId 'contoso.onmicrosoft.com' -AuthMethod Interactive

# Device code (headless / remote sessions)
New-M365ConnectionProfile -ProfileName 'ContosoDevice' -TenantId 'contoso.onmicrosoft.com' -AuthMethod DeviceCode

# Certificate / app-only (CI/CD, unattended)
New-M365ConnectionProfile -ProfileName 'ContosoCert' -TenantId 'contoso.onmicrosoft.com' -AuthMethod Certificate -ClientId 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' -CertificateThumbprint 'ABCDEF1234567890...' -AppName 'M365-Assess App Reg'
```

### Use and manage profiles

```powershell
# Run using a saved profile
Invoke-M365Assessment -ConnectionProfile 'Contoso'

# QuickScan using a cert-auth profile -- no interactive prompts
Invoke-M365Assessment -ConnectionProfile 'ContosoCert' -QuickScan -NonInteractive

# List, view, update (upsert), and remove profiles
Get-M365ConnectionProfile
Get-M365ConnectionProfile -ProfileName 'Contoso'
Set-M365ConnectionProfile -ProfileName 'Contoso' -TenantId 'contoso.onmicrosoft.com' -AuthMethod DeviceCode
Remove-M365ConnectionProfile -ProfileName 'OldTenant'
Remove-M365ConnectionProfile -All
```

## Module Management

The orchestrator detects missing or incompatible PowerShell modules **before** connecting to any service. Detection is section-aware: only modules needed by the selected sections are checked.

| Module | Condition | Severity | Action |
|--------|-----------|----------|--------|
| Microsoft.Graph.Authentication | Not installed | Required | Install latest |
| ExchangeOnlineManagement | Not installed | Required | Install pinned 3.7.1 |
| ExchangeOnlineManagement | Version >= 3.8.0 and no <= 3.7.x installed | Required | Install 3.7.1 side-by-side (newer versions stay) |
| msalruntime.dll | Missing (Windows + EXO 3.8.0+) | Required | Auto-copy from module path |
| MicrosoftPowerBIMgmt | Not installed | Optional | Skip PowerBI section |

In interactive mode the repair flow presents two tiers: (1) install missing modules to `CurrentUser` scope, and (2) install EXO 3.7.1 side-by-side with any EXO >= 3.8.0 (the newer version stays for other tooling; the session pins the compatible version at connect time, due to the [MSAL conflict](../reference/COMPATIBILITY.md)). After repair, modules are re-validated; if issues remain the exact manual commands are displayed and the script exits.

In non-interactive mode, required module issues are logged with the exact install command and the script exits; optional module issues drop the dependent section and continue. On Windows, files extracted from a ZIP are tagged with an NTFS Zone.Identifier that blocks execution under `RemoteSigned`; the orchestrator prompts to `Unblock-File` (interactive) or logs the command and exits (non-interactive).

## Individual Scripts

Collectors and report generation can run standalone by dot-sourcing the required helpers first:

```powershell
# Load the module (makes helpers and Connect-Service available)
Import-Module ./src/M365-Assess

# Connect to the required service, then run a single collector
Connect-Service -Service Graph -Scopes 'User.Read.All','AuditLog.Read.All'
. ./src/M365-Assess/Entra/Get-InactiveUsers.ps1 -DaysInactive 90
```

| Script | Purpose |
|--------|---------|
| `src/M365-Assess/Entra/Get-MfaReport.ps1` | MFA enrollment and capability report |
| `src/M365-Assess/Entra/Get-InactiveUsers.ps1` | Users inactive for 90+ days |
| `src/M365-Assess/Exchange-Online/Get-MailFlowReport.ps1` | Mail flow rules and connectors |
| `src/M365-Assess/Common/Export-AssessmentReport.ps1` | Regenerate HTML report from existing CSVs |
| `src/M365-Assess/Common/Export-ComplianceMatrix.ps1` | Generate XLSX compliance matrix |

## See Also

- [QUICKSTART.md](QUICKSTART.md) -- First assessment on a fresh machine
- [AUTHENTICATION.md](AUTHENTICATION.md) -- Auth methods and App Registration setup
- [REPORT-USER-GUIDE.md](REPORT-USER-GUIDE.md) -- Report features, interactive walkthrough, and customization
- [COMPLIANCE.md](COMPLIANCE.md) -- Framework mappings and XLSX export
- [COMPATIBILITY.md](../reference/COMPATIBILITY.md) -- Module versions and known incompatibilities
