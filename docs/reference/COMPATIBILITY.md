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

**Current implementation:** the orchestrator still pins the older version. This is not evidence that EXO 3.10.1 is unusable: corrected direct SDK tests below establish a working Graph-first path. #231 targets supporting the newer version with explicit authentication and connection-order handling. Upstream tracking: [msgraph-sdk-powershell#3576](https://github.com/microsoftgraph/msgraph-sdk-powershell/issues/3576).

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

**Correction after direct SDK retesting:** the table above describes the existing
connector, which did not exercise the documented WAM workaround. With EXO 3.10.1
and Graph Authentication 2.40.0, Graph-first interactive authentication passed
using `UserPrincipalName`, omitting interactive `Organization`, and explicitly
setting `DisableWAM` for Exchange/Purview. The same corrected parameters with
default WAM still failed in EXO's RuntimeBroker on this Windows host. Graph-first
certificate authentication also passed using the initial tenant domain as
`Organization`. EXO-first certificate authentication still failed with a missing
MSAL `WithLogging` method, with both Graph Authentication 2.37.0 and 2.40.0.

The initial conclusion that these failures justified rejecting EXO 3.10.1 was
too broad. Prefer integrating the verified newer-module path: deterministic
Graph-first initialization, authentication-specific parameters, and an explicit
WAM fallback. Process isolation is an alternative if that integration proves
insufficient. Microsoft's [WAM guidance](https://learn.microsoft.com/en-us/troubleshoot/exchange/administration/wam-integration-issues)
describes `DisableWAM` as a temporary workaround, not a universal default.
These are representative probes, not a full assessment. Linux, macOS, sovereign
clouds and older PowerShell versions remain untested.

Reproduce with exact versions installed side-by-side (or saved into `./Modules`):

```powershell
pwsh -NoProfile -File ./scripts/Test-ExoGraphCompatibility.ps1 -ExoVersion 3.10.1 -GraphVersion 2.40.0 -Order ExoFirst -ModulePath ./Modules
```

Add `-Live -TenantId <initial-domain>` for interactive read-only probes; add
`-ClientId <app-id> -CertificateThumbprint <thumbprint>` for Windows certificate
authentication. Repeat with both orders and the 3.7.1 control. `-OutputPath`
writes a JSON summary without tenant identities or raw service errors. Underlying
SDK console output may contain account information; do not publish transcripts.

Use `-DirectSdk` to separate SDK compatibility from the existing connector.
For Graph-first interactive testing, compare runs with and without `-DisableWAM`;
`-UserPrincipalName` optionally selects the account (otherwise the Graph account
is reused). Direct SDK certificate tests resolve the initial domain through
Graph; EXO-first requires that domain as `TenantId`. Run interactive tests in a
terminal that supports authentication windows; a missing Graph WAM window handle
is a host failure before EXO is exercised.

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
| EXO 3.10.1 first + Graph Authentication 2.37.0 / 2.40.0 (certificate) | Missing MSAL `WithLogging` method | Graph-first passes; production integration tracked in #231 |
| EXO 3.10.1 interactive WAM on tested Windows host | RuntimeBroker null reference | Direct Graph-first test passes with explicit `DisableWAM`; see limitations above |
| PowerShell 5.1 | Module load failures | Use PowerShell 7.0+ |
| Graph SDK 1.x | Cmdlet name changes | Upgrade to Graph SDK 2.x |
