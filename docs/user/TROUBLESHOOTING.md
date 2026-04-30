# Troubleshooting Guide

Common issues when running M365-Assess and how to resolve them.

> **Tip:** Most issues stem from module version conflicts or missing permissions.
> If you are new to M365-Assess, start with the [Quickstart Guide](QUICKSTART.md).

---

## Table of Contents

1. [Graph Permission Errors](#1-graph-permission-errors)
2. [EXO MSAL Assembly Conflicts](#2-exo-msal-assembly-conflicts)
3. [Execution Policy / Blocked Scripts](#3-execution-policy--blocked-scripts)
4. [Module Version Conflicts](#4-module-version-conflicts)
5. [Non-Interactive Mode Failures](#5-non-interactive-mode-failures)
6. [Power BI Connection Issues](#6-power-bi-connection-issues)

---

## 1. Graph Permission Errors

[Back to top](#table-of-contents)

### Symptom

- HTTP 401 (Unauthorized) or 403 (Forbidden) errors during assessment
- Messages like `Insufficient privileges to complete the operation`
- Collectors return empty results for sections that should have data

### Cause

The app registration (or delegated session) does not have the required Microsoft Graph scopes, or an admin has not granted tenant-wide consent for the requested permissions.

### Resolution

**Option A -- Use the consent helper (recommended):**

```powershell
Grant-M365AssessConsent
```

This opens an interactive consent prompt for all scopes the assessment requires. A Global Administrator must approve the consent.

**Option B -- Grant permissions manually in the Entra admin center:**

1. Go to **Entra admin center** > **App registrations** > your app > **API permissions**
2. Add all Microsoft Graph application permissions listed in [AUTHENTICATION.md](../AUTHENTICATION.md)
3. Click **Grant admin consent for \<tenant\>**
4. Wait 1--2 minutes for propagation, then retry the assessment

**Verify permissions are applied:**

```powershell
# List the scopes your current session holds
(Get-MgContext).Scopes | Sort-Object
```

---

## 2. EXO MSAL Assembly Conflicts

[Back to top](#table-of-contents)

### Symptom

- `Could not load type 'Microsoft.Identity.Client.AuthenticationResult'`
- `Could not load file or assembly 'Microsoft.Identity.Client, Version=4.x...'`
- Assessment fails immediately after connecting to Exchange Online

### Cause

ExchangeOnlineManagement version 3.8.0 and later ships a newer MSAL (`Microsoft.Identity.Client`) assembly that conflicts with the version bundled in the Microsoft.Graph SDK modules. PowerShell cannot load two different versions of the same assembly in one session.

### Resolution

Downgrade ExchangeOnlineManagement to the last compatible version:

```powershell
# Remove the conflicting version
Uninstall-Module ExchangeOnlineManagement -AllVersions -Force

# Install the compatible version
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Force
```

After downgrading, **close and reopen your PowerShell session** before running the assessment. Assemblies loaded in the current session persist until the process exits.

**Verify the installed version:**

```powershell
Get-Module ExchangeOnlineManagement -ListAvailable | Select-Object Name, Version
```

---

## 3. Execution Policy / Blocked Scripts

[Back to top](#table-of-contents)

### Symptom

- `File C:\...\M365-Assess.psm1 cannot be loaded because running scripts is disabled on this system`
- `File C:\...\Invoke-M365Assessment.ps1 is not digitally signed. The script will not execute on the system.`

### Cause

Windows applies a Zone.Identifier alternate data stream (ADS) to files downloaded from the internet (including GitHub releases and `Save-Module`). The default execution policy (`Restricted` or `AllSigned`) blocks these files.

### Resolution

**Option A -- Unblock the downloaded files:**

```powershell
# Unblock all files in the module directory
Get-ChildItem -Path (Get-Module M365-Assess -ListAvailable).ModuleBase -Recurse |
    Unblock-File
```

**Option B -- Set execution policy for your user:**

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

`RemoteSigned` allows local scripts to run and requires downloaded scripts to be either signed or unblocked. This is the recommended policy for development and assessment workstations.

**Verify the current policy:**

```powershell
Get-ExecutionPolicy -List
```

---

## 4. Module Version Conflicts

[Back to top](#table-of-contents)

### Symptom

- `Method not found: 'Void Microsoft.Graph...'`
- `Could not load type 'Microsoft.Graph.PowerShell.Models...'`
- `The term 'Get-MgUser' is not recognized` (even though the module is installed)

### Cause

Multiple versions of the Microsoft.Graph SDK sub-modules are installed side by side. PowerShell may load mismatched versions (e.g., `Microsoft.Graph.Authentication` v2.x with `Microsoft.Graph.Users` v1.x), causing type and method resolution failures.

### Resolution

**Step 1 -- Identify installed versions:**

```powershell
Get-Module Microsoft.Graph* -ListAvailable |
    Select-Object Name, Version, ModuleBase |
    Sort-Object Name
```

**Step 2 -- Remove older versions:**

```powershell
# Remove ALL versions, then reinstall the latest
Get-Module Microsoft.Graph* -ListAvailable |
    ForEach-Object { Uninstall-Module $_.Name -AllVersions -Force -ErrorAction SilentlyContinue }

Install-Module Microsoft.Graph -Force
```

**Step 3 -- Restart PowerShell** and confirm a single version is loaded:

```powershell
Get-Module Microsoft.Graph.Authentication -ListAvailable
```

> **Important:** Always close and reopen your PowerShell session after uninstalling or
> reinstalling Graph modules. Assemblies from the old version remain loaded until the
> process exits.

---

## 5. Non-Interactive Mode Failures

[Back to top](#table-of-contents)

### Symptom

- `Required modules are missing or incompatible`
- Assessment exits immediately when running in CI pipelines or scheduled tasks
- `A command that prompts the user failed because the host does not support user interaction`

### Cause

When `-NonInteractive` is used (or when running in a non-interactive host such as Azure DevOps agents or GitHub Actions), M365-Assess cannot prompt to install missing modules. All required modules must be pre-installed before the assessment runs.

### Resolution

**Pre-install all required modules in your automation script or pipeline setup step:**

```powershell
# Install required modules (run once during pipeline setup)
$modules = @(
    @{ Name = 'Microsoft.Graph.Authentication' }
    @{ Name = 'Microsoft.Graph.Users' }
    @{ Name = 'Microsoft.Graph.Groups' }
    @{ Name = 'Microsoft.Graph.Identity.DirectoryManagement' }
    @{ Name = 'Microsoft.Graph.Identity.SignIns' }
    @{ Name = 'Microsoft.Graph.Identity.Governance' }
    @{ Name = 'Microsoft.Graph.Security' }
    @{ Name = 'Microsoft.Graph.Applications' }
    @{ Name = 'ExchangeOnlineManagement'; RequiredVersion = '3.7.1' }
)

foreach ($mod in $modules) {
    if (-not (Get-Module $mod.Name -ListAvailable)) {
        Install-Module @mod -Force -Scope CurrentUser
    }
}
```

**Authenticate using certificate-based auth for unattended runs:**

```powershell
Invoke-M365Assessment -TenantId <tenant-id> `
    -ClientId <app-id> `
    -CertificateThumbprint <thumbprint> `
    -NonInteractive
```

> **Note:** Certificate-based authentication requires an Entra ID app registration
> with the appropriate application permissions (not delegated).

---

## 6. Power BI Connection Issues

[Back to top](#table-of-contents)

### Symptom

- `Login-PowerBIServiceAccount` times out or hangs
- `The operation has timed out` after 90 seconds
- Power BI section returns no data in non-interactive pipelines

### Cause

The `MicrosoftPowerBIMgmt` module supports interactive, certificate, and client secret authentication, but does not support device code or managed identity. Connection issues typically occur in headless environments where interactive login is expected but no browser is available.

### Resolution

**Option A -- Exclude the Power BI section:**

```powershell
Invoke-M365Assessment -Section Tenant,Identity,Licensing,Email,Intune,Security,Collaboration,Hybrid
```

Omit `PowerBI` from the `-Section` list when running in CI/CD or any non-interactive context.

**Option B -- Authenticate interactively before running the assessment:**

```powershell
# Connect to Power BI first in an interactive session
Connect-PowerBIServiceAccount

# Then run the assessment -- it will reuse the existing session
Invoke-M365Assessment
```

**Option C -- Run Power BI separately:**

If you need Power BI data but run most sections non-interactively, run two passes:

1. Run the full assessment without `PowerBI` in your `-Section` list in your pipeline
2. Run a second interactive pass with only the Power BI section enabled

---

## Still Having Issues?

- Check the [Quickstart Guide](QUICKSTART.md) for initial setup steps
- Review the [README](../README.md) for supported environments and prerequisites
- Open an issue at [github.com/Galvnyz/M365-Assess/issues](https://github.com/Galvnyz/M365-Assess/issues) with:
  - The full error message
  - Your PowerShell version (`$PSVersionTable.PSVersion`)
  - Your module versions (`Get-Module Microsoft.Graph*, ExchangeOnlineManagement -ListAvailable`)
