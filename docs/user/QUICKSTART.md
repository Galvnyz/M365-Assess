# Quickstart: First Assessment on a Fresh Windows Machine

Get from a clean Windows install to your first M365 security assessment in under 10 minutes.

## 1. Install PowerShell 7

Windows ships with PowerShell 5.1, but M365 Assess requires **PowerShell 7.x** (`pwsh`).

```powershell
# Run this in the built-in Windows PowerShell (powershell.exe)
winget install Microsoft.PowerShell
```

Close and reopen your terminal, then verify:

```powershell
pwsh --version
# Expected: PowerShell 7.x.x
```

> **No winget?** Download the MSI installer from the [PowerShell releases page](https://github.com/PowerShell/PowerShell/releases).

## 2. Install M365-Assess + Required Modules

Open **pwsh** (not the old `powershell.exe`).

### A. Core install (always)

#### PSGallery — recommended

```powershell
Install-Module M365-Assess -Scope CurrentUser
```

This auto-resolves the 8 Microsoft.Graph.* sub-modules the assessment actually uses (Authentication, Applications, DeviceManagement, Identity.DirectoryManagement, Identity.SignIns, Reports, Security, Users) at version 2.25.0+. **You do NOT need to install the full `Microsoft.Graph` meta-module** — that's 30+ sub-modules and several minutes of install time you don't need.

#### From source

```powershell
git clone https://github.com/Galvnyz/M365-Assess.git
cd M365-Assess
Import-Module ./src/M365-Assess
```

> **Downloaded the ZIP?** Windows marks extracted files as blocked. Unblock them:
> ```powershell
> Get-ChildItem -Path .\M365-Assess -Recurse -Filter *.ps1 | Unblock-File
> ```

For from-source, install only the 8 required Graph sub-modules manually:

```powershell
$gphSubModules = 'Authentication', 'Applications', 'DeviceManagement',
                 'Identity.DirectoryManagement', 'Identity.SignIns',
                 'Reports', 'Security', 'Users'
foreach ($m in $gphSubModules) {
    Install-Module "Microsoft.Graph.$m" -MinimumVersion 2.25.0 -Scope CurrentUser
}
```

### B. Required for full coverage (default `-Section All`)

These don't auto-resolve via the manifest — install them separately:

```powershell
# Exchange Online — version-pinned (3.8+ has MSAL conflict with Graph SDK)
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser

# Power BI — needed for the PowerBI section
Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser

# SharePoint Online — needed for SPO-specific checks (SOC2 confidentiality, etc.)
Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser
```

> **Why EXO 3.7.1 exactly?** Versions 3.8.0+ have an MSAL library conflict with the Microsoft Graph SDK. The assessment's pre-flight check detects this and offers to fix it automatically. Tracked at issue #231.

### C. Optional / opt-in

```powershell
# XLSX compliance matrix export
Install-Module ImportExcel -Scope CurrentUser

# Active Directory section (requires Windows + RSAT or domain controller access)
Add-WindowsCapability -Online -Name 'Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0'
```

### D. Verify your install

```powershell
Get-Module M365-Assess -ListAvailable | Format-Table Name, Version
# Expected: Name = M365-Assess, Version = 2.10.1+ (or current)

Get-Module Microsoft.Graph.Authentication, ExchangeOnlineManagement, MicrosoftPowerBIMgmt -ListAvailable |
    Format-Table Name, Version
# Each should show a version row
```

If any expected module is missing, re-run the corresponding install from §A or §B above. See [`../reference/COMPATIBILITY.md`](../reference/COMPATIBILITY.md) for the full version-pin matrix.

## 3. Run Your First Assessment

```powershell
# Interactive wizard -- walks you through section selection, auth, and output
Invoke-M365Assessment

# Or specify the tenant directly
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

A browser window will open for authentication. Sign in with a **Global Reader** or **Global Administrator** account.

## 4. Review the Output

Results land in a timestamped folder (e.g., `M365-Assessment/Assessment_20260330_143000_contoso/`):

| File | Description |
|------|-------------|
| `*.csv` | Raw data per collector (mailbox summary, MFA report, etc.) |
| `*_Assessment-Report.html` | React-based HTML report with all findings |
| `*_Compliance-Matrix.xlsx` | Framework compliance matrix (requires ImportExcel) |

Open the HTML report in any browser to review findings. The report is interactive — see [`REPORT-USER-GUIDE.md`](REPORT-USER-GUIDE.md) for the walkthrough of edit mode, Finalize, theme toggles, sortable/resizable columns, and other controls.

## What You Need

| Requirement | Minimum |
|-------------|---------|
| PowerShell | 7.0+ |
| Microsoft.Graph SDK | 2.25.0+ |
| ExchangeOnlineManagement | 3.7.1 (not 3.8+) |
| Entra ID role | Global Reader (read-only) |
| Network | Outbound HTTPS to `graph.microsoft.com`, `outlook.office365.com` |

## Troubleshooting

**"The term 'Invoke-M365Assessment' is not recognized"**
You need to import the module first: `Import-Module M365-Assess` (PSGallery) or `Import-Module ./src/M365-Assess` (source).

**Browser does not open for authentication**
Use device code flow: `Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -UseDeviceCode`

**MSAL / token errors**
The pre-flight module check detects common issues. Run with the interactive wizard (no parameters) to get guided repair prompts.

**Execution policy blocks scripts**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Next Steps

- **You have a Fail finding — what now?** See [FIRST-REMEDIATION.md](FIRST-REMEDIATION.md) — a worked-example walkthrough from initial Fail through remediation through re-verification.
- See [AUTHENTICATION.md](AUTHENTICATION.md) for certificate-based and service principal auth
- See [REPORT-USER-GUIDE.md](REPORT-USER-GUIDE.md) for report features, interactive walkthrough, and customization options
- See [COMPATIBILITY.md](../reference/COMPATIBILITY.md) for platform support details
