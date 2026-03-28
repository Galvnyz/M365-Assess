# Interactive Module Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "dump errors and bail" module compatibility check with an interactive repair flow that offers to install/fix modules automatically.

**Architecture:** Single-file refactor of `Invoke-M365Assessment.ps1`. Replace the compat check block (lines 1439-1516) with structured detection → presentation → two-tier prompting → re-validation. Add `-NonInteractive` switch parameter.

**Tech Stack:** PowerShell 7.x, Pester 5

**Spec:** `docs/superpowers/specs/2026-03-26-interactive-module-repair-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `Invoke-M365Assessment.ps1` | Modify (~lines 185-188, 1439-1516) | Add parameter, replace compat check block |
| `tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1` | Create | Test module detection, repair flow, headless behavior |

---

## Task 1: Add `-NonInteractive` parameter

**Files:**
- Modify: `Invoke-M365Assessment.ps1:185-188`

- [ ] **Step 1: Read the param block and add the switch**

In `Invoke-M365Assessment.ps1`, after line 187 (`[string]$CisBenchmarkVersion = 'v6'`), add a comma and the new parameter before the closing `)`:

```powershell
    [Parameter()]
    [ValidatePattern('^v\d+$')]
    [string]$CisBenchmarkVersion = 'v6',

    [Parameter()]
    [switch]$NonInteractive
)
```

- [ ] **Step 2: Add `$isInteractive` derivation**

After line 190 (`$ErrorActionPreference = 'Stop'`), add:

```powershell
$isInteractive = -not $NonInteractive
```

- [ ] **Step 3: Run existing tests to confirm nothing breaks**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/ -Output Detailed"
```

Expected: all 640 tests pass.

- [ ] **Step 4: Commit**

```bash
git add Invoke-M365Assessment.ps1
git commit -m "feat: add -NonInteractive parameter for headless module handling (#214)"
```

---

## Task 2: Refactor detection into structured repair actions

**Files:**
- Modify: `Invoke-M365Assessment.ps1:1439-1488`
- Create: `tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1`

- [ ] **Step 1: Write tests for the detection logic**

Create `tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1`. Since the orchestrator is hard to unit test directly, we test by scanning the script source for key patterns (same approach as `Export-AssessmentReport.Tests.ps1`):

```powershell
BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Module repair detection' {
    BeforeAll {
        $scriptPath = "$PSScriptRoot/../Invoke-M365Assessment.ps1"
        $src = Get-Content -Path $scriptPath -Raw
    }

    Context 'Repair action structure' {
        It 'Should define repairActions list' {
            $src | Should -Match 'repairActions'
        }

        It 'Should check Graph module conditionally on needsGraph' {
            $src | Should -Match 'needsGraph.*-and.*-not.*graphModule'
        }

        It 'Should check EXO module conditionally on needsExo' {
            $src | Should -Match 'needsExo.*-and.*-not.*exoModule'
        }

        It 'Should check PowerBI module conditionally on needsPowerBI' {
            $src | Should -Match 'needsPowerBI.*-and.*-not.*PowerBI'
        }

        It 'Should include RequiredVersion field in repair actions' {
            $src | Should -Match 'RequiredVersion'
        }

        It 'Should set EXO RequiredVersion to 3.7.1' {
            $src | Should -Match "RequiredVersion.*=.*'3\.7\.1'"
        }
    }

    Context 'NonInteractive parameter' {
        It 'Should have NonInteractive switch parameter' {
            $src | Should -Match '\[switch\]\$NonInteractive'
        }

        It 'Should derive isInteractive from NonInteractive' {
            $src | Should -Match 'isInteractive.*=.*-not \$NonInteractive'
        }
    }

    Context 'Tier structure' {
        It 'Should define Install tier' {
            $src | Should -Match "Tier\s*=\s*'Install'"
        }

        It 'Should define Downgrade tier' {
            $src | Should -Match "Tier\s*=\s*'Downgrade'"
        }

        It 'Should define FileCopy tier' {
            $src | Should -Match "Tier\s*=\s*'FileCopy'"
        }
    }

    Context 'No Invoke-Expression' {
        It 'Should never use Invoke-Expression for module installation' {
            $src | Should -Not -Match 'Invoke-Expression.*Install-Module'
            $src | Should -Not -Match 'Invoke-Expression.*\$action\.InstallCmd'
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1 -Output Detailed"
```

Expected: most tests FAIL (old code uses `$compatErrors` strings, not `$repairActions`).

- [ ] **Step 3: Replace detection block with structured repair actions**

In `Invoke-M365Assessment.ps1`, replace lines 1440-1488 (from `$compatErrors = @()` through the PowerBI warning block) with:

```powershell
    $repairActions = [System.Collections.Generic.List[PSCustomObject]]::new()

    # Determine which modules the selected sections actually require (BEFORE checking modules)
    $needsGraph   = $false
    $needsExo     = $false
    $needsPowerBI = $false
    foreach ($s in $Section) {
        $svcList = $sectionServiceMap[$s]
        if ($svcList -contains 'Graph')                                    { $needsGraph = $true }
        if ($svcList -contains 'ExchangeOnline' -or $svcList -contains 'Purview') { $needsExo = $true }
        if ($s -eq 'PowerBI')                                               { $needsPowerBI = $true }
    }

    # Detect installed module versions
    $exoModule = Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1
    $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1

    # EXO 3.8.0+ MSAL conflict — must downgrade (only if EXO is needed)
    if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0') {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'ExchangeOnlineManagement'
            Issue           = "Version $($exoModule.Version) has MSAL conflicts (need <= 3.7.1)"
            Severity        = 'Required'
            Tier            = 'Downgrade'
            RequiredVersion = '3.7.1'
            InstallCmd      = 'Uninstall-Module ExchangeOnlineManagement -AllVersions -Force; Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser'
            Description     = "ExchangeOnlineManagement $($exoModule.Version) — MSAL conflict (need <= 3.7.1)"
        })

        # msalruntime.dll — Windows only, EXO 3.8.0+
        if ($IsWindows -or $null -eq $IsWindows) {
            $exoNetCorePath = Join-Path -Path $exoModule.ModuleBase -ChildPath 'netCore'
            $msalDllDirect = Join-Path -Path $exoNetCorePath -ChildPath 'msalruntime.dll'
            $msalDllNested = Join-Path -Path $exoNetCorePath -ChildPath 'runtimes\win-x64\native\msalruntime.dll'
            if (-not (Test-Path -Path $msalDllDirect) -and (Test-Path -Path $msalDllNested)) {
                $repairActions.Add([PSCustomObject]@{
                    Module          = 'ExchangeOnlineManagement'
                    Issue           = 'msalruntime.dll missing from load path'
                    Severity        = 'Required'
                    Tier            = 'FileCopy'
                    RequiredVersion = $null
                    InstallCmd      = "Copy-Item '$msalDllNested' '$msalDllDirect'"
                    Description     = 'msalruntime.dll — missing from EXO module load path'
                    SourcePath      = $msalDllNested
                    DestPath        = $msalDllDirect
                })
            }
        }
    }

    # Required modules — fatal if missing
    if ($needsGraph -and -not $graphModule) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'Microsoft.Graph.Authentication'
            Issue           = 'Not installed'
            Severity        = 'Required'
            Tier            = 'Install'
            RequiredVersion = $null
            InstallCmd      = 'Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force'
            Description     = 'Microsoft.Graph.Authentication — not installed'
        })
    }
    if ($needsExo -and -not $exoModule) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'ExchangeOnlineManagement'
            Issue           = 'Not installed'
            Severity        = 'Required'
            Tier            = 'Install'
            RequiredVersion = '3.7.1'
            InstallCmd      = 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
            Description     = 'ExchangeOnlineManagement — not installed'
        })
    }

    # Optional modules
    if ($needsPowerBI -and -not (Get-Module -Name MicrosoftPowerBIMgmt -ListAvailable -ErrorAction SilentlyContinue)) {
        $repairActions.Add([PSCustomObject]@{
            Module          = 'MicrosoftPowerBIMgmt'
            Issue           = 'Not installed'
            Severity        = 'Optional'
            Tier            = 'Install'
            RequiredVersion = $null
            InstallCmd      = 'Install-Module -Name MicrosoftPowerBIMgmt -Scope CurrentUser -Force'
            Description     = 'MicrosoftPowerBIMgmt — not installed (PowerBI will be skipped)'
        })
    }
```

- [ ] **Step 4: Run tests to verify detection tests pass**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1 -Output Detailed"
```

- [ ] **Step 5: Commit**

```bash
git add Invoke-M365Assessment.ps1 tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1
git commit -m "refactor: replace compat check strings with structured repair actions (#214)"
```

---

## Task 3: Add presentation and repair flow

**Files:**
- Modify: `Invoke-M365Assessment.ps1:1490-1516` (replace old warning/error display blocks)
- Modify: `tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1`

- [ ] **Step 1: Add tests for the repair flow patterns**

Append to `tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1`:

```powershell
Describe 'Module repair flow' {
    BeforeAll {
        $scriptPath = "$PSScriptRoot/../Invoke-M365Assessment.ps1"
        $src = Get-Content -Path $scriptPath -Raw
    }

    Context 'Presentation' {
        It 'Should display Module Issues Detected banner' {
            $src | Should -Match 'Module Issues Detected'
        }

        It 'Should use checkmark for required issues' {
            $src | Should -Match '\\u2717|✗'
        }

        It 'Should use warning symbol for optional issues' {
            $src | Should -Match '\\u26A0|⚠'
        }
    }

    Context 'Interactive repair' {
        It 'Should prompt for Tier 1 installs' {
            $src | Should -Match 'Install missing modules to CurrentUser scope'
        }

        It 'Should prompt separately for EXO downgrade' {
            $src | Should -Match 'Proceed with EXO downgrade'
        }

        It 'Should call Install-Module directly with splatted params' {
            $src | Should -Match 'Install-Module @installParams'
        }

        It 'Should not use Invoke-Expression' {
            $src | Should -Not -Match 'Invoke-Expression.*InstallCmd'
        }
    }

    Context 'Headless mode' {
        It 'Should skip prompts when not interactive' {
            $src | Should -Match 'if \(-not \$isInteractive\)'
        }

        It 'Should log errors for required issues in headless mode' {
            $src | Should -Match "Write-AssessmentLog.*-Level ERROR.*Module issue"
        }

        It 'Should skip optional sections in headless mode' {
            $src | Should -Match "Section.*Where-Object.*-ne.*PowerBI"
        }
    }

    Context 'Re-validation' {
        It 'Should re-run module detection after repairs' {
            $src | Should -Match 'Re-validate|re-validate|revalidat'
        }

        It 'Should show manual steps when repairs fail' {
            $src | Should -Match 'Unable to resolve all module issues|Manual steps needed'
        }
    }
}
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1 -Output Detailed"
```

- [ ] **Step 3: Replace old display blocks with new repair flow**

In `Invoke-M365Assessment.ps1`, replace lines 1490-1516 (from the `$compatWarnings.Count` check through `return`) with the full repair flow. This is the largest code block:

```powershell
    # --- No issues? Continue ---
    if ($repairActions.Count -eq 0) {
        Write-AssessmentLog -Level INFO -Message 'Module compatibility check passed' -Section 'Setup'
    }
    else {
        # --- Present summary ---
        Write-Host ''
        Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Magenta
        Write-Host '  ║  Module Issues Detected                                 ║' -ForegroundColor Magenta
        Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Magenta
        foreach ($action in $repairActions) {
            if ($action.Severity -eq 'Required') {
                Write-Host "    ✗ $($action.Description)" -ForegroundColor Red
            }
            else {
                Write-Host "    ⚠ $($action.Description)" -ForegroundColor Yellow
            }
        }
        Write-Host ''

        $requiredIssues = @($repairActions | Where-Object { $_.Severity -eq 'Required' })
        $optionalIssues = @($repairActions | Where-Object { $_.Severity -eq 'Optional' })

        if (-not $isInteractive) {
            # --- Headless: log and exit/skip ---
            if ($requiredIssues.Count -gt 0) {
                foreach ($action in $requiredIssues) {
                    Write-AssessmentLog -Level ERROR -Message "Module issue: $($action.Description). Fix: $($action.InstallCmd)"
                }
                Write-Host '  Known compatible combo: Graph SDK 2.35.x + EXO 3.7.1' -ForegroundColor DarkGray
                Write-Host ''
                Write-Error "Required modules are missing or incompatible. See assessment log for install commands."
                return
            }
            foreach ($action in $optionalIssues) {
                if ($action.Module -eq 'MicrosoftPowerBIMgmt') {
                    $Section = @($Section | Where-Object { $_ -ne 'PowerBI' })
                }
                Write-AssessmentLog -Level WARN -Message "Optional module missing: $($action.Description). Section skipped."
                Write-Host "    ⚠ $($action.Description) — section skipped" -ForegroundColor Yellow
            }
        }
        else {
            # --- Interactive: offer repairs ---
            $failedRepairs = [System.Collections.Generic.List[PSCustomObject]]::new()

            # Step 1: Auto-fix FileCopy (no prompt)
            $fileCopyActions = @($repairActions | Where-Object { $_.Tier -eq 'FileCopy' })
            foreach ($action in $fileCopyActions) {
                try {
                    Copy-Item -Path $action.SourcePath -Destination $action.DestPath -Force -ErrorAction Stop
                    Write-Host "    ✓ Copied msalruntime.dll to EXO module load path" -ForegroundColor Green
                }
                catch {
                    Write-Host "    ✗ msalruntime.dll copy failed: $_" -ForegroundColor Red
                    $failedRepairs.Add($action)
                }
            }

            # Step 2: Tier 1 — Install missing modules
            $installActions = @($repairActions | Where-Object { $_.Tier -eq 'Install' -and $_.Severity -eq 'Required' })
            if ($installActions.Count -gt 0) {
                $response = Read-Host '  Install missing modules to CurrentUser scope? [Y/n]'
                if ($response -match '^[Yy]?$') {
                    foreach ($action in $installActions) {
                        try {
                            Write-Host "    Installing $($action.Module)..." -ForegroundColor Cyan
                            $installParams = @{
                                Name        = $action.Module
                                Scope       = 'CurrentUser'
                                Force       = $true
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
                }
            }

            # Step 3: Tier 2 — EXO downgrade (separate confirmation)
            $downgradeActions = @($repairActions | Where-Object { $_.Tier -eq 'Downgrade' })
            foreach ($action in $downgradeActions) {
                Write-Host ''
                Write-Host "  ⚠ $($action.Module) $($action.Issue)" -ForegroundColor Yellow
                Write-Host "    This will uninstall ALL versions and install $($action.RequiredVersion)." -ForegroundColor Yellow
                $response = Read-Host '  Proceed with EXO downgrade? [Y/n]'
                if ($response -match '^[Yy]?$') {
                    try {
                        Write-Host "    Removing $($action.Module)..." -ForegroundColor Cyan
                        Uninstall-Module -Name $action.Module -AllVersions -Force -ErrorAction Stop
                        Write-Host "    Installing $($action.Module) $($action.RequiredVersion)..." -ForegroundColor Cyan
                        Install-Module -Name $action.Module -RequiredVersion $action.RequiredVersion -Scope CurrentUser -Force -ErrorAction Stop
                        Write-Host "    ✓ $($action.Module) $($action.RequiredVersion) installed" -ForegroundColor Green
                    }
                    catch {
                        Write-Host "    ✗ EXO downgrade failed: $_" -ForegroundColor Red
                        $failedRepairs.Add($action)
                    }
                }
            }

            # Optional modules — offer install or skip
            $optInstallActions = @($repairActions | Where-Object { $_.Tier -eq 'Install' -and $_.Severity -eq 'Optional' })
            foreach ($action in $optInstallActions) {
                if ($action.Module -eq 'MicrosoftPowerBIMgmt') {
                    $Section = @($Section | Where-Object { $_ -ne 'PowerBI' })
                    Write-AssessmentLog -Level WARN -Message "Optional module missing: $($action.Description). Section skipped."
                }
            }

            # Step 4: Re-validate after repairs
            Write-Host ''
            Write-Host '  Re-validating module compatibility...' -ForegroundColor Cyan

            # Re-detect modules
            $exoModule = Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
                Sort-Object -Property Version -Descending | Select-Object -First 1
            $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
                Sort-Object -Property Version -Descending | Select-Object -First 1

            $stillBroken = @()
            if ($needsGraph -and -not $graphModule) {
                $stillBroken += 'Install-Module -Name Microsoft.Graph.Authentication -Scope CurrentUser -Force'
            }
            if ($needsExo -and -not $exoModule) {
                $stillBroken += 'Install-Module -Name ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser -Force'
            }
            if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0') {
                $stillBroken += 'Uninstall-Module ExchangeOnlineManagement -AllVersions -Force; Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser'
            }
            # Re-check msalruntime.dll after any EXO install/downgrade
            if ($needsExo -and $exoModule -and $exoModule.Version -ge [version]'3.8.0' -and ($IsWindows -or $null -eq $IsWindows)) {
                $exoNetCorePath = Join-Path -Path $exoModule.ModuleBase -ChildPath 'netCore'
                $msalDllDirect = Join-Path -Path $exoNetCorePath -ChildPath 'msalruntime.dll'
                $msalDllNested = Join-Path -Path $exoNetCorePath -ChildPath 'runtimes\win-x64\native\msalruntime.dll'
                if (-not (Test-Path -Path $msalDllDirect) -and (Test-Path -Path $msalDllNested)) {
                    $stillBroken += "Copy-Item '$msalDllNested' '$msalDllDirect'"
                }
            }

            if ($stillBroken.Count -gt 0) {
                Write-Host ''
                Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Magenta
                Write-Host '  ║  Unable to resolve all module issues                    ║' -ForegroundColor Magenta
                Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Magenta
                Write-Host '    Manual steps needed:' -ForegroundColor Red
                foreach ($cmd in $stillBroken) {
                    Write-Host "    • $cmd" -ForegroundColor Red
                }
                Write-Host ''
                Write-Host '  Run these commands and try again.' -ForegroundColor DarkGray
                Write-Host '  Known compatible combo: Graph SDK 2.35.x + EXO 3.7.1' -ForegroundColor DarkGray
                Write-Host ''
                Write-AssessmentLog -Level ERROR -Message "Module repair incomplete: $($stillBroken -join '; ')"
                Write-Error "Required modules are still missing or incompatible. See above for manual steps."
                return
            }

            Write-Host '  ✓ All module issues resolved' -ForegroundColor Green
            Write-Host ''
        }
    }
```

- [ ] **Step 4: Run all tests**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/ -Output Detailed"
```

Expected: all tests pass including new ones.

- [ ] **Step 5: Commit**

```bash
git add Invoke-M365Assessment.ps1 tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1
git commit -m "feat: interactive module repair with two-tier prompting (#214)

Replace the dump-and-bail module check with an interactive flow:
- Structured summary of all module issues
- Tier 1: batch install missing modules (one prompt)
- Tier 2: separate confirmation for EXO downgrade
- Auto-fix msalruntime.dll (no prompt)
- Re-validate after repairs
- Headless mode: skip prompts, log errors, exit cleanly"
```

---

## Task 4: Final validation

- [ ] **Step 1: Run full test suite**

```bash
pwsh -NoProfile -Command "Invoke-Pester ./tests/ -Output Detailed"
```

- [ ] **Step 2: Verify the old compat check patterns are gone**

Search for the old `$compatErrors` and `$compatWarnings` variables — they should no longer exist:

```bash
grep -n 'compatErrors\|compatWarnings' Invoke-M365Assessment.ps1
```

Expected: zero matches.

- [ ] **Step 3: Verify no Invoke-Expression usage for module installs**

```bash
grep -n 'Invoke-Expression' Invoke-M365Assessment.ps1
```

Expected: zero matches (or none related to module installation).

- [ ] **Step 4: Commit any cleanup**

```bash
git add Invoke-M365Assessment.ps1 tests/Invoke-M365Assessment.ModuleRepair.Tests.ps1
git commit -m "chore: final cleanup for interactive module repair (#214)"
```
