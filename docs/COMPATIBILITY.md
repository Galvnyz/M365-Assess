# Module Compatibility Matrix

## Supported PowerShell Version

| Requirement | Version |
|-------------|---------|
| Minimum     | 7.0     |
| Recommended | 7.4+    |

## Required Modules

### Microsoft Graph SDK

| Module | Minimum | Tested | Notes |
|--------|---------|--------|-------|
| Microsoft.Graph.Authentication | 2.25.0 | 2.35.0 | Core auth module -- install first |
| Microsoft.Graph.Identity.DirectoryManagement | 2.25.0 | 2.35.0 | Entra ID roles, policies |
| Microsoft.Graph.Identity.SignIns | 2.25.0 | 2.35.0 | Auth methods, CA policies |

Graph submodules (e.g., `Microsoft.Graph.Users`, `Microsoft.Graph.Groups`) are loaded on demand by collectors via `Invoke-MgGraphRequest`. Installing `Microsoft.Graph.Authentication` is sufficient -- submodule cmdlets are not used directly.

### Exchange Online Management

| Module | Minimum | Maximum | Tested | Notes |
|--------|---------|---------|--------|-------|
| ExchangeOnlineManagement | 3.5.0 | 3.7.x | 3.7.1 | **Do not install 3.8.0+** |

**Why the ceiling?** EXO 3.8.0 ships a version of `Microsoft.Identity.Client` (MSAL) that conflicts with Graph SDK 2.x, causing silent auth failures. The orchestrator blocks EXO >= 3.8.0 at startup.

### Optional Modules

| Module | Required For | Notes |
|--------|-------------|-------|
| ActiveDirectory | AD section | Windows RSAT feature -- unavailable on non-domain machines |
| MicrosoftPowerBIMgmt | Power BI section (planned) | Not yet implemented |
| PSScriptAnalyzer | Development/CI only | Not needed at runtime |
| Pester | Testing only | v5.0+ required |

## Installation

```powershell
# Graph SDK (installs all submodules)
Install-Module Microsoft.Graph -Scope CurrentUser

# Exchange Online (pinned to compatible version)
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser

# Verify installation
Get-Module -ListAvailable Microsoft.Graph.Authentication, ExchangeOnlineManagement |
    Select-Object Name, Version
```

## Known Incompatibilities

| Combination | Symptom | Fix |
|-------------|---------|-----|
| EXO >= 3.8.0 + Graph SDK 2.x | Silent auth failures, `msalruntime.dll` not found | Downgrade EXO to 3.7.1 |
| PowerShell 5.1 | Module load failures | Use PowerShell 7.0+ |
| Graph SDK 1.x | Cmdlet name changes | Upgrade to Graph SDK 2.x |
