# 0013 — One cmdlet, five auth modes, dispatched via PowerShell parameter sets

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

M365-Assess has to authenticate to several Microsoft services (Graph, EXO, SPO, Teams, Defender, Purview) under several different deployment realities:

- **Interactive at the desk.** Consultant clicks through a browser prompt with their own credentials. Fast iteration.
- **Certificate-based app-only.** Production assessment runs from a scheduled job, no human, app registration with a cert thumbprint.
- **Device code.** SSH'd into a server, no browser locally; need to authenticate against an external device. Also covers sovereign-cloud edge cases where the standard interactive flow stumbles.
- **Managed Identity.** Running inside an Azure VM / Function / Automation Runbook with a system-assigned identity. No secret to manage.
- **Pre-existing connection (`-SkipConnection`).** The user has already called `Connect-MgGraph` / `Connect-ExchangeOnline` themselves, possibly with a custom flow we don't support. Trust them, run the assessment without re-connecting.

A naïve PowerShell module would ship five separate cmdlets:

```powershell
Invoke-M365AssessmentInteractive -TenantId ...
Invoke-M365AssessmentCertificate -TenantId ... -ClientId ... -CertificateThumbprint ...
Invoke-M365AssessmentDeviceCode -TenantId ...
Invoke-M365AssessmentManagedIdentity ...
Invoke-M365AssessmentSkipConnection ...
```

That's the obvious factoring, and it's wrong for this audience. Consultants context-switch between auth modes constantly — same script, different deployment. Five names = five tab-completions to remember = five docs pages = five places to keep parameters in sync as the rest of the tool grows.

We needed mode selection to be a runtime concern, not a cmdlet-name concern, while still getting the per-mode parameter validation that PowerShell users expect (e.g. "Certificate mode requires `-ClientId` AND `-CertificateThumbprint`").

## Decision

A single cmdlet — `Invoke-M365Assessment` — with five PowerShell **parameter sets**, one per auth mode:

| Parameter set | Activated by | Required parameters |
|---|---|---|
| `Interactive` (default) | omitting all auth switches | `-TenantId` |
| `Certificate` | `-CertificateThumbprint` | `-TenantId`, `-ClientId`, `-CertificateThumbprint` |
| `DeviceCode` | `-UseDeviceCode` switch | `-TenantId`, `-UseDeviceCode` |
| `ManagedIdentity` | `-ManagedIdentity` switch | `-ManagedIdentity` (TenantId optional) |
| (implicit) | `-SkipConnection` switch | none — uses the existing session |

PowerShell's `[CmdletBinding(DefaultParameterSetName = 'Interactive')]` plus per-parameter `[Parameter(ParameterSetName = ...)]` attributes do the dispatch:

- Mutually-exclusive switches are enforced at parse time (`-UseDeviceCode` and `-ManagedIdentity` cannot both be supplied — PowerShell errors before the cmdlet runs).
- Mode-specific required parameters are enforced at parse time (`-CertificateThumbprint` without `-ClientId` errors).
- Parameters available to multiple modes (`-TenantId` shared across Interactive/DeviceCode/ManagedIdentity) get repeated `[Parameter]` attributes — verbose, but correct.

The cmdlet body inspects `$PSCmdlet.ParameterSetName` (or, in practice, `$PSBoundParameters.ContainsKey(...)`) to dispatch into the right `Connect-RequiredService` flow.

The interactive wizard (`Show-InteractiveWizard`) is a separate path that fires when the user runs `Invoke-M365Assessment` with no parameters at all, bound to the `Interactive` parameter set + `[Environment]::UserInteractive`. The wizard then populates parameters and the cmdlet re-dispatches.

See: [`src/M365-Assess/Invoke-M365Assessment.ps1`](../../src/M365-Assess/Invoke-M365Assessment.ps1) (the parameter block at line ~170 onward).

## Consequences

**Positive**

- One cmdlet to teach, one tab-completion to learn, one help page (`Get-Help Invoke-M365Assessment`) to read.
- Parameter-set validation is free at parse time. We don't have to write `if ($CertificateThumbprint -and -not $ClientId) { throw }` checks — PowerShell does it before the cmdlet body runs.
- Profile/preset re-use: a saved profile can carry whichever auth-mode parameters it needs, and replaying it picks the right parameter set automatically.
- The `-SkipConnection` "trust the user's session" mode is a clean addition: it doesn't fit the parameter-set model directly (it's orthogonal to auth mode), but coexists with the other sets without requiring its own cmdlet.
- Adding a sixth auth mode (e.g. workload identity federation) adds one parameter set, not a new cmdlet name + new doc + new parameter sync surface.

**Negative**

- Repeated `[Parameter(ParameterSetName = '...')]` attributes on shared parameters get noisy. `-TenantId` has the attribute three times. Refactor temptation is high; the verbosity is the cost of correctness.
- `Get-Help` output is a wall: every parameter shows in every parameter set. New users skim it and miss the mode separation. `.EXAMPLE` blocks are the actual onboarding surface.
- The `[Environment]::UserInteractive` wizard branch is a hidden mode-of-operation. Users running in unattended contexts that *happen* to report `UserInteractive = true` (some CI runners) get an unexpected wizard prompt unless they pass `-NonInteractive`. We added the explicit switch for this reason; it's still a footgun.
- Parameter-set names are public surface. Renaming `DeviceCode` → `BrowserlessAuth` would break every saved profile and every script that reads `$PSCmdlet.ParameterSetName`. Effectively immutable.
- A user who supplies `-CertificateThumbprint` AND `-UseDeviceCode` gets a "Parameter set cannot be resolved" error from PowerShell that's correct but cryptic. We've considered adding a friendlier preflight check; haven't shipped it.

**Failure modes and mitigations**

- *User in a CI runner with `UserInteractive = true` triggers the wizard* → ships an interactive prompt to a non-interactive context, hangs forever. Mitigation: explicit `-NonInteractive` switch documented and surfaced in the wizard's launch condition.
- *Parameter set ambiguity (matching multiple sets)* → PowerShell errors at parse time with a generic message. Mitigation: switch parameters (`-UseDeviceCode`, `-ManagedIdentity`) are mutually exclusive by being declared `Mandatory` on different sets. Hard to construct an ambiguous call by accident.
- *`-SkipConnection` used without an existing session* → assessment runs, every collector fails per-call. The skip-on-unavailable logic from [ADR-0007](0007-skip-collector-on-unavailable-service.md) catches this gracefully (every section reports `Skipped`). Loud failure surface.
- *Saved profile from v2.6 specifies an auth flag that v3.x renamed* → load fails. Mitigation: profile loader has compatibility shims for known renames; new flags get warning-level "unknown profile field" messages.

## Alternatives considered

- **Five separate cmdlets** (`Invoke-M365AssessmentInteractive`, `...Certificate`, etc). Rejected: see Context. Doubles the surface area, loses parameter-set validation, fragments tab-completion.
- **Single `-AuthMode` enum parameter (`-AuthMode Interactive | Certificate | DeviceCode | ManagedIdentity`).** Considered, ultimately rejected. PowerShell parameter sets give us mode-specific required-parameter validation for free; an enum forces us to write conditional validation in the cmdlet body. The current approach delegates validation to the language.
- **Auth-mode object parameter** (`-Authentication ([PSCustomObject]@{Mode='Certificate'; ClientId='...'; Thumbprint='...'})`). Rejected: terrible UX for the common interactive case, and loses tab-completion entirely for the auth fields.
- **Auto-detect mode from environment** (if `MI_AVAILABLE` env var → Managed Identity; if `CertificateThumbprint` env var → Certificate). Considered for Azure-Function-style use; rejected as default behaviour because it's surprising. We do support env-var-based parameter binding via PowerShell's standard mechanisms, but only on explicit opt-in.
- **Wrapper script per mode** (`m365-assess-cert.ps1`, `m365-assess-mi.ps1`, ...). Rejected: same problems as separate cmdlets, plus the wrappers go stale.

---

## See also

- [`../../src/M365-Assess/Invoke-M365Assessment.ps1`](../../src/M365-Assess/Invoke-M365Assessment.ps1) — parameter sets + dispatch
- [`../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1`](../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1) — per-mode connect logic the dispatch routes into
- [`../../src/M365-Assess/Orchestrator/Show-InteractiveWizard.ps1`](../../src/M365-Assess/Orchestrator/Show-InteractiveWizard.ps1) — the no-args interactive path
- [`../user/AUTHENTICATION.md`](../user/AUTHENTICATION.md) — user-facing per-mode walkthroughs
- [`0007-skip-collector-on-unavailable-service.md`](0007-skip-collector-on-unavailable-service.md) — what happens if a connection fails
- [`README.md`](README.md) — back to the ADR index
