# Interactive Module Repair — Design Spec

**Issue:** #214
**Goal:** Replace the "dump errors and bail" module check with an interactive repair flow that detects issues, presents a clear summary, and offers to fix them automatically.

---

## Parameters

Add `[switch]$NonInteractive` to `Invoke-M365Assessment.ps1` param block, appended after the last existing parameter (`$CisBenchmarkVersion` at ~line 187).

```powershell
$isInteractive = -not $NonInteractive
```

No TTY auto-detection — the user explicitly opts into headless mode. Auth headless detection (PR #201's browser-availability check for device code) remains separate and unaffected.

---

## Detection

Refactor the existing detection logic (lines 1440-1488) to produce structured repair action objects instead of raw strings. The detection is **conditional on selected sections** — Graph is only required when `$needsGraph` is true, EXO only when `$needsExo` is true, etc.

| Scenario | Severity | Condition | Tier |
|---|---|---|---|
| `Microsoft.Graph.Authentication` missing | Required | `$needsGraph` | Install |
| `ExchangeOnlineManagement` missing | Required | `$needsExo` | Install (pinned to 3.7.1) |
| `ExchangeOnlineManagement` >= 3.8.0 (MSAL conflict) | Required | `$needsExo` | Downgrade |
| `msalruntime.dll` in wrong path (Windows + EXO 3.8.0+) | Required | EXO 3.8.0+ installed | FileCopy |
| `MicrosoftPowerBIMgmt` missing | Optional | `$needsPowerBI` | Install |

Restructure into a list of repair action objects:

```powershell
$repairActions = [System.Collections.Generic.List[PSCustomObject]]::new()

# Example entry:
[PSCustomObject]@{
    Module          = 'Microsoft.Graph.Authentication'
    Issue           = 'Not installed'
    Severity        = 'Required'       # Required | Optional
    Tier            = 'Install'        # Install | Downgrade | FileCopy
    RequiredVersion = $null            # Only set for EXO pinning
    Description     = 'Microsoft.Graph.Authentication — not installed'
}
```

**Important:** EXO installs always pin to 3.7.1 via `RequiredVersion`, whether it's a fresh install (Tier=Install) or a downgrade (Tier=Downgrade). The `RequiredVersion` field drives the `Install-Module` call.

Tier values:
- **Install** — `Install-Module` call, low risk, batched under Tier 1 prompt. Uses `RequiredVersion` if set, otherwise installs latest.
- **Downgrade** — uninstall + reinstall at pinned version, separate Tier 2 prompt
- **FileCopy** — `Copy-Item` for msalruntime.dll, no prompt needed

The `InstallCmd` field is **display-only** — shown in manual fallback instructions. Never passed to `Invoke-Expression`.

---

## Presentation

Replace the current raw error dump with a structured summary:

```
  ╔══════════════════════════════════════════════════════════╗
  ║  Module Issues Detected                                 ║
  ╚══════════════════════════════════════════════════════════╝
    ✗ Microsoft.Graph.Authentication — not installed
    ✗ ExchangeOnlineManagement 3.8.0 — MSAL conflict (need <= 3.7.1)
    ⚠ MicrosoftPowerBIMgmt — not installed (PowerBI will be skipped)
```

Use `✗` (red) for required, `⚠` (yellow) for optional.

---

## Repair Flow

### Interactive mode (default, `$isInteractive -eq $true`)

Initialize tracking for failed repairs:
```powershell
$failedRepairs = [System.Collections.Generic.List[PSCustomObject]]::new()
```

**Step 1 — Auto-fix FileCopy actions (no prompt)**

If `msalruntime.dll` needs copying, do it silently and report:
```
    ✓ Copied msalruntime.dll to EXO module load path
```

Note: FileCopy only applies when EXO 3.8.0+ is already installed. If EXO is missing entirely, there is no DLL to copy. The Step 4 re-validation will re-check this after any EXO install/downgrade.

**Step 2 — Tier 1: Install missing modules**

Collect all `Tier -eq 'Install'` actions. If any exist, prompt once:
```
  Install missing modules to CurrentUser scope? [Y/n]:
```

On approval, install each independently with try/catch. Call `Install-Module` directly — do NOT use `Invoke-Expression`:
```powershell
foreach ($action in $installActions) {
    try {
        Write-Host "    Installing $($action.Module)..." -ForegroundColor Cyan
        $installParams = @{
            Name  = $action.Module
            Scope = 'CurrentUser'
            Force = $true
            ErrorAction = 'Stop'
        }
        if ($action.RequiredVersion) {
            $installParams['RequiredVersion'] = $action.RequiredVersion
        }
        Install-Module @installParams
        Write-Host "    ✓ $($action.Module) installed" -ForegroundColor Green
    }
    catch {
        Write-Host "    ✗ $($action.Module) failed: $_" -ForegroundColor Red
        $failedRepairs.Add($action)
    }
}
```

On decline (`n`), skip to manual instructions.

**Step 3 — Tier 2: EXO downgrade**

If a `Tier -eq 'Downgrade'` action exists, prompt separately:
```
  ⚠ ExchangeOnlineManagement 3.8.0 has MSAL conflicts with Microsoft.Graph.
    This will uninstall ALL versions and install 3.7.1.
  Proceed with EXO downgrade? [Y/n]:
```

On approval:
```powershell
try {
    Write-Host "    Removing ExchangeOnlineManagement..." -ForegroundColor Cyan
    Uninstall-Module -Name ExchangeOnlineManagement -AllVersions -Force -ErrorAction Stop
    Write-Host "    Installing ExchangeOnlineManagement 3.7.1..." -ForegroundColor Cyan
    Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force -ErrorAction Stop
    Write-Host "    ✓ ExchangeOnlineManagement 3.7.1 installed" -ForegroundColor Green
}
catch {
    Write-Host "    ✗ EXO downgrade failed: $_" -ForegroundColor Red
    $failedRepairs.Add($action)
}
```

**Step 4 — Re-validate**

Re-run the full module detection logic from scratch (not using `$failedRepairs` — fresh detection). This also re-evaluates the msalruntime.dll check against whatever EXO version is now installed. Three outcomes:

1. **All clear** — continue the assessment
2. **Only optional modules missing** (user declined install) — skip those sections, warn, continue
3. **Required modules still broken** — show remaining manual commands and exit

```
  ╔══════════════════════════════════════════════════════════╗
  ║  Unable to resolve all module issues                    ║
  ╚══════════════════════════════════════════════════════════╝
    Manual steps needed:
    • Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser

  Run these commands and try again.
```

### Headless mode (`-NonInteractive`)

No prompts, no installs. The `$Section` mutation (stripping skipped sections) happens **only** in this branch — the existing unconditional `$Section` mutation at line 1486 moves into here.

- **Optional modules missing** (PowerBI): skip the section, log warning via `Write-AssessmentLog`
- **Required modules missing/broken**: log error with install commands (display-only strings), exit non-zero
- The assessment log file will contain the exact commands needed so operators can fix their automation

```powershell
if (-not $isInteractive) {
    $requiredIssues = @($repairActions | Where-Object { $_.Severity -eq 'Required' })
    $optionalIssues = @($repairActions | Where-Object { $_.Severity -eq 'Optional' })

    if ($requiredIssues.Count -gt 0) {
        foreach ($action in $requiredIssues) {
            Write-AssessmentLog -Level ERROR -Message "Module issue: $($action.Description). Fix: $($action.InstallCmd)"
        }
        Write-Error "Required modules are missing or incompatible. See assessment log for install commands."
        return
    }
    # Optional issues: skip sections, warn
    foreach ($action in $optionalIssues) {
        if ($action.Module -eq 'MicrosoftPowerBIMgmt') {
            $Section = @($Section | Where-Object { $_ -ne 'PowerBI' })
        }
        Write-AssessmentLog -Level WARN -Message "Optional module missing: $($action.Description). Section skipped."
        Write-Host "    ⚠ $($action.Description) — section skipped" -ForegroundColor Yellow
    }
}
```

---

## Scope

**Single file change:** `Invoke-M365Assessment.ps1`

- Add `[switch]$NonInteractive` parameter at end of param block (~line 187)
- Replace lines ~1440-1516 (current compat check + error dump) with the new repair flow
- Move `$Section` mutation for optional modules out of the always-run detection and into the appropriate mode branches
- Add `$isInteractive` derivation after parameter binding

**No new files.** The repair logic is a self-contained block within the orchestrator.

---

## What we don't do

- No `PSResourceGet` / `Install-PSResource` — `Install-Module` only
- No `Invoke-Expression` — call `Install-Module` directly with splatted params
- No `AllUsers` / system scope — `CurrentUser` only, no elevation needed
- No NuGet provider bootstrap — if `Install-Module` fails due to missing NuGet, show the manual command
- No retry logic — one attempt per module, report result
- No module version pinning beyond EXO 3.7.1 — install latest for everything else

---

## Testing

1. **Missing Graph module** — verify prompt appears, install works, assessment continues
2. **EXO 3.8.0 conflict** — verify separate downgrade prompt, uninstall/reinstall works
3. **EXO missing entirely** — verify Tier 1 installs at pinned 3.7.1 (not latest)
4. **PowerBI missing (interactive)** — verify warning displayed, section skipped (no install prompt for optional)
5. **PowerBI missing (headless)** — verify silent skip with log warning
6. **All modules present** — verify no prompts, assessment starts normally
7. **User declines all repairs** — verify manual commands shown, clean exit
8. **Install fails (no internet)** — verify graceful error, manual fallback shown
9. **`-NonInteractive` flag** — verify no prompts, required issues exit, optional issues skip sections
10. **Only PowerBI selected** — verify Graph/EXO are not flagged as required
