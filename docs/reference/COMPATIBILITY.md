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

| Module | Minimum / tested baseline | Selection | Runtime |
|--------|---------------------------|-----------|---------|
| ExchangeOnlineManagement | 3.10.1 | Newest installed stable release >= 3.10.1 | PowerShell 7.6+ |

EXO 3.10.1 is the primary supported version. The old 3.7.x ceiling and downgrade
repair are removed. Newer stable releases are eligible, but are not automatically
claimed as tested. Microsoft specifies PowerShell 7.6+ for EXO 3.10.x in its
[release notes](https://www.powershellgallery.com/packages/ExchangeOnlineManagement/3.10.1).
Graph-only assessments retain the module's existing PowerShell minimum.

The orchestrator authenticates Graph before importing EXO, including Exchange-only
and Purview-only selections. If Graph fails, dependent connections are skipped
with explicit errors. Start a fresh PowerShell session if an older EXO version
is loaded or EXO was loaded before Graph authentication. Other installed EXO
versions are preserved. `-SkipConnection` leaves connection setup to the caller,
who must establish the same supported order and versions.

Certificate authentication uses the tenant's initial onmicrosoft domain as
`Organization`, resolved through Graph if necessary. Interactive authentication
uses `UserPrincipalName` (or the connected Graph account), without `Organization`.
On hosts with EXO/Purview WAM broker errors, use `Invoke-M365Assessment -DisableWAM`.
This explicit [Microsoft workaround](https://learn.microsoft.com/en-us/troubleshoot/exchange/administration/wam-integration-issues)
is not enabled by default and does not change Graph authentication.

### Live compatibility validation (2026-09-28)

Windows build 26200, PowerShell 7.6.6, Graph Authentication 2.40.0, one commercial
test tenant; each test starts in a fresh process.

| EXO 3.10.1 path | Result |
|----------------|--------|
| Graph-first certificate | Passed Graph, Exchange audit, Purview DLP reads and Exchange/Graph reconnects |
| Graph-first interactive, explicit DisableWAM | Passed the same reads and reconnects |
| Graph-first interactive, default WAM | RuntimeBroker failure on the tested host |
| EXO-first certificate | Missing MSAL WithLogging method with Graph Authentication 2.37.0 and 2.40.0 |

Import-only success is insufficient. These are representative connection and
collection probes, not every collector or platform. Linux, macOS, sovereign
clouds and managed identity are not live-validated by this matrix.

Reproduce with exact versions saved side-by-side into `./Modules`:

```powershell
pwsh -NoProfile -File ./scripts/Test-ExoGraphCompatibility.ps1 -ExoVersion 3.10.1 -GraphVersion 2.40.0 -Order GraphFirst -ModulePath ./Modules -Live -TenantId <initial-domain> -DisableWAM
```

For certificate authentication omit `-DisableWAM` and add `-ClientId` and
`-CertificateThumbprint`. `-DirectSdk` separates upstream SDK behavior from the
production connector and permits diagnostic EXO-first tests. `-OutputPath` saves
sanitized JSON; SDK console output can contain account information. Run interactive
tests in a terminal supporting authentication windows.

### Optional Modules

| Module | Required For | Notes |
|--------|-------------|-------|
| ActiveDirectory | AD section | Windows RSAT feature -- unavailable on non-domain machines |
| MicrosoftPowerBIMgmt | Power BI section | Required for CIS 9.x checks. `Install-Module MicrosoftPowerBIMgmt -Scope CurrentUser` |
| PSScriptAnalyzer | Development/CI only | Not needed at runtime |
| Pester | Testing only | v5.0+ required |

## Installation

```powershell
# Graph SDK (installs all submodules)
Install-Module Microsoft.Graph -Scope CurrentUser

# Exchange Online (primary tested baseline)
Install-Module ExchangeOnlineManagement -RequiredVersion 3.10.1 -Scope CurrentUser

# Verify installation
Get-Module -ListAvailable Microsoft.Graph.Authentication, ExchangeOnlineManagement |
    Select-Object Name, Version
```

## Automatic Module Repair

The orchestrator's built-in module helper detects missing or incompatible modules at startup and offers to fix them interactively. In headless environments, use `-NonInteractive` to log issues with fix commands and exit cleanly instead of prompting. See the [README](../README.md#module-helper) for details.

## Known Incompatibilities

| Combination | Symptom | Fix |
|-------------|---------|-----|
| EXO 3.10.1 first + Graph Authentication 2.37.0 / 2.40.0 (certificate) | Missing MSAL `WithLogging` method | Graph-first passes; orchestrator enforces Graph-first |
| EXO 3.10.1 interactive WAM on tested Windows host | RuntimeBroker null reference | Use explicit `-DisableWAM`; see limitations above |
| PowerShell 5.1 | Module load failures | Use PowerShell 7.0+ |
| Graph SDK 1.x | Cmdlet name changes | Upgrade to Graph SDK 2.x |
