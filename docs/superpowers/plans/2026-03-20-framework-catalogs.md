# Framework Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic framework catalog engine that renders per-framework compliance posture through each framework's native structure, with inline report pages, standalone HTML exports, and grouped data output.

**Architecture:** New `Common/Export-FrameworkCatalog.ps1` with a scoring engine that dispatches on `scoring.method` from framework JSON definitions. Nine scoring methods handle all 14 frameworks. Three output modes (Inline, Grouped, Standalone) share the same scoring results. Integration into the existing report is a single foreach loop after the Compliance Overview section.

**Tech Stack:** PowerShell 7.x, Pester 5.x, HTML/CSS (inline, self-contained), JSON framework definitions

**Spec:** `docs/superpowers/specs/2026-03-20-framework-catalogs-design.md`

---

## Sprint 1: Scoring Engine + Inline Mode

> **Note:** The spec lists CI issues (#183-186) in Sprint 1, but this plan moves them to Sprint 2 (Task 9) since they are independent of the scoring engine work and do not block any other task. This allows Sprint 1 to focus entirely on the core catalog feature.

### Task 1: Extend Import-FrameworkDefinitions to preserve scoring data

**Files:**
- Modify: `Common/Import-FrameworkDefinitions.ps1:106-117`
- Test: `tests/Common/Import-FrameworkDefinitions.Tests.ps1`

- [ ] **Step 1: Write failing tests for scoringData and extraData keys**

Add to `tests/Common/Import-FrameworkDefinitions.Tests.ps1`:

```powershell
It 'Each framework includes scoringData from the scoring object' {
    $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
    foreach ($fw in $result) {
        $fw.Keys | Should -Contain 'scoringData'
        $fw.scoringData | Should -Not -BeNullOrEmpty
    }
}

It 'Essential Eight includes strategies in extraData' {
    $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
    $e8 = $result | Where-Object { $_.frameworkId -eq 'essential-eight' }
    $e8.Keys | Should -Contain 'extraData'
    $e8.extraData.Keys | Should -Contain 'strategies'
    $e8.extraData.strategies.Keys | Should -Contain 'P1'
}

It 'SOC2 includes nonAutomatableCriteria in extraData' {
    $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
    $soc2 = $result | Where-Object { $_.frameworkId -eq 'soc2' }
    $soc2.extraData.Keys | Should -Contain 'nonAutomatableCriteria'
}

It 'Frameworks without extra top-level keys have empty extraData' {
    $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
    $stig = $result | Where-Object { $_.frameworkId -eq 'stig' }
    $stig.Keys | Should -Contain 'extraData'
    $stig.extraData.Count | Should -Be 0
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Import-FrameworkDefinitions.Tests.ps1 -Output Detailed"`
Expected: 4 failures -- `scoringData` and `extraData` keys not found

- [ ] **Step 3: Implement scoringData and extraData preservation**

In `Common/Import-FrameworkDefinitions.ps1`, make two changes:

**(a)** Insert the following code **between lines 104 and 106** (after the `$filterFamily` fallback block, before `$frameworks.Add(@{`):

```powershell
        # Preserve raw scoring sub-structures for catalog rendering
        $scoringData = @{}
        if ($def.scoring) {
            foreach ($prop in $def.scoring.PSObject.Properties) {
                if ($prop.Name -ne 'method' -and $prop.Name -ne 'profiles') {
                    $scoringData[$prop.Name] = $prop.Value
                }
            }
        }

        # Preserve top-level structural keys outside scoring (strategies, controls, etc.)
        $extraKeys = @('strategies', 'controls', 'sections', 'nonAutomatableCriteria', 'licensingProfiles', 'groupBy')
        $extraData = @{}
        foreach ($key in $extraKeys) {
            if ($def.PSObject.Properties.Name -contains $key) {
                $extraData[$key] = $def.$key
            }
        }
```

**(b)** Inside the `$frameworks.Add(@{...})` block, add these two keys **after `filterFamily` on line 115**:

```powershell
            scoringData   = $scoringData
            extraData     = $extraData
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Import-FrameworkDefinitions.Tests.ps1 -Output Detailed"`
Expected: All tests pass (existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add Common/Import-FrameworkDefinitions.ps1 tests/Common/Import-FrameworkDefinitions.Tests.ps1
git commit -m "feat: preserve scoringData and extraData in Import-FrameworkDefinitions"
```

---

### Task 2: Create MITRE technique-to-tactic map

**Files:**
- Create: `controls/mitre-technique-map.json`
- Test: `tests/Common/Export-FrameworkCatalog.Tests.ps1` (created in Task 3)

The MITRE ATT&CK framework JSON defines 14 tactics but no technique-to-tactic mapping. The scoring engine needs this to group technique IDs (T1003, T1021, etc.) by tactic.

- [ ] **Step 1: Generate technique-to-tactic map from registry data**

Create `controls/mitre-technique-map.json` containing a mapping of technique IDs referenced in `registry.json` to their tactic codes. Format:

```json
{
  "description": "Maps MITRE ATT&CK technique IDs to tactic codes. Derived from ATT&CK STIX data.",
  "map": {
    "T1003": "TA0006",
    "T1003.001": "TA0006",
    "T1005": "TA0009",
    "T1008": "TA0011",
    "T1011": "TA0010",
    "T1011.001": "TA0010",
    "T1021": "TA0008",
    "T1021.001": "TA0008",
    "T1021.002": "TA0008",
    "T1021.003": "TA0008",
    "T1040": "TA0006",
    "T1048": "TA0010",
    "T1048.002": "TA0010",
    "T1071": "TA0011",
    "T1071.001": "TA0011",
    "T1078": "TA0001",
    "T1078.001": "TA0001",
    "T1078.002": "TA0001",
    "T1078.003": "TA0001",
    "T1078.004": "TA0001",
    "T1098": "TA0003",
    "T1098.001": "TA0003",
    "T1098.002": "TA0003",
    "T1098.003": "TA0003",
    "T1110": "TA0006",
    "T1110.001": "TA0006",
    "T1110.002": "TA0006",
    "T1110.003": "TA0006",
    "T1110.004": "TA0006",
    "T1114": "TA0009",
    "T1114.001": "TA0009",
    "T1114.002": "TA0009",
    "T1114.003": "TA0009",
    "T1133": "TA0001",
    "T1134": "TA0004",
    "T1136": "TA0003",
    "T1136.003": "TA0003",
    "T1137": "TA0003",
    "T1176": "TA0003",
    "T1185": "TA0009",
    "T1199": "TA0001",
    "T1204": "TA0002",
    "T1213": "TA0009",
    "T1213.002": "TA0009",
    "T1505": "TA0003",
    "T1530": "TA0009",
    "T1534": "TA0043",
    "T1539": "TA0006",
    "T1550": "TA0008",
    "T1550.001": "TA0008",
    "T1556": "TA0003",
    "T1556.006": "TA0003",
    "T1557": "TA0006",
    "T1558": "TA0006",
    "T1558.003": "TA0006",
    "T1566": "TA0001",
    "T1566.001": "TA0001",
    "T1566.002": "TA0001",
    "T1566.003": "TA0001",
    "T1567": "TA0010",
    "T1567.002": "TA0010",
    "T1583": "TA0042",
    "T1584": "TA0042",
    "T1586": "TA0042",
    "T1589": "TA0043",
    "T1598": "TA0043",
    "T1598.003": "TA0043",
    "T1621": "TA0006"
  }
}
```

This map is the authoritative source for technique-to-tactic resolution. Use it as-is. If `registry.json` gains new technique IDs in the future, add them to this map as part of the CheckID sync process.

- [ ] **Step 2: Verify all registry MITRE technique IDs are covered**

Write a temporary validation script to extract all unique technique IDs from `registry.json` mitre-attack controlIds and verify each exists in the map. Any missing entries must be added.

- [ ] **Step 3: Commit**

```bash
git add controls/mitre-technique-map.json
git commit -m "feat: add MITRE technique-to-tactic map for catalog scoring"
```

---

### Task 3: Create Export-FrameworkCatalog scoring engine with tests

**Files:**
- Create: `Common/Export-FrameworkCatalog.ps1`
- Create: `tests/Common/Export-FrameworkCatalog.Tests.ps1`

This is the largest task. Build the scoring engine that dispatches on `scoring.method` and returns `GroupedResult` structures.

- [ ] **Step 1: Write failing tests for the scoring engine**

Create `tests/Common/Export-FrameworkCatalog.Tests.ps1` with tests for each scoring method. Use mock data -- no Graph calls.

```powershell
Describe 'Export-FrameworkCatalog - Scoring Engine' {
    BeforeAll {
        . "$PSScriptRoot/../../Common/Import-FrameworkDefinitions.ps1"
        . "$PSScriptRoot/../../Common/Export-FrameworkCatalog.ps1"
        $frameworksPath = "$PSScriptRoot/../../controls/frameworks"
        $allFrameworks = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $projectRoot = "$PSScriptRoot/../.."

        # Load real registry for integration tests
        $regRaw = Get-Content "$projectRoot/controls/registry.json" -Raw | ConvertFrom-Json
        $registry = @{}
        foreach ($c in $regRaw.checks) { $registry[$c.checkId] = $c }

        # Mock findings helper
        function New-MockFinding {
            param([string]$CheckId, [string]$Status = 'Pass', [string]$Section = 'Identity')
            [PSCustomObject]@{
                CheckId = $CheckId; Setting = "Test Setting for $CheckId"
                Status = $Status; RiskSeverity = 'Medium'; Section = $Section
                Frameworks = if ($registry[$CheckId]) { $registry[$CheckId].frameworks } else { @{} }
            }
        }
    }

    Context 'function-coverage (NIST CSF)' {
        It 'Returns all 6 CSF function groups' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $findings = @(
                New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001' -Status 'Pass'
                New-MockFinding -CheckId 'CA-MFA-ADMIN-001' -Status 'Fail'
            )
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups.Count | Should -Be 6
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('GV','ID','PR','DE','RS','RC') }
            $result.Summary.MappedControls | Should -BeGreaterThan 0
        }
    }

    Context 'profile-compliance (NIST 800-53)' {
        It 'Groups findings by profile tags' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-800-53' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'control-coverage (ISO 27001)' {
        It 'Groups findings by clause number from A.{clause}.{control}' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'iso-27001' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('5','6','7','8') }
        }
    }

    Context 'technique-coverage (MITRE ATT&CK)' {
        It 'Groups findings by tactic via technique-to-tactic map' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'mitre-attack' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'maturity-level (Essential Eight)' {
        It 'Groups findings by maturity level prefix ML{n}' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'essential-eight' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            $result.Groups | ForEach-Object { $_.Key | Should -BeIn @('ML1','ML2','ML3') }
        }
    }

    Context 'maturity-level (CMMC)' {
        It 'Returns groups for L1, L2, L3 levels' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'cmmc' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'criteria-coverage (SOC 2)' {
        It 'Groups findings by exact criteria key (CC6.1, CC7.2, etc.)' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'soc2' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
            # Verify at least one group key matches SOC2 criteria format (CC{n}.{n})
            $hasCcKey = $result.Groups | Where-Object { $_.Key -match '^CC\d+\.\d+$' }
            $hasCcKey | Should -Not -BeNullOrEmpty
        }
    }

    Context 'criteria-coverage (HIPAA)' {
        It 'Groups findings by section extracted before parenthesis' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'hipaa' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'requirement-compliance (PCI DSS)' {
        It 'Groups findings by requirement number' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'pci-dss' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'policy-compliance (CISA SCuBA)' {
        It 'Groups findings by product from second segment of MS.{product}.*' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'cisa-scuba' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'severity-coverage (STIG)' {
        It 'Groups findings by severity category' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'stig' }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Groups | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Edge cases' {
        It 'Returns zero-count GroupedResult when no findings map to framework' {
            $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
            $findings = @([PSCustomObject]@{
                CheckId = 'FAKE-001'; Setting = 'Fake'; Status = 'Pass'
                RiskSeverity = 'Low'; Section = 'Test'; Frameworks = @{}
            })
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped
            $result.Summary.MappedControls | Should -Be 0
        }

        It 'Falls back to control-coverage for unknown scoring method' {
            $fakeFw = @{
                frameworkId = 'test-unknown'; label = 'Test Unknown'; scoringMethod = 'unknown-method'
                totalControls = 10; scoringData = @{}; extraData = @{}; css = 'fw-default'
                filterFamily = 'TEST'; profiles = $null; description = ''; displayOrder = 99
            }
            $findings = @(New-MockFinding -CheckId 'ENTRA-CLOUDADMIN-001')
            $result = Export-FrameworkCatalog -Findings $findings -Framework $fakeFw -ControlRegistry $registry -Mode Grouped -WarningAction SilentlyContinue
            $result | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Integration - all 14 frameworks' {
        It 'Produces valid GroupedResult for every framework' {
            # Use a curated set of CheckIds known to span multiple frameworks
            $checkIds = @(
                'ENTRA-CLOUDADMIN-001', 'CA-MFA-ADMIN-001', 'CA-LEGACYAUTH-001',
                'EXO-AUDIT-001', 'EXO-FORWARD-001', 'DEFENDER-SAFELINK-001',
                'SPO-SHARING-001', 'TEAMS-EXTERNAL-001', 'DNS-SPF-001',
                'ENTRA-PIM-001', 'INTUNE-COMPLIANCE-001', 'POWERBI-GUEST-001',
                'ENTRA-CONSENT-001', 'ENTRA-PASSWORD-001', 'FORMS-PHISHING-001',
                'COMPLIANCE-AUDIT-001', 'CA-MFA-ALL-001', 'DEFENDER-ANTIPHISH-001',
                'PURVIEW-RETENTION-001', 'ENTRA-ADMIN-001'
            ) | Where-Object { $registry.ContainsKey($_) }
            $findings = @($checkIds | ForEach-Object { New-MockFinding -CheckId $_ })

            foreach ($fw in $allFrameworks) {
                $result = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Grouped -WarningAction SilentlyContinue
                $result | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should return a result"
                $result.Groups | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should have groups"
                $result.Summary | Should -Not -BeNullOrEmpty -Because "Framework $($fw.frameworkId) should have summary"
                $result.Summary.TotalControls | Should -BeGreaterThan 0 -Because "Framework $($fw.frameworkId) should have totalControls"
            }
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Export-FrameworkCatalog.Tests.ps1 -Output Detailed"`
Expected: All fail -- `Export-FrameworkCatalog` function not found

- [ ] **Step 3: Implement the scoring engine**

Create `Common/Export-FrameworkCatalog.ps1` with the `Export-FrameworkCatalog` function. The function must:

1. Accept parameters: `-Findings`, `-Framework`, `-ControlRegistry`, `-Mode`, `-OutputPath`, `-TenantName`
2. Build a mapping of findings to this framework by matching `$finding.Frameworks.$($Framework.frameworkId)` or falling back to `$ControlRegistry[$finding.CheckId].frameworks.$($Framework.frameworkId)`
3. Dispatch on `$Framework.scoringMethod` to a private scoring function that returns `GroupedResult`
4. For `-Mode Grouped`, return the `GroupedResult` directly
5. For `-Mode Inline`, pass the `GroupedResult` to an HTML renderer (Task 4)
6. For `-Mode Standalone`, pass to a standalone HTML renderer (Sprint 2)

The scoring dispatch should use a `switch` on `$Framework.scoringMethod`:
- `profile-compliance`: Group by profile keys from `$Framework.profiles`; count findings that have matching profile tags
- `function-coverage`: Split controlId on `.`, take first segment, match against `$Framework.scoringData.functions` keys
- `control-coverage`: For ISO 27001: split `A.{n}.{n}` on `.`, take index 1, match against `$Framework.scoringData.themes` keys. Fallback: first segment before `-` or `.`
- `technique-coverage`: Load `controls/mitre-technique-map.json`, resolve each T-number to a tactic, group by tactic against `$Framework.scoringData.tactics` keys
- `maturity-level`: For Essential Eight: parse `ML{n}-P{n}`, group by `ML{n}` against `$Framework.scoringData.maturityLevels` keys. For CMMC: show cumulative coverage per level's `practiceCount`
- `severity-coverage`: Match against `$Framework.scoringData.categories` keys
- `requirement-compliance`: Split controlId on `.`, take first segment, match against `$Framework.scoringData.requirements` keys
- `criteria-coverage`: For HIPAA: split controlId on `(`, take `[0]`, match against `$Framework.scoringData.criteria` keys. For SOC 2: exact match of each semicolon-split segment
- `policy-compliance`: Split controlId on `.`, take index 1, match against `$Framework.scoringData.products` keys

Each scoring function returns:
```powershell
@{
    Groups = @(
        @{ Key = 'PR'; Label = 'Protect'; Total = 27; Mapped = 12; Passed = 8; Failed = 3; Other = 1; Findings = @(...) }
    )
    Summary = @{ TotalControls = 106; MappedControls = 45; PassRate = 0.72 }
}
```

For unknown `scoring.method`, fall back to `control-coverage` with `Write-Warning`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Export-FrameworkCatalog.Tests.ps1 -Output Detailed"`
Expected: All tests pass

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/ -Output Detailed -PassThru | Select-Object TotalCount,PassedCount,FailedCount"`
Expected: 0 failures, total count increases by ~15

- [ ] **Step 6: Commit**

```bash
git add Common/Export-FrameworkCatalog.ps1 tests/Common/Export-FrameworkCatalog.Tests.ps1
git commit -m "feat: implement framework catalog scoring engine with 9 methods"
```

---

### Task 4: Implement Inline HTML rendering mode

**Files:**
- Modify: `Common/Export-FrameworkCatalog.ps1`
- Test: `tests/Common/Export-FrameworkCatalog.Tests.ps1`

- [ ] **Step 1: Write failing tests for Inline mode**

Add to `tests/Common/Export-FrameworkCatalog.Tests.ps1`:

```powershell
Describe 'Export-FrameworkCatalog - Inline Mode' {
    BeforeAll {
        . "$PSScriptRoot/../../Common/Import-FrameworkDefinitions.ps1"
        . "$PSScriptRoot/../../Common/Export-FrameworkCatalog.ps1"
        $frameworksPath = "$PSScriptRoot/../../controls/frameworks"
        $allFrameworks = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $projectRoot = "$PSScriptRoot/../.."
        $regRaw = Get-Content "$projectRoot/controls/registry.json" -Raw | ConvertFrom-Json
        $registry = @{}
        foreach ($c in $regRaw.checks) { $registry[$c.checkId] = $c }
    }

    It 'Returns HTML string containing framework label' {
        $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
        $checkIds = @($registry.Keys | Select-Object -First 10)
        $findings = @($checkIds | ForEach-Object {
            [PSCustomObject]@{
                CheckId = $_; Setting = "Test $_"; Status = 'Pass'
                RiskSeverity = 'Medium'; Section = 'Identity'
                Frameworks = if ($registry[$_]) { $registry[$_].frameworks } else { @{} }
            }
        })
        $html = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Inline
        $html | Should -BeOfType [string]
        $html | Should -Match 'NIST CSF'
        $html | Should -Match '<details'
        $html | Should -Match 'status-pass|status-fail'
    }

    It 'Returns placeholder message for zero mapped findings' {
        $fw = $allFrameworks | Where-Object { $_.frameworkId -eq 'nist-csf' }
        $findings = @([PSCustomObject]@{
            CheckId = 'FAKE-001'; Setting = 'Fake'; Status = 'Pass'
            RiskSeverity = 'Low'; Section = 'Test'; Frameworks = @{}
        })
        $html = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Inline
        $html | Should -Match 'No assessed findings map to this framework'
    }

    It 'Inline HTML for all 14 frameworks is valid' {
        $checkIds = @($registry.Keys | Select-Object -First 20)
        $findings = @($checkIds | ForEach-Object {
            [PSCustomObject]@{
                CheckId = $_; Setting = "Test $_"; Status = 'Pass'
                RiskSeverity = 'Medium'; Section = 'Identity'
                Frameworks = if ($registry[$_]) { $registry[$_].frameworks } else { @{} }
            }
        })
        foreach ($fw in $allFrameworks) {
            $html = Export-FrameworkCatalog -Findings $findings -Framework $fw -ControlRegistry $registry -Mode Inline -WarningAction SilentlyContinue
            $html | Should -BeOfType [string] -Because "$($fw.frameworkId) should return HTML"
            $html | Should -Match $fw.label -Because "$($fw.frameworkId) HTML should contain its label"
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Export-FrameworkCatalog.Tests.ps1 -Output Detailed"`
Expected: Inline mode tests fail

- [ ] **Step 3: Implement Inline HTML renderer**

In `Export-FrameworkCatalog.ps1`, add the Inline rendering path within the `-Mode Inline` branch. The renderer should:

1. Call the scoring engine to get `GroupedResult`
2. Build a `<details>` block with:
   - Header: `<summary><h3>{fw.label}</h3></summary>` with scoring method badge and overall coverage bar
   - Group breakdown table: one `<tr>` per group showing Key, Label, Mapped/Total, pass rate, mini bar (use framework `colors` from JSON)
   - Findings table: all mapped findings sorted by group, with Status badge, CheckId, Setting, ControlId columns
3. Use same CSS class patterns as `Export-ComplianceOverview.ps1` for consistency (`.status-pass`, `.status-fail`, etc.)
4. If `GroupedResult.Summary.MappedControls == 0`, return a `<details>` block with placeholder message

- [ ] **Step 4: Run tests to verify they pass**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/Common/Export-FrameworkCatalog.Tests.ps1 -Output Detailed"`
Expected: All tests pass

- [ ] **Step 5: Run PSScriptAnalyzer**

Run: `pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path Common/Export-FrameworkCatalog.ps1 -Settings ./PSScriptAnalyzerSettings.psd1"`
Expected: 0 warnings/errors

- [ ] **Step 6: Commit**

```bash
git add Common/Export-FrameworkCatalog.ps1 tests/Common/Export-FrameworkCatalog.Tests.ps1
git commit -m "feat: implement Inline HTML rendering for framework catalogs"
```

---

### Task 5: Integrate catalog into Export-AssessmentReport

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1:1795-1796` (dot-source), `:3727-3728` (HTML insertion)

**Important**: `$html` in `Export-AssessmentReport.ps1` is a **plain string** built with `+=` and here-strings (line 1865 onward), NOT a StringBuilder. The `$complianceHtml` is interpolated at line 3720-3727 via `$html += @"..."@`. Catalog HTML must go immediately after that block.

- [ ] **Step 1: Dot-source the catalog module**

After line 1796 (after the `Export-ComplianceOverview` call), add:

```powershell
# Build framework catalog HTML fragments for per-framework posture pages
$catalogHtml = ''
if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) {
    . (Join-Path -Path $PSScriptRoot -ChildPath 'Export-FrameworkCatalog.ps1')
    $catalogFrameworks = $allFrameworks
    if ($FrameworkFilter -and $FrameworkFilter.Count -gt 0) {
        $catalogFrameworks = @($allFrameworks | Where-Object { $_.filterFamily -in $FrameworkFilter })
    }
    foreach ($fw in $catalogFrameworks) {
        $fwCatalog = Export-FrameworkCatalog -Findings @($allCisFindings) -Framework $fw `
            -ControlRegistry $controlRegistry -Mode Inline
        if ($fwCatalog) { $catalogHtml += $fwCatalog }
    }
}
```

Note: This does NOT gate on `-SkipComplianceOverview` -- catalog pages are independent from the compliance overview table. A user may skip the overview but still want per-framework breakdowns.

- [ ] **Step 2: Insert catalog HTML into the report**

After line 3727 (after the `if ($complianceHtml) { ... }` block closes), add:

```powershell
if ($catalogHtml) {
    $html += $catalogHtml
}
```

- [ ] **Step 2: Run full test suite**

Run: `pwsh -NoProfile -Command "Invoke-Pester tests/ -Output Detailed -PassThru | Select-Object TotalCount,PassedCount,FailedCount"`
Expected: 0 failures

- [ ] **Step 3: Run PSScriptAnalyzer on modified file**

Run: `pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path Common/Export-AssessmentReport.ps1 -Settings ./PSScriptAnalyzerSettings.psd1 | Where-Object Severity -in 'Error','Warning'"`
Expected: 0 warnings/errors

- [ ] **Step 4: Commit**

```bash
git add Common/Export-AssessmentReport.ps1
git commit -m "feat: integrate framework catalog pages into HTML report"
```

---

## Sprint 2: Standalone Mode + Test Coverage

### Task 6: Implement Standalone HTML export mode

**Files:**
- Modify: `Common/Export-FrameworkCatalog.ps1`
- Test: `tests/Common/Export-FrameworkCatalog.Tests.ps1`

- [ ] **Step 1: Write failing tests for Standalone mode**

Add tests that verify Standalone mode writes a complete HTML file with `<!DOCTYPE html>`, embedded CSS, framework label, and group breakdown.

- [ ] **Step 2: Implement Standalone renderer**

The Standalone renderer must:
1. Build a complete HTML document (not fragment) with embedded CSS from the main report's style variables
2. Include a cover page with framework name, assessment date, tenant name
3. Include the same group breakdown + findings tables as Inline mode
4. Write to `-OutputPath` via `Set-Content`
5. Require `-OutputPath` and `-TenantName` parameters (throw if missing when Mode=Standalone)

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: implement Standalone HTML export for framework catalogs"
```

---

### Task 7: Add -FrameworkExport parameter to orchestrator

**Files:**
- Modify: `Invoke-M365Assessment.ps1` (param block: before closing `)` at ~line 181, report section: after ~line 2436)

- [ ] **Step 1: Add parameter to orchestrator**

Add before the closing `)` of the param block (after `$CisBenchmarkVersion` at line 180):

```powershell
[Parameter()]
[ValidateSet('CIS','NIST','ISO','STIG','PCI','CMMC','HIPAA','CISA','SOC2','FedRAMP','Essential8','MITRE','All')]
[string[]]$FrameworkExport
```

Add help text:
```
.PARAMETER FrameworkExport
    Generate standalone per-framework HTML catalog exports. Specify framework
    families or 'All'. Output files are named _<Framework>-Catalog_<tenant>.html.
```

- [ ] **Step 2: Add standalone export logic after report generation**

After the report generation try/catch block closes (~line 2436), add:

```powershell
# ------------------------------------------------------------------
# Framework Catalog standalone exports (optional)
# ------------------------------------------------------------------
if ($FrameworkExport -and $allFrameworks) {
    . (Join-Path -Path $projectRoot -ChildPath 'Common/Export-FrameworkCatalog.ps1')
    $exportFrameworks = $allFrameworks
    if ('All' -notin $FrameworkExport) {
        $exportFrameworks = @($allFrameworks | Where-Object { $_.filterFamily -in $FrameworkExport })
    }
    # Use same fallback pattern as reportParams for tenant name
    $catalogTenantName = if ($script:domainPrefix) { $script:domainPrefix } elseif ($TenantId) { $TenantId } else { 'Unknown' }
    foreach ($fw in $exportFrameworks) {
        $fwFileName = "_$($fw.label -replace '[^a-zA-Z0-9]','-')-Catalog${summarySuffix}.html"
        $fwPath = Join-Path -Path $assessmentFolder -ChildPath $fwFileName
        Export-FrameworkCatalog -Findings @($allCisFindings) -Framework $fw `
            -ControlRegistry $controlRegistry -Mode Standalone `
            -OutputPath $fwPath -TenantName $catalogTenantName
        Write-AssessmentLog -Level INFO -Message "Framework catalog exported: $fwFileName" -Section 'Report'
    }
}
```

- [ ] **Step 3: Run full test suite**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add -FrameworkExport parameter for standalone catalog exports"
```

---

### Task 8: Implement Grouped mode for XLSX consumption

**Files:**
- Modify: `Common/Export-FrameworkCatalog.ps1` (Grouped mode already returns GroupedResult from Task 3)
- Modify: `Common/Export-ComplianceMatrix.ps1` (optional second sheet)

- [ ] **Step 1: Verify Grouped mode works** (should already work from Task 3)
- [ ] **Step 2: Add optional "Grouped by Framework" XLSX sheet**

In `Export-ComplianceMatrix.ps1`, after the existing two sheets are created, add a third sheet that groups findings by the CIS M365 framework's native structure (profile-compliance grouping). This is a fixed scope -- per-framework sheet selection is deferred to a future issue.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add grouped-by-framework XLSX sheet to compliance matrix"
```

---

### Task 9: CI improvements (#183, #184, #185, #186)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Modify: `README.md` (coverage badge)

These are independent infrastructure items. See issues #183-186 for details. Each gets its own commit:

- [ ] **Step 1: #183 - Add workflow_dispatch + weekly cron to sync-checkid**
- [ ] **Step 2: #184 - Create release automation workflow**
- [ ] **Step 3: #185 - Integrate code coverage badge**
- [ ] **Step 4: #186 - Document standalone script roles**
- [ ] **Step 5: Commit each separately**

---

### Task 10: Pester tests for reporting collectors (#180, #181, #182)

**Files:**
- Create: `tests/Entra/Get-InactiveUsers.Tests.ps1` (and 8 more Entra test files)
- Create: `tests/Exchange-Online/Get-MailboxPermissionReport.Tests.ps1` (and 3 more EXO test files)
- Create: `tests/Inventory/Get-GroupInventory.Tests.ps1` (and 3 more Inventory test files)

Follow the existing mock-based pattern from `tests/Entra/Get-EntraSecurityConfig.Tests.ps1`:
- Mock all Graph/EXO API calls
- Verify output structure (column names, data types)
- Verify pass/fail logic with known inputs
- Test edge cases (empty results, API errors)

Each collector test file gets its own commit:

- [ ] **Step 1: #180 - Write tests for 9 Entra reporting collectors**
- [ ] **Step 2: #181 - Write tests for 4 EXO reporting collectors**
- [ ] **Step 3: #182 - Write tests for 4 Inventory collectors**
- [ ] **Step 4: Run full suite, verify all pass**

---

## Verification Checklist

After all tasks are complete:

- [ ] `pwsh -NoProfile -Command "Invoke-Pester tests/ -Output Detailed"` -- all pass, 0 failures
- [ ] `pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path . -Settings ./PSScriptAnalyzerSettings.psd1 -Recurse | Where-Object { $_.ScriptName -notlike '*.Tests.ps1' -and $_.Severity -in 'Error','Warning' }"` -- 0 warnings/errors
- [ ] All 14 frameworks produce valid Inline HTML in report
- [ ] `-FrameworkExport All` generates 14 standalone HTML files
- [ ] `-FrameworkExport NIST` generates NIST CSF + NIST 800-53 standalone files
- [ ] Grouped mode returns valid GroupedResult for all 14 frameworks
- [ ] MITRE technique map covers all technique IDs in registry
- [ ] No duplicate CheckIds across collectors
