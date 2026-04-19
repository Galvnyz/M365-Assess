# TUI Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Write-Progress with a full-screen Spectre.Console live dashboard showing real-time check results, section progress, and metrics — with a CI-safe fallback path.

**Architecture:** A `[hashtable]::Synchronized` acts as a shared state bridge between the main thread (collectors writing results) and a background PS runspace running Spectre's `AnsiConsole.Live()` render loop. `Initialize-CheckProgress` detects CI/non-interactive environments and routes to either path. `Close-CheckProgress` blocks on the background runspace's `EndInvoke` (which waits for the user to press a key inside the Live context) before returning the prompt.

**Tech Stack:** PowerShell 7.x, Spectre.Console 0.49.1 (.NET NuGet, bundled as `src/M365-Assess/lib/Spectre.Console.dll`), `[System.Management.Automation.PowerShell]` runspace API

**Spec:** `docs/specs/2026-04-19-tui-dashboard-design.md`

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/M365-Assess/Common/Show-CheckProgress.ps1` | Full rewrite — synchronized state, mode detection, Spectre render loop, dual-mode Update/Complete/Close functions |
| Create | `src/M365-Assess/lib/Spectre.Console.dll` | Bundled DLL (extracted from NuGet) |
| Modify | `src/M365-Assess/Invoke-M365Assessment.ps1` | Pass TenantDomain+Version to `Initialize-CheckProgress`; call `Close-CheckProgress` after report generation |
| Modify | `tests/Common/Show-CheckProgress.Tests.ps1` | Update for new state fields; add mode detection + Spectre-mode tests |

`Invoke-DnsAuthentication.ps1` is **unchanged** — it already calls `Complete-CheckProgress` with no parameters, which continues to work.

---

## Task 1: Bundle Spectre.Console DLL

**Files:**
- Create: `src/M365-Assess/lib/.gitkeep` → then `src/M365-Assess/lib/Spectre.Console.dll`

- [ ] **Step 1: Download and extract DLL**

Write this to a temp file `_fetch_spectre.ps1`, run it, then delete it:

```powershell
$tmpDir  = Join-Path $env:TEMP 'spectre-fetch'
$nupkg   = Join-Path $tmpDir 'spectre.nupkg'
$extract = Join-Path $tmpDir 'pkg'
$libDir  = 'src/M365-Assess/lib'

New-Item -ItemType Directory -Path $tmpDir  -Force | Out-Null
New-Item -ItemType Directory -Path $libDir  -Force | Out-Null
New-Item -ItemType Directory -Path $extract -Force | Out-Null

Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Spectre.Console/0.49.1' `
    -OutFile $nupkg -UseBasicParsing

Rename-Item $nupkg "$nupkg.zip"
Expand-Archive "$nupkg.zip" -DestinationPath $extract -Force

$dll = Get-ChildItem -Path $extract -Recurse -Filter 'Spectre.Console.dll' |
    Where-Object { $_.FullName -match 'net6\.0' } |
    Select-Object -First 1

if (-not $dll) {
    # Fallback to netstandard2.0
    $dll = Get-ChildItem -Path $extract -Recurse -Filter 'Spectre.Console.dll' |
        Where-Object { $_.FullName -match 'netstandard2\.0' } |
        Select-Object -First 1
}

Copy-Item $dll.FullName "$libDir/Spectre.Console.dll" -Force
Write-Host "DLL copied from: $($dll.FullName)" -ForegroundColor Green
Remove-Item $tmpDir -Recurse -Force
```

Run: `pwsh -NoProfile -File ./_fetch_spectre.ps1`
Expected: `DLL copied from: ...net6.0\Spectre.Console.dll`
Then: `Remove-Item ./_fetch_spectre.ps1`

- [ ] **Step 2: Verify DLL loads in PS7**

```powershell
Add-Type -Path 'src/M365-Assess/lib/Spectre.Console.dll'
[Spectre.Console.AnsiConsole]::MarkupLine('[green]Spectre loaded OK[/]')
```

Run: `pwsh -NoProfile -Command "Add-Type -Path 'src/M365-Assess/lib/Spectre.Console.dll'; [Spectre.Console.AnsiConsole]::MarkupLine('[green]Spectre loaded OK[/]')"`
Expected: green `Spectre loaded OK` line

- [ ] **Step 3: Stage and commit**

```bash
git add src/M365-Assess/lib/Spectre.Console.dll
git commit -m "chore(deps): bundle Spectre.Console 0.49.1 DLL"
```

---

## Task 2: State Schema + Initialize-CheckProgress (mode detection)

**Files:**
- Modify: `src/M365-Assess/Common/Show-CheckProgress.ps1`
- Modify: `tests/Common/Show-CheckProgress.Tests.ps1`

`★ Insight ─────────────────────────────────────`
The key insight: `[hashtable]::Synchronized(@{})` wraps a plain hashtable with a `SyncRoot` monitor — every read and write acquires the lock automatically. It's safe for one writer (main thread) + one reader (background render). But nested objects like `[System.Collections.Generic.List[hashtable]]` inside the synchronized hashtable are NOT themselves synchronized — only top-level key access is. For our use case this is fine because the render thread only reads the Checks list (never modifies it), and only the main thread appends to it.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Add new parameters to Initialize-CheckProgress signature**

In `Show-CheckProgress.ps1`, add two optional parameters to `Initialize-CheckProgress` after the existing `[switch]$Silent`:

```powershell
[Parameter()]
[string]$TenantDomain = '',

[Parameter()]
[string]$Version = ''
```

- [ ] **Step 2: Replace $global:CheckProgressState with synchronized hashtable**

Replace the `$state = @{ ... }` block (lines ~152–172) with:

```powershell
$script:State = [hashtable]::Synchronized(@{
    # Existing keys (preserved for backward compat + test coverage)
    Completed        = 0
    Total            = $totalChecks
    CheckIds         = @{}
    CountedIds       = @{}
    CurrentCollector = ''
    CollectorCounts  = @{}
    CollectorDone    = @{}
    PrintedHeaders   = @{}
    LabelMap         = $script:CollectorLabelMap
    LicenseSkipped   = $licenseSkipped

    # New keys for Spectre mode
    Mode             = if ([Console]::IsOutputRedirected -or $env:CI) { 'Fallback' } else { 'Spectre' }
    Complete         = $false
    Closed           = $false
    StartTime        = [datetime]::Now
    TenantDomain     = $TenantDomain
    Version          = $Version
    Pass             = 0
    Fail             = 0
    Warn             = 0
    Skip             = 0
    Sections         = [System.Collections.Generic.List[hashtable]]::new()
    Checks           = [System.Collections.Generic.List[hashtable]]::new()
    OutputFiles      = @()
})
$global:CheckProgressState = $script:State
```

- [ ] **Step 3: Populate $state.Sections from ActiveSections**

After the `$checksByCollector` loop (after `$state.CollectorDone[$collectorName] = 0`), add:

```powershell
# Build ordered section list for the dashboard sidebar
$sectionOrder = @('Identity','Email','Security','Intune','Collaboration','PowerBI','DNS')
foreach ($sec in $sectionOrder) {
    if ($sec -in $ActiveSections) {
        $script:State.Sections.Add(@{ Name = $sec; Status = 'Pending' }) | Out-Null
    }
}
```

- [ ] **Step 4: Branch console output on Mode**

In `Initialize-CheckProgress`, wrap the existing `Write-Host` block (the "Status Legend" + "Security Checks: N queued" output) with:

```powershell
if ($script:State.Mode -eq 'Fallback') {
    # ... existing Write-Host block stays here, unchanged ...
    Write-Progress -Activity 'M365 Security Assessment' -Status "0 / $totalChecks checks complete" -PercentComplete 0 -Id 1
} else {
    # Spectre mode: clear screen and start background render loop
    [Console]::Clear()
    Invoke-SpectreRenderLoop   # defined in Task 4
}
```

- [ ] **Step 5: Update tests — verify new state fields are populated**

In `tests/Common/Show-CheckProgress.Tests.ps1`, add to the `'when active sections have automated checks'` context:

```powershell
It 'should set Mode to Fallback in CI' {
    # CI env is set in test runner — mode should always be Fallback in tests
    $global:CheckProgressState.Mode | Should -Be 'Fallback'
}

It 'should initialize Pass/Fail/Warn/Skip counters to zero' {
    $global:CheckProgressState.Pass | Should -Be 0
    $global:CheckProgressState.Fail | Should -Be 0
    $global:CheckProgressState.Warn | Should -Be 0
    $global:CheckProgressState.Skip | Should -Be 0
}

It 'should initialize Checks as an empty list' {
    $global:CheckProgressState.Checks | Should -BeOfType ([System.Collections.Generic.List[hashtable]])
    $global:CheckProgressState.Checks.Count | Should -Be 0
}

It 'should set Complete to false' {
    $global:CheckProgressState.Complete | Should -Be $false
}
```

- [ ] **Step 6: Run tests to verify all pass**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: all existing tests pass + 4 new tests pass

- [ ] **Step 7: Commit**

```bash
git add src/M365-Assess/Common/Show-CheckProgress.ps1 tests/Common/Show-CheckProgress.Tests.ps1
git commit -m "feat(progress): synchronized state schema + mode detection"
```

---

## Task 3: Update-CheckProgress and Update-ProgressStatus — Spectre mode

**Files:**
- Modify: `src/M365-Assess/Common/Show-CheckProgress.ps1`
- Modify: `tests/Common/Show-CheckProgress.Tests.ps1`

- [ ] **Step 1: Write failing test for Spectre-mode state accumulation**

Add a new `Describe 'Update-CheckProgress in Spectre mode'` block to the test file:

```powershell
Describe 'Update-CheckProgress Spectre mode state' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host { }
        Mock Write-Progress { }
        Mock Invoke-SpectreRenderLoop { }   # stub — don't start a real runspace

        $registry = @{
            'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
            'ENTRA-ADMIN-002' = @{ checkId = 'ENTRA-ADMIN-002'; hasAutomatedCheck = $true; collector = 'Entra' }
        }
        # Force Spectre mode by temporarily clearing CI env
        $savedCI = $env:CI
        $env:CI = $null
        $savedRedir = [Console]::IsOutputRedirected  # note: can't override this
        Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity')
        $env:CI = $savedCI
        # Override mode for testing (CI env sets it to Fallback; force Spectre here)
        $global:CheckProgressState.Mode = 'Spectre'
    }

    It 'should append to state.Checks list in Spectre mode' {
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-001' -Setting 'Global Admin Count' -Status 'Pass'
        $global:CheckProgressState.Checks.Count | Should -Be 1
    }

    It 'should increment Pass counter' {
        $global:CheckProgressState.Pass | Should -Be 1
    }

    It 'should increment Fail counter on Fail status' {
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-002' -Setting 'Another Check' -Status 'Fail'
        $global:CheckProgressState.Fail | Should -Be 1
    }

    It 'should NOT call Write-Host in Spectre mode' {
        Should -Invoke Write-Host -Times 0 -Scope It
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: the 4 new `Describe 'Update-CheckProgress Spectre mode state'` tests fail

- [ ] **Step 3: Implement Spectre-mode branch in Update-CheckProgress**

In `Show-CheckProgress.ps1`, inside `Update-CheckProgress`, after the existing `$isFirstOccurrence` block (around line 235), add a branch. The full logic after the base-checkId extraction becomes:

```powershell
$isFirstOccurrence = -not $state.CountedIds.ContainsKey($baseCheckId)
if ($isFirstOccurrence) {
    $state.CountedIds[$baseCheckId] = $true
    $state.Completed++
    $state.CollectorDone[$collectorName]++
}

# Always append to Checks list (for Spectre stream display)
$state.Checks.Add(@{
    CheckId = $CheckId
    Setting = $Setting
    Status  = $Status
}) | Out-Null

# Update pass/fail/warn/skip counters (only on first occurrence)
if ($isFirstOccurrence) {
    switch ($Status) {
        'Pass'    { $state.Pass++ }
        'Fail'    { $state.Fail++ }
        'Warning' { $state.Warn++ }
        'Review'  { $state.Warn++ }
        'Skipped' { $state.Skip++ }
    }
}

if ($state.Mode -eq 'Spectre') {
    # Dashboard renders from $state.Checks — no console output needed
    return
}

# Fallback path: existing Write-Host + Write-Progress logic continues below
```

The rest of `Update-CheckProgress` (the `Write-Host` lines + `Write-Progress`) is the existing Fallback path — leave it unchanged after the new `return`.

Also update `Update-ProgressStatus` to track section transitions:

```powershell
function global:Update-ProgressStatus {
    param([string]$Message)

    $state = $global:CheckProgressState
    if (-not $state -or $state.Total -eq 0) { return }

    # Update current section for dashboard sidebar highlighting
    if ($script:CollectorSectionMap.ContainsKey($Message)) {
        $sec = $script:CollectorSectionMap[$Message]
        $state.CurrentSection = $sec
        $state.CurrentCollector = if ($script:CollectorLabelMap[$Message]) { $script:CollectorLabelMap[$Message] } else { $Message }

        # Mark previous section(s) complete, mark current as Running
        foreach ($s in $state.Sections) {
            if ($s.Name -eq $sec) {
                $s.Status = 'Running'
            } elseif ($s.Status -eq 'Running') {
                $s.Status = 'Complete'
            }
        }
    }

    if ($state.Mode -eq 'Spectre') { return }

    # Fallback: existing Write-Progress call
    $pct = if ($state.Total -gt 0) { [math]::Round(($state.Completed / $state.Total) * 100) } else { 0 }
    Write-Progress -Activity 'M365 Security Assessment' -Status $Message -PercentComplete $pct -Id 1 -CurrentOperation "$($state.Completed) / $($state.Total) checks"
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: all tests pass including the 4 new Spectre mode tests

- [ ] **Step 5: Commit**

```bash
git add src/M365-Assess/Common/Show-CheckProgress.ps1 tests/Common/Show-CheckProgress.Tests.ps1
git commit -m "feat(progress): dual-mode Update-CheckProgress (Spectre state accumulation)"
```

---

## Task 4: Invoke-SpectreRenderLoop — Background Runspace

**Files:**
- Modify: `src/M365-Assess/Common/Show-CheckProgress.ps1`

This task creates the private `Invoke-SpectreRenderLoop` function that starts the background PS runspace and launches the Spectre Live display. The actual render logic (table construction) is in Task 5 — this task wires up the infrastructure.

- [ ] **Step 1: Add Invoke-SpectreRenderLoop function to Show-CheckProgress.ps1**

Add this private function before `Initialize-CheckProgress`:

```powershell
function Invoke-SpectreRenderLoop {
    # Capture script-level values needed inside the runspace (PSScriptRoot not available there)
    $libPath       = Join-Path -Path $PSScriptRoot -ChildPath '..\lib\Spectre.Console.dll'
    $capturedState = $script:State

    $script:BackgroundPs = [System.Management.Automation.PowerShell]::Create()
    $script:BackgroundPs.AddScript({
        param($state, $libPath)

        # Load Spectre inside the runspace
        Add-Type -Path $libPath -ErrorAction Stop

        # ── Build-Dashboard: constructs the Spectre renderable each tick ──
        # (Defined inline here because the runspace has no access to the outer scope)
        function Build-Dashboard {
            param($s)

            $elapsed = ([datetime]::Now - $s.StartTime).ToString('mm\:ss')
            $pct     = if ($s.Total -gt 0) { [int]($s.Completed / $s.Total * 100) } else { 0 }

            # Header title text
            $status   = if ($s.Complete) { '[green] COMPLETE [/]' } else { '[blue]running[/]' }
            $titleText = "[bold blue]M365 Security Assessment[/]  [grey]$($s.TenantDomain) · v$($s.Version) · $elapsed · $status[/]"

            # ── Metrics strip (5-cell table) ──
            $metrics = [Spectre.Console.Table]::new()
            $metrics.Border = [Spectre.Console.TableBorder]::None
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]CHECKS[/]'))   | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]PASS[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]FAIL[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]WARN[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]SKIP[/]'))     | Out-Null
            $checksLabel = "[bold blue]$($s.Completed)[/][grey]/$($s.Total)[/]"
            $metrics.AddRow(
                $checksLabel,
                "[bold green]$($s.Pass)[/]",
                "[bold red]$($s.Fail)[/]",
                "[bold yellow]$($s.Warn)[/]",
                "[grey]$($s.Skip)[/]"
            ) | Out-Null

            # ── Section list (left sidebar) ──
            $secLines = foreach ($sec in $s.Sections) {
                switch ($sec.Status) {
                    'Complete' { "[green]✓ $($sec.Name.PadRight(14))[/]" }
                    'Running'  { "[yellow]▶ $($sec.Name.PadRight(14))[/]" }
                    default    { "[grey]○ $($sec.Name.PadRight(14))[/]" }
                }
            }
            $secBlock = if ($secLines.Count -gt 0) { $secLines -join "`n" } else { '[grey](none)[/]' }

            # ── Live check stream (right panel, last 20 checks) ──
            $recentChecks = if ($s.Checks.Count -gt 20) {
                $tmp = [System.Collections.Generic.List[hashtable]]::new($s.Checks)
                $tmp.GetRange($tmp.Count - 20, 20)
            } else { $s.Checks }

            $checkLines = foreach ($c in $recentChecks) {
                $icon  = switch ($c.Status) { 'Pass' { '[green]✓[/]' } 'Fail' { '[red]✗[/]' } 'Warning' { '[yellow]![/]' } 'Review' { '[cyan]?[/]' } default { '[grey]·[/]' } }
                $name  = if ($c.Setting.Length -gt 42) { $c.Setting.Substring(0,39) + '...' } else { $c.Setting }
                $idStr = ('[grey]' + $c.CheckId.ToString().PadRight(26) + '[/]')
                "$icon $idStr $name"
            }

            # Show output files on completion
            if ($s.Complete -and $s.OutputFiles.Count -gt 0) {
                $checkLines += ''
                $checkLines += '[grey]Output:[/]'
                foreach ($f in $s.OutputFiles) {
                    $checkLines += "  [blue]$f[/]"
                }
            }

            $checkBlock = if ($checkLines.Count -gt 0) {
                "[grey]$($s.CurrentCollector)[/]`n" + ($checkLines -join "`n")
            } else { '[grey]Waiting for checks...[/]' }

            # ── Body: two-column table ──
            $body = [Spectre.Console.Table]::new()
            $body.Border = [Spectre.Console.TableBorder]::Simple
            $body.AddColumn([Spectre.Console.TableColumn]::new('[grey]SECTIONS[/]').Width(18)) | Out-Null
            $body.AddColumn([Spectre.Console.TableColumn]::new('[grey]LIVE CHECKS[/]'))        | Out-Null
            $body.HideHeaders() | Out-Null
            $body.AddRow(
                [Spectre.Console.Markup]::new($secBlock),
                [Spectre.Console.Markup]::new($checkBlock)
            ) | Out-Null

            # ── Progress bar footer ──
            $filled  = [int]($pct / 100 * 40)
            $empty   = 40 - $filled
            $barFill = '█' * $filled
            $barVoid = '░' * $empty
            $nextSec = ''
            $secList = @($s.Sections)
            for ($i = 0; $i -lt $secList.Count; $i++) {
                if ($secList[$i].Status -eq 'Running' -and ($i + 1) -lt $secList.Count) {
                    $nextSec = " · next: $($secList[$i+1].Name)"
                    break
                }
            }
            $keyHint = if ($s.Complete) { '  [grey]press any key to exit[/]' } else { '' }
            $footer  = "[blue]$barFill[/][grey]$barVoid[/]  [white]$pct%[/]  $($s.CurrentSection)$nextSec$keyHint"

            # ── Outer panel ──
            $outerGrid = [Spectre.Console.Grid]::new()
            $outerGrid.AddColumn() | Out-Null
            $outerGrid.AddRow($metrics)                                    | Out-Null
            $outerGrid.AddRow($body)                                       | Out-Null
            $outerGrid.AddRow([Spectre.Console.Markup]::new($footer))     | Out-Null

            $panel = [Spectre.Console.Panel]::new($outerGrid)
            $panel.Header = [Spectre.Console.PanelHeader]::new($titleText)
            $panel.Border = [Spectre.Console.BoxBorder]::Rounded
            return $panel
        }

        # ── Live display loop ──
        $initial = [Spectre.Console.Markup]::new('[grey]Initializing...[/]')
        $live    = [Spectre.Console.AnsiConsole]::Live($initial)
        $live.AutoClear = $false

        $live.Start([Action[Spectre.Console.LiveDisplayContext]]{
            param([Spectre.Console.LiveDisplayContext]$ctx)
            while (-not $state.Complete) {
                try { $ctx.UpdateTarget((Build-Dashboard $state)) } catch {}
                Start-Sleep -Milliseconds 100
            }
            # Final render with completion screen (shows output files + key hint)
            try { $ctx.UpdateTarget((Build-Dashboard $state)) } catch {}
            # Block inside the Live context until keypress — main thread blocks on EndInvoke
            [Console]::ReadKey($true) | Out-Null
        })

    }) | Out-Null

    $script:BackgroundPs.AddParameter('state',   $capturedState) | Out-Null
    $script:BackgroundPs.AddParameter('libPath', $libPath)       | Out-Null

    $script:BackgroundJob = $script:BackgroundPs.BeginInvoke()
}
```

- [ ] **Step 2: Add $script:BackgroundPs and $script:BackgroundJob declarations at top of file**

At the top of `Show-CheckProgress.ps1` (after the comment header block), add:

```powershell
$script:BackgroundPs  = $null
$script:BackgroundJob = $null
$script:State         = $null
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: all tests pass (Invoke-SpectreRenderLoop is mocked in Spectre mode tests from Task 3; existing tests run in Fallback mode)

- [ ] **Step 4: Commit**

```bash
git add src/M365-Assess/Common/Show-CheckProgress.ps1
git commit -m "feat(progress): Spectre render loop + Build-Dashboard function"
```

---

## Task 5: Complete-CheckProgress and Close-CheckProgress

**Files:**
- Modify: `src/M365-Assess/Common/Show-CheckProgress.ps1`
- Modify: `tests/Common/Show-CheckProgress.Tests.ps1`

- [ ] **Step 1: Write failing tests**

Add to `tests/Common/Show-CheckProgress.Tests.ps1`:

```powershell
Describe 'Complete-CheckProgress' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host    { }
        Mock Write-Progress { }
        Mock Invoke-SpectreRenderLoop { }

        $registry = @{
            'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
        }
        Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity')
    }

    It 'should set state.Complete to true' {
        Complete-CheckProgress
        $global:CheckProgressState.Complete | Should -Be $true
    }
}

Describe 'Close-CheckProgress' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host    { }
        Mock Write-Progress { }
        Mock Invoke-SpectreRenderLoop { }

        $registry = @{
            'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
        }
        Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity')
        Complete-CheckProgress
    }

    It 'should store OutputFiles in state' {
        Close-CheckProgress -OutputFiles @('C:\Assessments\report.html', 'C:\Assessments\matrix.xlsx')
        $global:CheckProgressState.OutputFiles.Count | Should -Be 2
        $global:CheckProgressState.OutputFiles[0] | Should -Be 'C:\Assessments\report.html'
    }

    It 'should clean up global state after close' {
        $global:CheckProgressState | Should -BeNullOrEmpty
    }
}
```

- [ ] **Step 2: Run test to verify they fail**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: `Complete-CheckProgress should set state.Complete` fails; `Close-CheckProgress` tests fail (`Close-CheckProgress` not yet defined)

- [ ] **Step 3: Rewrite Complete-CheckProgress**

Replace the existing `Complete-CheckProgress` function body in `Show-CheckProgress.ps1`:

```powershell
function Complete-CheckProgress {
    [CmdletBinding()]
    param()

    $state = $script:State
    if (-not $state) { return }

    $state.Complete = $true

    # Mark the last section as Complete
    foreach ($s in $state.Sections) {
        if ($s.Status -eq 'Running') { $s.Status = 'Complete' }
    }

    if ($state.Mode -eq 'Fallback') {
        if ($state.Total -gt 0) {
            Write-Progress -Activity 'M365 Security Assessment' -Completed -Id 1
            Write-Host ''
            Write-Host "  $([char]0x2713) All $($state.Total) security checks complete" -ForegroundColor Green
            Write-Host ''
        }
    }
    # Spectre mode: render loop sees Complete=true and transitions to completion screen;
    # main thread continues normally until Close-CheckProgress is called.
}
```

- [ ] **Step 4: Add Close-CheckProgress function**

Add this new function immediately after `Complete-CheckProgress` in `Show-CheckProgress.ps1`:

```powershell
function Close-CheckProgress {
    <#
    .SYNOPSIS
        Finalizes the progress display with output file paths, waits for keypress
        (Spectre mode), then cleans up.
    .PARAMETER OutputFiles
        Array of absolute paths to generated output files (HTML, XLSX, etc.).
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string[]]$OutputFiles = @()
    )

    $state = $script:State
    if (-not $state) { return }

    $state.OutputFiles = $OutputFiles

    if ($state.Mode -eq 'Spectre' -and $script:BackgroundPs) {
        try {
            # Blocks here until the background runspace's ReadKey returns (user presses key)
            $script:BackgroundPs.EndInvoke($script:BackgroundJob)
        }
        catch {
            Write-Verbose "Spectre render loop error: $_"
        }
        finally {
            $script:BackgroundPs.Dispose()
            $script:BackgroundPs  = $null
            $script:BackgroundJob = $null
        }
    }
    elseif ($state.Mode -eq 'Fallback') {
        # Compact text summary for CI / non-interactive runs
        Write-Host ''
        Write-Host "  Results: $($state.Pass) pass  $($state.Fail) fail  $($state.Warn) warn  $($state.Skip) skip" -ForegroundColor Cyan
        if ($OutputFiles.Count -gt 0) {
            Write-Host '  Output:' -ForegroundColor White
            foreach ($f in $OutputFiles) {
                Write-Host "    $f" -ForegroundColor Cyan
            }
        }
        Write-Host ''
    }

    # Clean up globals
    Remove-Item -Path 'Function:\Update-CheckProgress'  -ErrorAction SilentlyContinue
    Remove-Item -Path 'Function:\Update-ProgressStatus' -ErrorAction SilentlyContinue
    Remove-Variable -Name CheckProgressState -Scope Global -ErrorAction SilentlyContinue
    $script:State = $null
}
```

- [ ] **Step 5: Update existing Complete-CheckProgress cleanup test**

The existing test `'should clean up global state'` was for `Complete-CheckProgress`. Move cleanup responsibility to `Close-CheckProgress` — update the test:

```powershell
# In the existing 'Complete-CheckProgress' describe block, REMOVE the cleanup test.
# The cleanup now happens in Close-CheckProgress (tested in the new describe block above).
```

- [ ] **Step 6: Run tests**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Show-CheckProgress.Tests.ps1' -Output Detailed"
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/M365-Assess/Common/Show-CheckProgress.ps1 tests/Common/Show-CheckProgress.Tests.ps1
git commit -m "feat(progress): Complete-CheckProgress (state flag) + Close-CheckProgress (freeze + cleanup)"
```

---

## Task 6: Wire Orchestrator — TenantDomain, Version, and Close-CheckProgress

**Files:**
- Modify: `src/M365-Assess/Invoke-M365Assessment.ps1`

- [ ] **Step 1: Add TenantDomain and Version to Initialize-CheckProgress call**

In `Invoke-M365Assessment.ps1`, find the `$progressParams` hashtable (around line 638):

```powershell
$progressParams = @{
    ControlRegistry = $progressRegistry
    ActiveSections  = $Section
}
```

Change to:

```powershell
$progressParams = @{
    ControlRegistry = $progressRegistry
    ActiveSections  = $Section
    TenantDomain    = if ($script:domainPrefix) { $script:domainPrefix } elseif ($TenantId) { $TenantId } else { 'Unknown' }
    Version         = $script:AssessmentVersion
}
```

- [ ] **Step 2: Add Close-CheckProgress call after report generation**

In `Invoke-M365Assessment.ps1`, find the HTML report generation block (around line 1260). It ends with:

```powershell
    catch {
        Write-AssessmentLog -Level WARN -Message "HTML report generation failed: $($_.Exception.Message)"
    }
}
```

After this closing `}`, add:

```powershell
# ── Close the TUI dashboard (Spectre: freeze+keypress; Fallback: compact summary) ──
if (Get-Command -Name Close-CheckProgress -ErrorAction SilentlyContinue) {
    $reportSuffix  = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
    $htmlFilePath  = Join-Path -Path $assessmentFolder -ChildPath "_Assessment-Report${reportSuffix}.html"
    $xlsxFilePath  = Join-Path -Path $assessmentFolder -ChildPath "_Compliance-Matrix${reportSuffix}.xlsx"
    $outputFileList = @($htmlFilePath, $xlsxFilePath) | Where-Object { Test-Path -Path $_ }
    Close-CheckProgress -OutputFiles $outputFileList
}
```

- [ ] **Step 3: Verify syntax with PSScriptAnalyzer**

Write and run `_tmp_lint.ps1`:

```powershell
$results = Invoke-ScriptAnalyzer -Path 'src/M365-Assess/Invoke-M365Assessment.ps1' -Severity Warning
if ($results.Count -gt 0) {
    $results | Format-Table RuleName, Message, Line -AutoSize
} else {
    Write-Host 'No warnings' -ForegroundColor Green
}
```

Run: `pwsh -NoProfile -File ./_tmp_lint.ps1 && Remove-Item ./_tmp_lint.ps1`
Expected: `No warnings` (or existing pre-existing warnings only — no new ones)

- [ ] **Step 4: Commit**

```bash
git add src/M365-Assess/Invoke-M365Assessment.ps1
git commit -m "feat(progress): wire TUI dashboard into orchestrator (domain, version, close)"
```

---

## Task 7: Full Test Suite + Manual Smoke Test

**Files:**
- Modify: `tests/Common/Show-CheckProgress.Tests.ps1`

- [ ] **Step 1: Run full test suite to verify no regressions**

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests' -Output Detailed"
```

Expected: 1,816+ tests pass, 0 failures, coverage ≥ 65%

- [ ] **Step 2: Manual smoke test — Spectre mode**

With a live tenant connected, run a single-section assessment:

```powershell
# In an interactive PS7 terminal (NOT CI, NOT redirected)
Import-Module ./src/M365-Assess/ -Force
Invoke-M365Assessment -Section @('Security') -TenantId <your-test-tenant>
```

Verify:
1. Screen clears, Spectre dashboard appears full-screen
2. Metrics strip shows CHECKS/PASS/FAIL/WARN/SKIP updating in real time
3. Security section marked ▶ yellow in sidebar, then ✓ green when done
4. Live check stream scrolls on the right as checks complete
5. Progress bar advances and reaches 100%
6. Completion screen shows output file paths and "press any key to exit" hint
7. After keypress: dashboard clears, `Show-AssessmentSummary` text prints normally

- [ ] **Step 3: Manual smoke test — Fallback mode**

Verify CI path is unchanged:

```bash
pwsh -NoProfile -Command "
    \$env:CI = '1'
    . src/M365-Assess/Common/Show-CheckProgress.ps1
    \$reg = @{ 'ENTRA-001' = @{ checkId = 'ENTRA-001'; hasAutomatedCheck = \$true; collector = 'Entra' } }
    Initialize-CheckProgress -ControlRegistry \$reg -ActiveSections @('Identity')
    Update-CheckProgress -CheckId 'ENTRA-001' -Setting 'Test Setting' -Status 'Pass'
    Complete-CheckProgress
    Close-CheckProgress -OutputFiles @('C:\tmp\test.html')
"
```

Expected: Write-Progress called (or no-op since total=1), green "All 1 security checks complete" line, compact text summary with `C:\tmp\test.html` path

- [ ] **Step 4: Commit**

```bash
git add tests/Common/Show-CheckProgress.Tests.ps1
git commit -m "test(progress): full coverage sweep for TUI dashboard"
```

---

## Task 8: PR

- [ ] **Step 1: Push branch and create PR**

```bash
git push origin <branch-name>
gh pr create \
  --title "feat(progress): Spectre.Console full-screen TUI dashboard" \
  --body "$(cat <<'EOF'
## Summary
- Replaces Write-Progress with Spectre.Console full-screen live dashboard
- Synchronized hashtable bridges main thread (collectors) to background render runspace
- CI/non-interactive environments automatically fall back to existing Write-Progress path
- Close-CheckProgress blocks until keypress (Spectre mode) then returns prompt
- Show-AssessmentSummary text prints normally after dashboard clears

## Test plan
- [ ] Full Pester suite passes (1,816+ tests, ≥65% coverage)
- [ ] Spectre dashboard renders correctly in Windows Terminal PS7
- [ ] CI fallback path unchanged (Write-Progress, compact summary)
- [ ] Completion screen shows output file paths
- [ ] Keypress dismisses dashboard cleanly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Known Limitations (v1)

- Other orchestrator `Write-Host` output (connection messages, section headers) may scroll above the Spectre panel. A future enhancement can suppress it by routing through a buffered queue.
- `Invoke-SpectreRenderLoop` is not unit-tested (it requires a real terminal + Spectre DLL). Manual smoke test is the only verification.
- Non-Windows terminal compatibility (Linux/macOS) is best-effort — Spectre targets Windows Terminal as primary.
