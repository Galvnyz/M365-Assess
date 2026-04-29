# Issue #858: data-quality regression for the ISO 27001 vs ISO 27002 mapping
# conflation. Today the registry tags every check identically against both
# frameworks, which misrepresents the standards (27001 = certification target,
# 27002 = implementation guidance — not 1:1 substitutable).
#
# Per docs/research/iso-27001-vs-27002-audit.md, the fix needs to land
# upstream in CheckID + SCF data. This test asserts the corrected state and
# is therefore -Skip:$true today, with -Pending tracking the actual outcome.
# When the upstream sync lands a registry where the two mappings diverge,
# remove the -Skip and the test should pass on its own.

BeforeAll {
    $script:registryPath = "$PSScriptRoot/../../src/M365-Assess/controls/registry.json"
    $script:registry = Get-Content -Raw -Path $script:registryPath | ConvertFrom-Json

    # Compute current divergence so the It below is data-driven.
    $script:totalBoth   = 0
    $script:totalSameId = 0
    $script:totalDiffId = 0
    foreach ($check in $script:registry.checks) {
        $a = $check.frameworks.'iso-27001'
        $b = $check.frameworks.'iso-27002'
        if ($a -and $b) {
            $script:totalBoth++
            if ($a.controlId -eq $b.controlId) { $script:totalSameId++ }
            else { $script:totalDiffId++ }
        }
    }
}

Describe 'ISO 27001 vs ISO 27002 mappings have diverged from 1:1' {
    # Issue #858: this test is INTENTIONALLY skipped today. The 1:1 conflation
    # is a known data-quality gap waiting on upstream CheckID/SCF fix. Once
    # upstream lands, remove -Skip and this test should immediately pass.
    It 'at least one check has a different controlId between the two frameworks' -Skip:$true {
        $script:totalDiffId | Should -BeGreaterThan 0 -Because 'iso-27001 and iso-27002 are different documents and the M365 hardening checks should not all map identically — see docs/research/iso-27001-vs-27002-audit.md'
    }

    # Always-runs observability: report the current state so a human reading
    # CI logs can see the gap without the test failing the build.
    It 'reports current ISO 27001 vs 27002 mapping divergence (informational)' {
        Write-Host ("    [INFO] Both-mapped checks: $script:totalBoth")
        Write-Host ("    [INFO] Identical controlId:  $script:totalSameId")
        Write-Host ("    [INFO] Different controlId:  $script:totalDiffId  (target: > 0 once upstream fix lands)")
        $script:totalBoth | Should -BeGreaterThan 0
    }
}
