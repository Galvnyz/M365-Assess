# TUI Dashboard Design — M365-Assess

**Date:** 2026-04-19  
**Status:** Approved  
**Scope:** Replace `Write-Progress` in `Show-CheckProgress.ps1` with a Spectre.Console full-screen live dashboard

---

## Goal

Replace the native `Write-Progress` bar with a full-screen terminal dashboard that shows real-time check results, section progress, and live metrics while the assessment runs — without blocking the synchronous collector pipeline or affecting CI.

---

## Style & Layout

**Style:** GitHub Dark (dark `#0d1117` background, blue accent `#58a6ff`, green/red/amber for pass/fail/warn, monospace font)

**Mode:** Full-screen — dashboard takes the entire terminal for the duration of the assessment.

**Layout A — Metrics strip + sidebar + log:**

```
┌─ M365 Security Assessment ──────────────── contoso.com · v2.0.0 · 3m 42s ─┐
│ CHECKS    PASS    FAIL    WARN    SKIP                                       │
│  115/240   89      26      8       3                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ SECTIONS          │ LIVE CHECKS · Defender Security Config · 12/19          │
│ ✓ Identity        │ ✓ DEFENDER-ANTIPHISH-001  Standard Preset Active        │
│ ✓ Email           │ ✓ DEFENDER-ANTISPAM-001   Spam Filter Enabled           │
│ ▶ Security        │ ✗ DEFENDER-SAFELINKS-001  Policy Not Configured         │
│ ○ Intune          │ ! DEFENDER-ZAP-001        ZAP for Teams                 │
│ ○ Collab          │ ✓ DEFENDER-SAFEATT-001    SPO/OD/Teams Protected        │
│ ○ DNS             │                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ ████████████████░░░░░░░░  48%  ·  Security  ·  next: Intune                │
└─────────────────────────────────────────────────────────────────────────────┘
```

Panels (top to bottom):
1. **Header bar** — tool name, tenant domain, version, elapsed time
2. **Metrics strip** — 5-cell grid: CHECKS (n/total), PASS, FAIL, WARN, SKIP
3. **Body** — two-column: section list (left, ~18 chars wide) + live check stream (right, scrolling)
4. **Progress footer** — gradient fill bar, percent, current section, next section

---

## Completion Behavior

**A — Freeze on completion screen:** When all checks complete, the dashboard transitions to a final state: all sections green, bar at 100%, output file paths shown. Stays on screen until any keypress. Then clears and returns the prompt.

**NonInteractive fallback:** When `[Console]::IsOutputRedirected -or $env:CI`, skip Spectre entirely and emit a compact stdout summary at the end instead.

---

## Architecture

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `Show-CheckProgress.ps1` | `Common/` | All progress functions; manages shared state + Spectre lifecycle |
| `SecurityConfigHelper.ps1` | `Common/` | `Add-Setting` calls `Update-CheckProgress` (unchanged call site) |
| `Invoke-M365Assessment.ps1` | root | No changes needed — orchestrator already calls progress functions |

### New dependencies
- `Spectre.Console` NuGet package (loaded via `Add-Type` from a bundled DLL or installed via `Install-Package`)
- No new PS module requirements

### Functions (all in `Show-CheckProgress.ps1`)

| Function | Change |
|----------|--------|
| `Initialize-CheckProgress` | Creates shared state, starts background runspace (Spectre mode) or sets fallback flag |
| `Update-CheckProgress` | Writes check result into shared state hashtable; no `Write-Progress` call in Spectre mode |
| `Update-ProgressStatus` | Updates current section/collector name in shared state |
| `Complete-CheckProgress` | Sets `$script:State.Complete = $true` + output file paths; waits for keypress in Spectre mode |
| `Invoke-SpectreRenderLoop` | New private function — Spectre `AnsiConsole.Live()` render loop, runs in background runspace |

---

## Data Flow

### Shared state bridge

The main thread and background runspace cannot share `$global:` variables (each runspace has its own session state). The bridge is a `[hashtable]::Synchronized(@{})` stored as `$script:State` in `Show-CheckProgress.ps1`. It is passed by reference into the background runspace via `$using:` scope.

```
Main thread (collectors)                   Background runspace (Spectre)
──────────────────────────                 ──────────────────────────────
Initialize-CheckProgress                   $ps = [PowerShell]::Create()
  → creates $script:State                  $ps.AddScript({
  → starts background runspace               param($state)
                                              AnsiConsole.Live(...).Start({
Add-Setting / Update-CheckProgress               while (!$state.Complete) {
  → $script:State.Checks.Add(...)                  # read $state, render frame
  → $script:State.Progress.Fail++                  Start-Sleep -Milliseconds 100
                                                }
Complete-CheckProgress                         })
  → $script:State.Complete = $true         })
  → $script:State.OutputFiles = ...        $ps.AddParameter('state', $script:State)
  → waits for keypress                     $ps.BeginInvoke()
  → background loop exits
```

### State schema

```powershell
$script:State = [hashtable]::Synchronized(@{
    Mode          = 'Spectre'          # or 'Fallback'
    Complete      = $false
    StartTime     = [datetime]::Now
    Sections      = [System.Collections.Generic.List[hashtable]]::new()
    CurrentSection = ''
    CurrentCollector = ''
    Checks        = [System.Collections.Generic.List[hashtable]]::new()
    Progress      = @{ Total=0; Complete=0; Pass=0; Fail=0; Warn=0; Skip=0 }
    OutputFiles   = @()
    TenantDomain  = ''
    Version       = ''
})
```

The render loop reads a snapshot each tick (~100ms). It does not write back to the state.

---

## Non-Interactive Fallback

```powershell
Initialize-CheckProgress
  → if ([Console]::IsOutputRedirected -or $env:CI) {
        $script:State.Mode = 'Fallback'   # Write-Progress + stdout summary
    } else {
        $script:State.Mode = 'Spectre'    # full TUI, background runspace
    }
```

In `Fallback` mode:
- `Update-CheckProgress` calls `Write-Progress` as today
- `Complete-CheckProgress` writes a compact plaintext summary (total/pass/fail/warn + output paths) to stdout and returns immediately (no keypress wait)
- No background runspace is started
- CI output is identical to the current behavior

---

## Error Handling

- If Spectre DLL load fails (`Add-Type` throws), `Initialize-CheckProgress` catches and falls back to `Fallback` mode with a `Write-Warning`
- If the background runspace throws, the main assessment thread is unaffected (fire-and-forget via `BeginInvoke`)
- `Complete-CheckProgress` includes a `$ps.Stop()` + `$ps.Dispose()` cleanup block in a `finally`

---

## Testing

- Existing Pester tests for `Show-CheckProgress.ps1` target the `Fallback` path — they run in CI where `$env:CI` is set, so no Spectre dependency required in test runs
- New tests: `Initialize-CheckProgress` in mock-Spectre mode (verify state schema populated), `Complete-CheckProgress` sets `Complete = $true` + populates `OutputFiles`
- Manual verification: run a single-section assessment in Windows Terminal (PS7) and confirm dashboard renders, check stream scrolls, bar advances, freeze-on-completion works

---

## Out of Scope

- Custom color themes / user configuration
- Mouse support
- Exporting the TUI session as a recording
- Non-Windows terminal compatibility (Linux/macOS tested as best-effort only)
