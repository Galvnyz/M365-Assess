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
| ExchangeOnlineManagement | 3.5.0 | 3.7.x | 3.7.1 | 3.8.0+ may be installed **side-by-side** but is never loaded |

**Why the ceiling?** Newer EXO versions can conflict with Graph's identity assemblies in the same PowerShell process. The September 2026 probe below reproduces authentication failures with EXO 3.10.1, so the ceiling remains unchanged. Upstream tracking: [msgraph-sdk-powershell#3576](https://github.com/microsoftgraph/msgraph-sdk-powershell/issues/3576).

### Live compatibility probe (2026-09-28)

Windows build 26200, PowerShell 7.6.6, Microsoft.Graph.Authentication 2.40.0,
one commercial test tenant. Each case ran in a fresh process, importing and
connecting in the stated order through the project's `Connect-Service.ps1`.

| EXO | Authentication | Graph first | EXO first |
|-----|----------------|-------------|-----------|
| 3.7.1 | Certificate | Passed | Passed |
| 3.7.1 | Interactive | Passed | Passed |
| 3.10.1 | Certificate | Passed | Failed: Graph identity assembly loading |
| 3.10.1 | Interactive | Failed: EXO WAM RuntimeBroker null reference | Failed: Graph identity assembly loading |

Passed cases read Graph organization data, Exchange audit configuration, and
Purview DLP policies, then rechecked Graph and reconnected Exchange and Graph.
Purview can replace overlapping Exchange commands; audit evidence is read before
that switch, as in the assessment. Both versions imported successfully in both
orders: **import-only success is not authentication compatibility**.

These are representative connector/collection probes, not a full assessment or
coverage of every module combination. Linux, macOS, sovereign clouds and older
PowerShell versions were not tested. Next for #231: evaluate process isolation
for EXO/Purview versus Graph, preserving explicit collection failures; do not
raise the ceiling based on the single successful 3.10.1 path.

Reproduce with exact versions installed side-by-side (or saved into `./Modules`):

```powershell
pwsh -NoProfile -File ./scripts/Test-ExoGraphCompatibility.ps1 -ExoVersion 3.10.1 -GraphVersion 2.40.0 -Order ExoFirst -ModulePath ./Modules
```

Add `-Live -TenantId <initial-domain>` for interactive read-only probes; add
`-ClientId <app-id> -CertificateThumbprint <thumbprint>` for Windows certificate
authentication. Repeat with both orders and the 3.7.1 control. `-OutputPath`
writes a JSON summary without tenant identities or raw service errors. Underlying
SDK console output may contain account information; do not publish transcripts.

**Side-by-side support (#231):** you do *not* need to uninstall newer EXO versions you use for other tooling. Install 3.7.1 alongside them:

```powershell
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force
```

The orchestrator detects the compatible version and pins its import for the assessment session (`Import-Module -RequiredVersion`), leaving newer versions untouched. Only when **no** version below 3.8.0 is installed does the module helper prompt — and the repair installs 3.7.1 side-by-side rather than uninstalling anything.

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

# Exchange Online (pinned to compatible version)
Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser

# Verify installation
Get-Module -ListAvailable Microsoft.Graph.Authentication, ExchangeOnlineManagement |
    Select-Object Name, Version
```

## Automatic Module Repair

The orchestrator's built-in module helper detects missing or incompatible modules at startup and offers to fix them interactively. In headless environments, use `-NonInteractive` to log issues with fix commands and exit cleanly instead of prompting. See the [README](../README.md#module-helper) for details.

## Known Incompatibilities

| Combination | Symptom | Fix |
|-------------|---------|-----|
| EXO >= 3.8.0 + Graph SDK 2.x | Silent auth failures, `msalruntime.dll` not found | Install 3.7.1 side-by-side (the session pins it automatically) |
| PowerShell 5.1 | Module load failures | Use PowerShell 7.0+ |
| Graph SDK 1.x | Cmdlet name changes | Upgrade to Graph SDK 2.x |
