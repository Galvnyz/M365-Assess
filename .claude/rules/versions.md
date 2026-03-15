# Version Management Reference

> **Version is centralized in `M365-Assess.psd1`.** Runtime scripts read from the manifest
> via `Import-PowerShellDataFile`. No `.NOTES Version:` lines in individual scripts.

## Assessment Suite Version

Current: **0.9.3**

### Version Locations (3 total)

| # | File | Location | Type |
|---|------|----------|------|
| 1 | `M365-Assess.psd1` | `ModuleVersion = '...'` + `ReleaseNotes` | **Single source of truth** |
| 2 | `README.md` | Shield badge URL `version-X.Y.Z-blue` | Display |
| 3 | `CHANGELOG.md` | Add new version section with changes | Documentation |

### Runtime Readers (no manual update needed)

These files read the version from the manifest at runtime. They do NOT contain hardcoded version strings:

| File | How it reads version |
|------|---------------------|
| `Invoke-M365Assessment.ps1` | `Import-PowerShellDataFile "$projectRoot/M365-Assess.psd1"` |
| `Common/Export-AssessmentReport.ps1` | `Import-PowerShellDataFile "$PSScriptRoot/../M365-Assess.psd1"` (fallback; prefers log header) |

### Documentation (update when counts change)

| File | What to update |
|------|----------------|
| `README.md` | Registry counts comment in project structure section |
| `docs/CheckId-Guide.md` | Automated/manual/total counts table |

### Version Bump Checklist

1. Update `ModuleVersion` and `ReleaseNotes` in `M365-Assess.psd1`
2. Update README badge: `version-X.Y.Z-blue`
3. Add CHANGELOG section
4. Commit and tag

**Verification:**
```powershell
$v = (Import-PowerShellDataFile -Path ./M365-Assess.psd1).ModuleVersion
Write-Host "Manifest: $v"
Select-String -Path README.md -Pattern "version-$v-blue" | ForEach-Object { Write-Host "README: OK" }
```

## CIS Benchmark Version

Current: **v6.0.1** (140 total controls)

When CIS publishes a new benchmark version, update:

| # | File | What to change |
|---|------|----------------|
| 1 | `Common/Export-AssessmentReport.ps1` | `$cisBenchmarkTotal = 140` comment + all 4 HTML strings referencing `v6.0.1` |
| 2 | `tests/Common/Export-AssessmentReport.Tests.ps1` | Assertion matching `v6.0.1` |
| 3 | 5 x Security Config collectors (`.NOTES` block) | `CIS ... Benchmark vX.Y.Z recommendations` |
| 4 | `README.md` | CIS Compliance Summary bullet (~line 176) |

**Quick grep to verify consistency:**
```powershell
Select-String -Path *.ps1,**/*.ps1,README.md -Pattern 'Benchmark v\d+\.\d+\.\d+' | Sort-Object Path
```

## Legacy / Deprecated

| File | Version | Notes |
|------|---------|-------|
| `M365-Assessment/CIS_M365_v310_Audit.ps1` | 2.0.0 (CIS v3.1.0) | **Deprecated** -- superseded by assessment suite CIS v6.0.1 collectors. Retained for reference only. |
| `controls/Build-Registry.ps1` | 1.0.0 | Independent version -- not part of suite version bumps. |
