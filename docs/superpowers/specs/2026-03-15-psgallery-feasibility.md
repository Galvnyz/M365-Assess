# PSGallery Packaging Feasibility Report

**Issue:** #120
**Date:** 2026-03-15
**Author:** Research pass (no code changes made)

---

## PSGallery Feasibility Report

**Verdict: Major restructuring needed**

---

## Current State

### What Works Today

- **Manifest (`M365-Assess.psd1`) has all required PSGallery fields:** `ModuleVersion`, `GUID`, `Author`, `Description`, `Tags`, `LicenseUri`, `ProjectUri`, `ReleaseNotes`, `PowerShellVersion`. PSGallery would accept this manifest as-is for `Publish-Module`.
- **`FileList` is comprehensive:** 55+ files enumerated across all domain folders. PSGallery would package all of them.
- **`RequiredModules` is populated:** Three Graph SDK modules at 2.25.0+ are declared, so `Install-Module M365-Assess` would pull dependencies automatically.
- **Intra-`Common/` references use `$PSScriptRoot`:** `Export-AssessmentReport.ps1` dot-sources `Import-ControlRegistry.ps1` via `Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1'` — this is module-installation-safe.
- **Asset files use `$PSScriptRoot` for sibling paths:** `assets/Update-SkuCsv.ps1` and `Entra/Get-LicenseReport.ps1` reference assets via `$PSScriptRoot/../assets/...` relative to their own location, which would survive `Install-Module` as long as the folder structure is preserved.

---

### What Would Break

#### 1. `$PSCommandPath`-based root resolution (critical blocker)

`Invoke-M365Assessment.ps1` (the `RootModule`) uses:

```powershell
$projectRoot = Split-Path -Parent $PSCommandPath
```

When PowerShell loads a script as a `RootModule`, `$PSCommandPath` is the path to the `.ps1` file inside the module directory (e.g., `C:\Users\user\Documents\PowerShell\Modules\M365-Assess\0.9.3\Invoke-M365Assessment.ps1`). `Split-Path -Parent` of that is the module version folder — which is correct. **This part would actually work.**

However, all collector scripts are referenced via relative string paths joined to `$projectRoot`:

```powershell
$scriptPath = Join-Path -Path $projectRoot -ChildPath $collector.Script
# e.g., Join-Path ... 'Entra\Get-TenantInfo.ps1'
```

This works only if the `Entra\`, `Security\`, `Common\`, etc. subfolders exist at the same level as `Invoke-M365Assessment.ps1`. PSGallery's `Install-Module` preserves this layout (everything in `FileList` lands in the versioned module folder), so **the collector path resolution would survive installation** — provided all folders are in `FileList`.

#### 2. `controls/registry.json` is required at runtime but is a data file (medium risk)

`Import-ControlRegistry` expects `controls/registry.json` at a path computed from `$projectRoot`:

```powershell
$controlsDir = Join-Path -Path $projectRoot -ChildPath 'controls'
$progressRegistry = Import-ControlRegistry -ControlsPath $controlsDir
```

`registry.json` is **not listed in `FileList`**. Neither are `controls/check-id-mapping.csv`, `controls/frameworks/`, or `Common/framework-mappings.csv`. These are required for the compliance-matrix and HTML report features. A PSGallery install would be missing them.

#### 3. `Common/assets/` images are not in `FileList` (medium risk)

`Export-AssessmentReport.ps1` loads:

```powershell
$logoPath = Join-Path -Path $projectRoot -ChildPath 'Common\assets\m365-assess-logo.png'
$wavePath = Join-Path -Path $projectRoot -ChildPath 'Common\assets\m365-assess-bg.png'
```

Neither `Common\assets\m365-assess-logo.png` nor `Common\assets\m365-assess-bg.png` appears in `FileList`. The report generator gracefully skips them if missing (`if (Test-Path ...)`), so this degrades gracefully rather than crashing.

#### 4. `Export-AssessmentReport.ps1` reads the manifest via `$PSScriptRoot/../M365-Assess.psd1` (low risk)

```powershell
$assessmentVersion = (Import-PowerShellDataFile -Path "$PSScriptRoot/../M365-Assess.psd1").ModuleVersion
```

`$PSScriptRoot` for `Common/Export-AssessmentReport.ps1` would be `.../M365-Assess/0.9.3/Common/`. One level up (`..`) is `.../M365-Assess/0.9.3/` — which is exactly where `M365-Assess.psd1` lives after `Install-Module`. **This would work.**

#### 5. `ScriptsToProcess` includes `Common\Connect-Service.ps1` (low risk, but semantically wrong)

`ScriptsToProcess` runs scripts in the **caller's scope** when the module is imported via `Import-Module`. This is designed for type/format loading, not helper scripts. `Connect-Service.ps1` is an interactive script with its own `param()` block. Loading it at `Import-Module` time would run its `param()` block silently but would not define any functions or commands — it would just execute as a no-op in global scope. This is harmless but wrong and should be removed.

#### 6. `RootModule = 'Invoke-M365Assessment.ps1'` means `Import-Module` executes the full orchestrator (architectural mismatch)

This is the deepest architectural problem. When a user runs `Import-Module M365-Assess`, PowerShell executes `Invoke-M365Assessment.ps1` as a module root. That script contains top-level executable code — it calls `Show-InteractiveWizard` when no parameters are present, sets `$ErrorActionPreference = 'Stop'`, and runs the entire assessment flow. A PSGallery module's `RootModule` should define functions and export them; it must not have side-effecting top-level code.

The expected PSGallery usage pattern would be:

```powershell
Import-Module M365-Assess
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'
```

But with the current structure, `Import-Module M365-Assess` with no parameters would launch the interactive wizard or fail, not silently import a set of commands.

#### 7. Collectors call other scripts via `& $scriptPath` (architectural, medium)

Each collector is invoked as a child process via `& $scriptPath @params`. This is a legitimate pattern but requires all collector `.ps1` files to be present on disk and executable by path. PSGallery does preserve them on disk (unlike `.NET` assemblies), so **this specific pattern survives installation**. However, individual collectors cannot be invoked standalone from PSGallery install because they reference `Common\Connect-Service.ps1` in their `.EXAMPLE` blocks using repo-relative paths — documentation would be misleading but not functionally broken.

---

## Required Changes (If PSGallery Publishing Were Pursued)

| # | Change | Effort |
|---|--------|--------|
| 1 | **Refactor `RootModule`** to a proper module file (`M365-Assess.psm1`) that exports `Invoke-M365Assessment` as a function rather than running top-level code at import time. The orchestrator logic moves into a function body. | L |
| 2 | **Add missing files to `FileList`**: `controls/registry.json`, `controls/check-id-mapping.csv`, `controls/frameworks/*.json`, `Common/framework-mappings.csv`, `Common/assets/m365-assess-logo.png`, `Common/assets/m365-assess-bg.png` | S |
| 3 | **Remove `ScriptsToProcess`** entry for `Common\Connect-Service.ps1`. It serves no purpose as a `ScriptsToProcess` entry and will confuse module consumers. | S |
| 4 | **Add `FunctionsToExport`** to the manifest (currently absent). PSGallery warns on modules with no exported functions. Set to `@('Invoke-M365Assessment')` at minimum. | S |
| 5 | **Audit `DefaultOutputFolder` default value** (`'.\M365-Assessment'`): relative paths work fine from a cloned repo but behave correctly from `Install-Module` installs too (they resolve relative to the user's CWD at call time, not the module directory). No change needed, but worth documenting. | S |
| 6 | **Verify `controls/` and `Common/assets/` are git-tracked** and included in every release tag, since PSGallery packages from source. | S |

---

## Risks

- **Interactive wizard at `Import-Module` time** is the most user-hostile failure mode. A user who follows standard PowerShell module patterns (`Import-Module` then call a function) would get an unexpected interactive prompt or a hard stop.
- **`$PSCommandPath` in a `RootModule`** behaves differently from a standalone script. Some PowerShell hosts set it to `$null` when loading a module root. If that occurs on any platform, `$projectRoot` becomes empty and every `Join-Path` downstream produces a bad path. This needs testing before publication.
- **EXO version ceiling** (`< 3.8.0`) cannot be expressed in `RequiredModules` — the manifest comment acknowledges this. PSGallery users with EXO 3.8.0+ installed would encounter runtime failures that are not signaled at install time. This is a known limitation, not a new risk.
- **`Publish-Module` requires a NuGet API key** and the module name must not conflict with existing Gallery entries. `M365-Assess` is currently unclaimed on PSGallery (as of research date), but this should be verified before committing to the name.

---

## Recommendation

**Defer PSGallery publishing; keep as a cloned-repo tool for now.**

The manifest has good PSGallery metadata and the file layout is mostly installable. However, the `RootModule` architectural mismatch (top-level orchestrator code executed at `Import-Module` time) is a hard blocker that requires non-trivial refactoring. This is not a small fix — it changes how the entire tool is invoked and tested.

If PSGallery is a v1.0.0 goal, the work should be scoped as a dedicated milestone item:

1. Introduce `M365-Assess.psm1` as the new `RootModule` that wraps `Invoke-M365Assessment` as an exported function.
2. Rename or alias the existing `.ps1` to avoid confusion.
3. Validate the module loads cleanly with `Import-Module` and no top-level side effects.
4. Fix `FileList` and remove `ScriptsToProcess`.
5. Publish to PSGallery under the `SelvageLabs` account.

**Estimated effort:** M (3-5 days including testing) for a clean, correct PSGallery-compatible module structure.

**Close issue #120 as:** `deferred` — label as `v1.0.0` candidate alongside the other native framework issues (#67, #103, #104).
