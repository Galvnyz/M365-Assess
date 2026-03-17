# v1.0.0 Report Framework Refactor Design Spec

> **Milestone:** v1.0.0 - Native Frameworks
> **Issue:** #67 (scoped to report refactor -- read from JSONs instead of hardcoded)
> **Prerequisite:** CheckID framework definition JSONs for all 13 frameworks
> (plan at `C:\git\CheckID\.claude\framework-definitions-plan.md`)

## Summary

Refactor `Common/Export-AssessmentReport.ps1` to load framework metadata from JSON
definition files in `controls/frameworks/` instead of hardcoded arrays. This makes
adding new frameworks a data change (add a JSON file) rather than a code change.

## Hardcoded Locations (10 total)

These are the specific locations in `Export-AssessmentReport.ps1` being replaced:

| # | Lines | What | Replaced By |
|---|-------|------|-------------|
| 1 | 75-92 | `$frameworkLookup` hashtable (16 entries) | Dynamic from JSONs |
| 2 | 94 | `$allFrameworkKeys` array | Dynamic from JSONs |
| 3 | 95-96 | `$cisProfileKeys`, `$nistProfileKeys` | `$profileFrameworkKeys` (from scoring.method) |
| 4 | 1728-1737 | CIS/NIST profile column properties (8 lines) | Dynamic loop over profiles |
| 5 | 1738-1744 | Flat framework column properties (7 lines) | Dynamic loop over frameworks |
| 6 | 1754-1765 | `$catalogFiles` CSV filename mapping | `CatalogTotal` from JSON |
| 7 | 1776-1788 | NIST JSON loading block | Unified JSON loading |
| 8 | 1852 | Profile key branch (`$cisProfileKeys -or $nistProfileKeys`) | `ScoringMethod` check |
| 9 | 3375-3387 | Light-theme framework tag CSS (13 classes) | Generated from JSON `colors` |
| 10 | 3492-3504 | Dark-theme framework tag CSS (13 classes) | Generated from JSON `colors` |

## What Changes

### Before (hardcoded)

```powershell
$frameworkLookup = @{
    'CIS-E3-L1'  = @{ Col = 'CisE3L1'; Label = 'CIS E3 L1'; Css = 'fw-cis' }
    'NIST-Low'   = @{ Col = 'Nist80053Low'; Label = 'NIST Low'; Css = 'fw-nist' }
    # ... 14 more entries
}
$allFrameworkKeys = @('CIS-E3-L1', ..., 'SOC-2')
$cisProfileKeys = @('CIS-E3-L1', ...)
$nistProfileKeys = @('NIST-Low', ...)
$catalogFiles = @{ 'CIS-E3-L1' = 'cis-e3-l1.csv'; ... }
```

Plus ~25 lines of hardcoded CSS for framework tag colors (light + dark themes).

### After (JSON-driven)

```powershell
# Load all framework definitions
$frameworkDefs = @{}
$fwJsonDir = Join-Path -Path $projectRoot -ChildPath 'controls/frameworks'
foreach ($jsonFile in (Get-ChildItem -Path $fwJsonDir -Filter '*.json')) {
    $def = Get-Content -Path $jsonFile.FullName -Raw | ConvertFrom-Json
    $frameworkDefs[$def.frameworkId] = $def
}

# Build lookup, keys, and profile lists dynamically
$frameworkLookup = [ordered]@{}
$allFrameworkKeys = [System.Collections.Generic.List[string]]::new()
$profileFrameworkKeys = [System.Collections.Generic.List[string]]::new()

foreach ($def in $frameworkDefs.Values | Sort-Object { $_.displayOrder }) {
    if ($def.scoring.method -eq 'profile-compliance' -and $def.scoring.profiles) {
        # Profile-based: one entry per profile
        foreach ($profileKey in $def.scoring.profiles.PSObject.Properties.Name) {
            $profile = $def.scoring.profiles.$profileKey
            $fwKey = "$($def.frameworkId)-$profileKey"
            # Column name derivation: csvColumn + stripped profileKey
            # CIS: csvColumn="Cis", profileKey="E3-L1" -> "CisE3L1"
            # NIST: csvColumn="Nist80053", profileKey="Low" -> "Nist80053Low"
            $col = "$($def.csvColumn)$($profileKey -replace '[^a-zA-Z0-9]', '')"
            $frameworkLookup[$fwKey] = @{
                Col = $col
                Label = $profile.label
                Css = if ($profile.css) { $profile.css } else { $def.css }
                CatalogTotal = if ($profile.controlCount) { [int]$profile.controlCount } else { [int]$def.totalControls }
                ScoringMethod = 'profile-compliance'
                FrameworkId = $def.frameworkId
                ProfileKey = $profileKey
            }
            $allFrameworkKeys.Add($fwKey)
            $profileFrameworkKeys.Add($fwKey)
        }
    }
    else {
        # Flat framework: one entry
        $fwKey = $def.frameworkId
        $frameworkLookup[$fwKey] = @{
            Col = $def.csvColumn
            Label = $def.label
            Css = $def.css
            CatalogTotal = if ($def.totalControls) { [int]$def.totalControls } else { 0 }
            ScoringMethod = $def.scoring.method
            FrameworkId = $def.frameworkId
        }
        $allFrameworkKeys.Add($fwKey)
    }
}
```

## Changes by Section

### 1. Framework Loading (replaces lines 75-96)

Load all `*.json` files from `controls/frameworks/`. Build `$frameworkLookup` and
`$allFrameworkKeys` dynamically as shown above.

**Key decisions:**
- Profile-based frameworks (CIS, NIST) expand into multiple entries (one per profile)
- Flat frameworks (ISO, CMMC, etc.) get one entry
- `$profileFrameworkKeys` replaces both `$cisProfileKeys` and `$nistProfileKeys`
- Card type determined by `ScoringMethod` property, not hardcoded key lists
- `CatalogTotal` stored in lookup (no separate `$catalogFiles` or `$catalogCounts` needed)

**Ordering:** Each framework JSON must include a `displayOrder` integer field to preserve
the current rendering order. The loader sorts by `displayOrder` ascending. This ensures
the HTML output is identical to the current hardcoded order. The CheckID plan must add
`displayOrder` to every framework JSON:

| displayOrder | Framework |
|-------------|-----------|
| 1 | CIS (profiles expand in profile key order) |
| 2 | NIST 800-53 (profiles expand in profile key order) |
| 3 | NIST CSF |
| 4 | ISO 27001 |
| 5 | DISA STIG |
| 6 | PCI DSS |
| 7 | CMMC |
| 8 | HIPAA |
| 9 | CISA SCuBA |
| 10 | SOC 2 |

### 2. Finding Data Population (replaces lines 1728-1744)

Currently builds per-framework columns with hardcoded property names. Replace with
a dynamic loop over `$frameworkLookup`:

```powershell
# Build framework columns dynamically
$fwProps = [ordered]@{}
foreach ($fwKey in $allFrameworkKeys) {
    $fwInfo = $frameworkLookup[$fwKey]
    $col = $fwInfo.Col
    $fwId = $fwInfo.FrameworkId
    $profileKey = $fwInfo.ProfileKey  # null for flat frameworks

    $fwData = if ($fw.$fwId) { $fw.$fwId } else { $null }
    $controlId = if ($fwData -and $fwData.controlId) { $fwData.controlId } else { '' }
    $profiles = if ($fwData -and $fwData.profiles) { $fwData.profiles } else { @() }

    if ($profileKey) {
        # Profile column: only populate if this profile is in the entry's profiles array
        $fwProps[$col] = if ($profiles -contains $profileKey) { $controlId } else { '' }
    }
    else {
        # Flat column: populate if framework exists in entry
        $fwProps[$col] = $controlId
    }
}
```

The PSCustomObject is then built by splatting `$fwProps` alongside the fixed columns.

**Note on orphaned flat columns:** The current code has a flat `Nist80053` column
(line 1733) alongside the 4 NIST profile columns. This flat column is kept for
backward compatibility with `Export-ComplianceMatrix.ps1` (XLSX export). The dynamic
loop above does NOT produce this column since NIST is `profile-compliance`. Add it
explicitly after the loop if XLSX export still needs it:

```powershell
# Backward compat: flat NIST 800-53 column for XLSX export
$fwProps['Nist80053'] = if ($fw.'nist-800-53') { $fw.'nist-800-53'.controlId } else { '' }
```

### 3. Catalog Counts (replaces lines 1754-1788)

Delete the `$catalogFiles` hashtable and the CSV-reading loop. Delete the NIST JSON
loading block. Catalog totals are already in `$frameworkLookup[$fwKey].CatalogTotal`.

### 4. Card Generation (replaces lines 1850-1875)

Replace the `if ($fwKey -in $cisProfileKeys -or $fwKey -in $nistProfileKeys)` branch
with a check on `ScoringMethod`:

```powershell
if ($fwInfo.ScoringMethod -eq 'profile-compliance') {
    # Profile card: pass rate + coverage bar (existing logic)
}
else {
    # Flat card: pass rate + coverage bar (existing logic)
}
```

Use `$fwInfo.CatalogTotal` instead of `$catalogCounts[$fwKey]`.

### 5. CSS Generation (replaces lines 3375-3387 and 3492-3504)

Generate framework tag CSS dynamically from JSON `colors` properties:

```powershell
# Generate framework CSS from definitions
foreach ($def in $frameworkDefs.Values) {
    if ($def.colors) {
        $null = $cssBuilder.AppendLine("        .$($def.css) { background: $($def.colors.light.background); color: $($def.colors.light.color); }")
        $null = $cssBuilder.AppendLine("        body.dark-theme .$($def.css) { background: $($def.colors.dark.background); color: $($def.colors.dark.color); }")
    }
    # Profile-specific colors
    if ($def.scoring.profiles) {
        foreach ($profile in $def.scoring.profiles.PSObject.Properties) {
            $p = $profile.Value
            if ($p.colors -and $p.css -ne $def.css) {
                $null = $cssBuilder.AppendLine("        .$($p.css) { background: $($p.colors.light.background); color: $($p.colors.light.color); }")
                $null = $cssBuilder.AppendLine("        body.dark-theme .$($p.css) { background: $($p.colors.dark.background); color: $($p.colors.dark.color); }")
            }
        }
    }
}
```

### 6. complianceData JSON Blob

The embedded `complianceData` for client-side recalculation uses the same dynamic
column names. No changes needed to the JS -- it reads `data-fw` attributes which
match the column names.

### 7. Framework Selector Checkboxes

Generated from `$allFrameworkKeys` loop (existing). No changes needed -- the loop
already iterates `$frameworkLookup`.

## What Does NOT Change

- **Collector scripts** -- they don't reference framework metadata
- **Registry loading** (`Import-ControlRegistry.ps1`) -- unchanged
- **XLSX export** (`Export-ComplianceMatrix.ps1`) -- reads from `$allCisFindings` which has the same column structure
- **JavaScript filter functions** -- they use `data-fw` attributes, not framework IDs
- **Card HTML structure** -- dual-metric layout stays the same
- **Section filter, status filter, expand/collapse** -- unchanged

## Error Handling

- If `controls/frameworks/` directory is missing or empty, fall back to an empty
  framework set (report generates without compliance section)
- If a JSON file is malformed, log a warning and skip that framework
- If `totalControls` is missing, default to 0 (coverage bar hidden)

## Testing

### Unit Tests

- Report generates with all 13 framework JSONs present
- Report generates with only CIS + NIST (subset of JSONs)
- Report generates with zero framework JSONs (graceful degradation)
- Framework lookup has correct count matching JSON files
- Profile frameworks expand into correct number of entries
- CSS generated for each framework definition
- Card type matches scoring method

### Consistency Tests

Update `tests/Consistency/Metadata-Consistency.Tests.ps1`:
- Every framework JSON has required fields
- Every `registryKey` maps to a key in registry.json
- `totalControls` values are reasonable (> 0)
- Colors have valid hex values

## Migration Notes

This is a **non-breaking change** for the report output. With `displayOrder` preserving
framework ordering, the HTML output is identical. The change is internal: how the report
script loads its framework metadata.

**Before merging:** Sync `controls/frameworks/` from CheckID to get all 13 JSONs.

## Dependencies

- CheckID: All 13 framework definition JSONs with unified schema
  (plan at `C:\git\CheckID\.claude\framework-definitions-plan.md`)
