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

See [AUTHENTICATION.md](../AUTHENTICATION.md) for App Registration setup and detailed auth examples.

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

## See Also

- [QUICKSTART.md](QUICKSTART.md) -- First assessment on a fresh machine
- [AUTHENTICATION.md](../AUTHENTICATION.md) -- Auth methods and App Registration setup
- [REPORT.md](../REPORT.md) -- Report features and customization
- [COMPLIANCE.md](../COMPLIANCE.md) -- Framework mappings and XLSX export
- [COMPATIBILITY.md](../reference/COMPATIBILITY.md) -- Module versions and known incompatibilities
