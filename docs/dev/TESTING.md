# Testing

Practical guide for running M365 Assess tests locally and understanding the CI gates.

---

## Quick start

```powershell
# All tests
pwsh -NoProfile -Command "Invoke-Pester -Path './tests' -Output Detailed"

# A specific domain
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Entra' -Output Detailed"

# A specific test file
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Common/Build-ReportData.Tests.ps1' -Output Detailed"
```

Tests assume **PowerShell 7.4+** and **Pester 5.x**. Pester is auto-installed in CI; for local runs:

```powershell
Install-Module -Name Pester -MinimumVersion 5.0.0 -Scope CurrentUser
```

---

## Test layout

```
tests/
├── Common/                    Tests for Common/ helpers (Build-ReportData, Connect-Service, etc.)
├── Consistency/               Manifest + FileList drift gates
├── controls/                  Control registry + framework JSON validation
├── Entra/                     Entra collector tests
├── Exchange-Online/           EXO collector tests
├── Intune/                    Intune collector tests
├── Orchestrator/              Orchestrator helpers (Test-GraphPermissions, baselines)
├── Purview/                   Purview collector tests
├── Security/                  Defender + DLP + Stryker tests
├── SOC2/                      SOC 2 evidence collector tests
├── Setup/                     Grant-M365AssessConsent + connection profile tests
└── Smoke/                     Fast-running gates (collector read-only, manifest, PSGallery)
```

Mirror the `src/M365-Assess/<Domain>/` structure under `tests/<Domain>/`.

---

## Conventions

### Naming

- Test files: `<ScriptName>.Tests.ps1` (e.g., `Get-LicenseReport.Tests.ps1`)
- `Describe` block = script or function name
- `Context` block = scenario, prefixed with "when": `Context 'when given a valid tenant'`
- `It` block = expected behavior, prefixed with "should": `It 'should return the SKU summary'`

### Loading the script under test

```powershell
BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Entra/Get-LicenseReport.ps1')
}
```

For collectors that depend on `Common/` helpers, dot-source those first:

```powershell
BeforeAll {
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/SecurityConfigHelper.ps1')
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Common/Connect-Service.ps1')
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Entra/Get-EntraSecurityConfig.ps1')
}
```

### Mocking external services

Mock Graph, EXO, Purview, and Power BI cmdlets. **Never make real API calls in tests.**

```powershell
Mock Get-MgUser { return @{ DisplayName = 'Test User'; UserPrincipalName = 'test@contoso.com' } }
Mock Connect-MgGraph { } -ParameterFilter { $true }
```

Verify with `Should -Invoke` (Pester 5.x) — not the legacy v4 `Assert-MockCalled`.

For Pester's `Mock` to register, the target command must exist in scope. CI runners only install PSScriptAnalyzer + Pester explicitly — Microsoft.Graph + EXO + PowerBI may be missing. Stub-define them when needed:

```powershell
BeforeAll {
    if (-not (Get-Command Connect-MgGraph -ErrorAction SilentlyContinue)) {
        function global:Connect-MgGraph { param() }
    }
    Mock Connect-MgGraph { }
}

AfterAll {
    Remove-Item -Path 'function:global:Connect-MgGraph' -ErrorAction SilentlyContinue
}
```

### Filtering by Setting, not CheckId

Stored CheckId is sub-numbered (`ENTRA-MFA-001.1`, `.2`, `.3`). When asserting on a specific check, filter by the human-readable `Setting` field:

```powershell
$check = $settings | Where-Object { $_.Setting -eq 'MFA Required for All Users' }
$check.Status | Should -Be 'Pass'
```

---

## Fixtures (post-D5)

Mocked Graph/EXO fixture tests live under `tests/Fixtures/` once D5 #789 ships. Pattern: per-collector tests feed checked-in JSON snapshots into mocked Graph/EXO calls and assert Status + Setting + Evidence outcomes.

```
tests/Fixtures/
├── Graph/
│   ├── empty-tenant.json
│   ├── normal-tenant.json
│   ├── missing-permission.json
│   └── throttled.json
├── Exchange/
├── Intune/
└── Reports/                 Full-tenant snapshots for end-to-end report tests
```

`tests/Fixtures/` is line-ending-stable per the repo's `.gitattributes` so cross-platform CI doesn't see false drift.

---

## Coverage gate

The CI line-coverage threshold is **65%** (`COVERAGE_THRESHOLD: 65` in `.github/workflows/ci.yml`). Run locally:

```powershell
$config = New-PesterConfiguration
$config.Run.Path                = './tests'
$config.CodeCoverage.Enabled    = $true
$config.CodeCoverage.Path       = @('./src/M365-Assess/Common/', './src/M365-Assess/Entra/', '...')
$config.CodeCoverage.OutputPath = './coverage.xml'
$config.CodeCoverage.OutputFormat = 'JaCoCo'
Invoke-Pester -Configuration $config
```

CI gates fail the PR when line coverage drops below 65%. The gate doesn't auto-bump — raising it is a deliberate decision documented in CHANGELOG.

### Why 65%

Line coverage is a noisy metric on PowerShell modules dominated by external service calls. The 65% gate catches catastrophic regressions without forcing brittle "test the wrapper" coverage that adds little real safety. The complementary `tests/Behavior/` (post-C5 #784) tracks targeted behavioral coverage in a separate counter so the line-coverage number stays meaningful.

---

## Behavioral tests (post-C5)

Once C5 #784 ships, `tests/Behavior/` will hold high-leverage assertions that don't always show up in line coverage:

- `Permission-Map-Consistency.Tests.ps1` — every section in `AssessmentMaps.SectionScopeMap` has a populated scope list
- `Status-Normalization.Tests.ps1` — every collector emits valid Status values from `Add-Setting`'s ValidateSet
- `Check-Id-Uniqueness.Tests.ps1` — no duplicate base CheckIds in `controls/registry.json`
- `Report-Math.Tests.ps1` — `Pass% = Pass / (Pass + Fail + Warning)` everywhere (#802 doc rule)
- `Baseline-Drift.Tests.ps1` — drift comparison handles renamed/removed/added checks
- `QuickScan-Filter.Tests.ps1` — `-QuickScan` returns the documented subset
- `Cloud-Env-Mapping.Tests.ps1` — sovereign cloud env strings resolve to correct endpoints
- `Module-Compat-Downgrade.Tests.ps1` — required-vs-optional module behavior on missing/wrong version

CI surfaces a `behavior-tests` count separately from line-coverage so each is meaningful on its own.

---

## Cross-platform smoke (post-B6)

`B6 #777` adds a `cross-platform-smoke` CI job running on `ubuntu-latest` and `macos-latest`. The job runs `tests/Smoke/Cross-Platform.Tests.ps1`, which exercises the parts of the module that don't require the Microsoft.Graph SDK:

- Manifest parses via `Import-PowerShellDataFile` on the current platform
- `FileList` entries resolve case-correctly on Linux (case-sensitive filesystem)
- `Import-ControlRegistry` + `Import-FrameworkDefinitions` succeed
- `SecurityConfigHelper` contract works (Initialize / Add-SecuritySetting)
- `Build-ReportDataJson` produces a well-formed `window.REPORT_DATA = {...};` from synthetic findings

Local equivalent:

```bash
pwsh -NoProfile -Command "Invoke-Pester -Path './tests/Smoke/Cross-Platform.Tests.ps1' -Output Detailed"
```

The smoke lane is **advisory initially** — it runs on every PR and shows a check, but is not part of the `ci-status` aggregator that drives branch protection. Promote it to required by adding to `ci-status.needs` after one stable green run.

It deliberately skips `Import-Module ./src/M365-Assess` and `Test-ModuleManifest` because those would require installing the entire Microsoft.Graph SDK + EXO + Purview module set on each platform (5–10 minutes per OS). Pester-on-Windows remains the source of truth for full integration; this lane just catches platform-shaped bugs (path separators, case-sensitivity in dot-source paths, line endings).

---

## Testing the HTML report locally

To verify report rendering without a live tenant:

```bash
# Build a swap-in test HTML using the existing sample report's REPORT_DATA + your latest JSX
(head -n 21202 docs/sample-report/_Example-Report.html; \
 cat src/M365-Assess/assets/report-app.js; \
 tail -n +24526 docs/sample-report/_Example-Report.html) > _test.html
```

Then open `_test.html` in a browser. DevTools console should be clean. The "live test report before merging" rule in this project's `.claude/rules/` requires this for any PR touching `report-app.js`/`.jsx`/CSS.

After:

```powershell
Remove-Item ./_test.html
```

---

## Linting

```powershell
pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path '.' -Recurse -Severity Warning -ExcludePath '.claude'"
```

CI runs PSScriptAnalyzer with `-Settings ./PSScriptAnalyzerSettings.psd1`. Severity Warning + Error fail the build; Information rules are advisory.

Per-file:

```powershell
Invoke-ScriptAnalyzer -Path ./src/M365-Assess/Common/SecurityConfigHelper.ps1 -Settings ./PSScriptAnalyzerSettings.psd1
```

---

## CI gate summary

| Job | Triggers | What it checks |
|---|---|---|
| **Detect Changes** | Always | Routes between `code` (src/tests/workflow) and `docs` (md/json) filters |
| **Quality Gates** | `code` | PSScriptAnalyzer, JS build (`npm run build`), Smoke tests, Permissions matrix in sync, Version consistency |
| **Pester Tests (PS 7.4 + 7.6)** | `code` | Full Pester run with code coverage gate |
| **Docs Gates** | `docs` only (when `code` doesn't match) | Lightweight version-consistency on doc-only PRs |
| **CodeQL** | `code` | Semantic security analysis (JS + Actions) |
| **CI status** | All | Aggregator; main branch protection requires `CI` to pass |

The full Pester suite typically runs in ~3-4 minutes on CI; the docs lane finishes in ~30 seconds.

---

## Common test patterns

### Parameterized tests (Pester 5.x)

```powershell
It 'should accept <Status> as a valid status' -ForEach @(
    @{ Status = 'Pass' }
    @{ Status = 'Fail' }
    @{ Status = 'NotApplicable' }
) {
    { Add-SecuritySetting -Status $Status ... } | Should -Not -Throw
}
```

### Asserting Pass% denominators

```powershell
$pass = ($settings | Where-Object Status -eq 'Pass').Count
$fail = ($settings | Where-Object Status -eq 'Fail').Count
$warn = ($settings | Where-Object Status -eq 'Warning').Count
$pct  = if (($pass + $fail + $warn) -gt 0) { [math]::Round(100 * $pass / ($pass + $fail + $warn), 1) } else { 0 }
$pct | Should -Be 46.2
```

(Per `docs/CHECK-STATUS-MODEL.md`'s denominator rule.)

---

## Related

- `.claude/rules/pester.md` — internal Pester conventions for AI-assisted contributors
- [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — status semantics tested by `Status-Normalization.Tests.ps1`
- [`PERMISSIONS.md`](../reference/PERMISSIONS.md) — section-to-scope map tested by `Permission-Map-Consistency.Tests.ps1`
- [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md) — version-consistency gate referenced above
