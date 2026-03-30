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

## 2. Install Required Modules

Open **pwsh** (not the old `powershell.exe`) and install the assessment dependencies:

```powershell
# Required
Install-Module Microsoft.Graph -Scope CurrentUser
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser

# Optional (enables XLSX compliance matrix export)
Install-Module ImportExcel -Scope CurrentUser
```

> **Why EXO 3.7.1 specifically?** Versions 3.8.0+ have an MSAL library conflict with the Microsoft Graph SDK. The assessment's pre-flight check will detect and offer to fix this automatically.

## 3. Get the Module

### Option A: PSGallery (recommended)

```powershell
Install-Module M365-Assess -Scope CurrentUser
```

### Option B: Clone from source

```powershell
git clone https://github.com/Galvnyz/M365-Assess.git
cd M365-Assess
Import-Module ./src/M365-Assess
```

> **Downloaded the ZIP?** Windows marks extracted files as blocked. Unblock them:
> ```powershell
> Get-ChildItem -Path .\M365-Assess -Recurse -Filter *.ps1 | Unblock-File
> ```

## 4. Run Your First Assessment

```powershell
# Interactive wizard -- walks you through section selection, auth, and output
Invoke-M365Assessment

# Or specify the tenant directly
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

A browser window will open for authentication. Sign in with a **Global Reader** or **Global Administrator** account.

## 5. Review the Output

Results land in a timestamped folder (e.g., `M365-Assessment/Assessment_20260330_143000_contoso/`):

| File | Description |
|------|-------------|
| `*.csv` | Raw data per collector (mailbox summary, MFA report, etc.) |
| `*_Assessment.html` | Branded HTML report with all findings |
| `*_Compliance-Matrix.xlsx` | Framework compliance matrix (requires ImportExcel) |

Open the HTML report in any browser to review findings.

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

- See [AUTHENTICATION.md](../AUTHENTICATION.md) for certificate-based and service principal auth
- See [REPORT.md](../REPORT.md) for report customization options
- See [COMPATIBILITY.md](COMPATIBILITY.md) for platform support details
