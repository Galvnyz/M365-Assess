# v1.1.0 Framework Catalogs Design

**Date**: 2026-03-20
**Milestone**: v1.1.0 - Framework Catalogs
**Status**: Approved

## Overview

Build a generic framework catalog engine that renders compliance posture through each framework's native structure. All 14 frameworks work automatically via JSON metadata -- no per-framework code. Three output modes: inline HTML posture pages in the main report, grouped findings for XLSX/programmatic use, and standalone per-framework HTML exports.

## Architecture

### New File: Common/Export-FrameworkCatalog.ps1

Single function with three output modes:

```
Export-FrameworkCatalog -Findings $data -Framework $fw -ControlRegistry $reg -Mode <Inline|Grouped|Standalone> [-OutputPath $path] [-TenantName $name]
```

- **Inline**: Returns HTML fragment for embedding in the main report. Collapsible `<details>` block with header, group breakdown table, and findings table grouped by framework structure.
- **Grouped**: Returns reordered findings array (not HTML) grouped by framework structure. For XLSX and programmatic consumers.
- **Standalone**: Generates a complete self-contained HTML file (with embedded CSS/JS, same styling as the main report). Requires `-OutputPath` and `-TenantName`. The orchestrator constructs the path and filename.

### Scoring Engine

Dispatches on `scoring.method` from framework JSON definitions. Each method knows how to parse that framework's controlId strings into structural groups and compute coverage/pass rates per group.

**Corrected dispatch table** (verified against actual `scoring.method` values in each framework JSON):

| Method | Frameworks | Group Key | Parsing Rule |
|--------|-----------|-----------|-------------|
| `profile-compliance` | CIS M365 v6, NIST 800-53, FedRAMP, CIS Controls v8 | Profile tags from `scoring.profiles` | `profiles` array on each registry mapping (E3-L1, Low/Moderate/High, IG1/IG2/IG3, LI-SaaS/Low/Moderate/High) |
| `function-coverage` | NIST CSF | Function prefix (GV, ID, PR, DE, RS, RC) | First segment of controlId before `.` matched against `scoring.functions` keys |
| `control-coverage` | ISO 27001 | Clause number (5, 6, 7, 8) | Second segment of `A.{clause}.{control}` format matched against `scoring.themes` keys |
| `technique-coverage` | MITRE ATT&CK | Tactic ID (TA0001-TA0043) | Technique IDs (T{number}) resolved via bundled `techniqueTacticMap` (see below) |
| `maturity-level` | Essential Eight, CMMC | Maturity level | Essential Eight: parse `ML{n}-P{n}` via `controlIdFormat`, group by ML prefix. CMMC: controlIds are NIST 800-171 practice numbers (e.g., `3.1.5`); group by `maturityLevels` keys using a level-to-practice mapping from the JSON |
| `severity-coverage` | STIG | CAT-I / CAT-II / CAT-III | Category from `scoring.categories` in JSON |
| `requirement-compliance` | PCI DSS | Requirement number (1-12) | First segment of controlId before `.` matched against `scoring.requirements` keys |
| `criteria-coverage` | SOC 2, HIPAA | Criteria key | SOC 2: exact match of each semicolon-split controlId segment (e.g., `CC6.1`) against `scoring.criteria` keys. HIPAA: split each semicolon-delimited segment on `(`, take `[0]` (e.g., `§164.312(a)(1)` becomes `§164.312`), match directly against `scoring.criteria` keys (section sign is already present in controlId) |
| `policy-compliance` | CISA SCuBA | Product group (AAD, EXO, etc.) | Second segment of controlId (split on `.`, take index 1; e.g., `MS.AAD.7.4v1` -> `AAD`) matched against `scoring.products` keys |

**MITRE technique-to-tactic resolution**: The `mitre-attack.json` defines tactics but does not contain a technique-to-tactic lookup. The scoring engine bundles a static `techniqueTacticMap` hashtable (T-number to TA-code) derived from the ATT&CK STIX data. This map is maintained as a data file (`controls/mitre-technique-map.json`) synced alongside framework definitions. Techniques not found in the map are grouped under an "Unmapped" bucket.

**CMMC maturity-level note**: CMMC controlIds are NIST 800-171 practice numbers (e.g., `3.1.5;3.1.6`), not ML-prefixed like Essential Eight. The CMMC JSON's `maturityLevels` define practice counts per level. Since the registry does not encode which level a practice belongs to, CMMC `maturity-level` scoring shows overall practice coverage against each level's `practiceCount` denominator (cumulative -- L2 includes L1 practices).

Each method returns a uniform `GroupedResult` structure:

```powershell
@{
    Groups = @(
        @{ Key = 'PR'; Label = 'Protect'; Total = 27; Mapped = 12; Passed = 8; Failed = 3; Other = 1 }
    )
    Summary = @{ TotalControls = 106; MappedControls = 45; PassRate = 0.72 }
}
```

**Counting semantics**: Counts are per-finding (not per controlId instance). A finding mapped to multiple groups via a semicolon-delimited controlId string is counted once in each group it maps to. `Mapped` is the count of unique findings that have at least one controlId in this group. `Total` is from the framework JSON metadata (e.g., `subcategories` count, `controlCount`, `practiceCount`).

**Error handling**: If `scoring.method` is null or unrecognized, the engine falls back to `control-coverage` with first-segment grouping and emits a `Write-Warning`. If no findings map to a framework, `GroupedResult.Summary.MappedControls = 0` and all groups have zero counts. Inline mode renders a placeholder message ("No assessed findings map to this framework") rather than empty tables.

## Integration Points

### Import-FrameworkDefinitions.ps1 (minor change)

Add `scoringData` key to the returned hashtable, preserving the full raw `scoring` object. Also preserve top-level structural keys that live outside `scoring` but are needed for catalog rendering: `strategies` (Essential Eight), `controls` (CIS Controls v8), `sections` (CIS M365 v6), `nonAutomatableCriteria` and `licensingProfiles` (SOC 2). These are stored in a new `extraData` key. Existing consumers are unaffected -- they do not reference either key.

### Export-AssessmentReport.ps1 (minimal change)

After the `Export-ComplianceOverview` call, add a loop. The framework list is recomputed from `$allFrameworks` with `$FrameworkFilter` applied (same logic as `Export-ComplianceOverview` uses internally), since `$displayFrameworks` is scoped inside that function:

```powershell
$catalogFrameworks = $allFrameworks
if ($FrameworkFilter -and $FrameworkFilter.Count -gt 0) {
    $catalogFrameworks = @($allFrameworks | Where-Object { $_.filterFamily -in $FrameworkFilter })
}
foreach ($fw in $catalogFrameworks) {
    $catalogHtml = Export-FrameworkCatalog -Findings $findings -Framework $fw `
        -ControlRegistry $registry -Mode Inline
    $null = $html.AppendLine($catalogHtml)
}
```

No other changes to the 4,130-line report file.

### Invoke-M365Assessment.ps1 (new parameter)

```powershell
[Parameter()]
[ValidateSet('CIS','NIST','ISO','STIG','PCI','CMMC','HIPAA','CISA','SOC2','FedRAMP','Essential8','MITRE','All')]
[string[]]$FrameworkExport
```

Note: `CISv8` is removed from ValidateSet because `cis-controls-v8` and `cis-m365-v6` both resolve to `filterFamily = 'CIS'` via the prefix map. Selecting `CIS` exports both. If independent export is needed later, `Import-FrameworkDefinitions` can be updated with a `cis-controls` prefix entry, but this is deferred.

When set, after the main report generates, the orchestrator calls `Export-FrameworkCatalog -Mode Standalone` for each matching framework, constructing the output path:

```powershell
foreach ($fw in $exportFrameworks) {
    $fwFileName = "_$($fw.label -replace '[^a-zA-Z0-9]','-')-Catalog${summarySuffix}.html"
    $fwPath = Join-Path -Path $assessmentFolder -ChildPath $fwFileName
    Export-FrameworkCatalog -Findings $findings -Framework $fw `
        -ControlRegistry $registry -Mode Standalone -OutputPath $fwPath -TenantName $tenantName
}
```

### Export-ComplianceMatrix.ps1 (optional)

Add a second XLSX sheet "Grouped by Framework" using `-Mode Grouped` output. Nice-to-have, not blocking.

### CSS / Styling

Reuses existing report CSS variables and dark-mode support. Framework-specific colors from the `colors` object in each JSON definition. Styles inlined in HTML fragments (same pattern as `Export-ComplianceOverview`).

## Infrastructure Issues (v1.1.0)

Filed as #180-186, executed alongside the catalog features:

| # | Title | Size |
|---|-------|------|
| #180 | Pester tests for 9 Entra reporting collectors | L |
| #181 | Pester tests for EXO reporting collectors | M |
| #182 | Pester tests for Inventory collectors | M |
| #183 | CI: workflow_dispatch + weekly cron for sync-checkid | S |
| #184 | CI: release automation on version tag push | M |
| #185 | CI: code coverage badge | S |
| #186 | Docs: clarify standalone script roles | S |

## Testing

- **Unit tests** for scoring engine: one test per scoring method verifying controlId parsing, group assignment, coverage math. Mock data, no Graph calls.
- **Integration tests**: real `registry.json` + real framework JSONs through the engine; verify all 14 frameworks produce valid `GroupedResult` structures with no nulls.
- **HTML output tests**: verify Inline and Standalone modes produce valid HTML with expected CSS classes and section structure (string matching).
- **Edge cases**: zero mapped findings per framework, malformed controlId strings (missing semicolons, empty strings), unknown scoring method fallback.
- Target: ~30-40 new Pester tests in `tests/Common/Export-FrameworkCatalog.Tests.ps1`

## Sprint Plan

### Sprint 1: Infrastructure + Scoring Engine

1. #183: CI sync-checkid triggers (S)
2. #184: Release automation workflow (M)
3. #185: Code coverage badge (S)
4. #186: Standalone script docs (S)
5. `Import-FrameworkDefinitions` change (preserve `scoringData` + `extraData`)
6. `Export-FrameworkCatalog.ps1` scoring engine + Inline mode
7. `controls/mitre-technique-map.json` data file
8. Report integration (foreach loop in `Export-AssessmentReport`)

### Sprint 2: Outputs + Test Coverage

1. Standalone mode + `-FrameworkExport` orchestrator parameter
2. Grouped mode + optional XLSX sheet
3. #180: Pester tests for Entra reporting collectors (L)
4. #181: Pester tests for EXO reporting collectors (M)
5. #182: Pester tests for Inventory collectors (M)
6. Pester tests for `Export-FrameworkCatalog` (~30-40 tests)

## Deliverables Summary

- Generic scoring engine dispatching on 9 scoring methods across 14 frameworks
- Inline posture pages embedded in HTML report per framework
- Grouped findings reordered by framework structure (XLSX + programmatic)
- Standalone HTML exports per framework (`-FrameworkExport` parameter)
- MITRE technique-to-tactic map data file
- Infrastructure improvements (#180-186)
- ~70-80 new Pester tests
