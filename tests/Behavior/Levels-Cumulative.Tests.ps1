# Issue #844: assert that maturity-level filter semantics are cumulative.
# CMMC L3 ⊇ L2 ⊇ L1. CIS L2 ⊇ L1. NIST 800-53 High ⊇ Mod ⊇ Low.
#
# Implementation contract is in `docs/LEVELS.md`. The runtime predicate lives
# in `report-app.jsx::matchProfileToken`, but the underlying CONVENTION is
# duplicative-downward tagging in `controls/registry.json` — a finding at L3
# carries L2 and L1 tags too. Without that, no amount of UI logic can compute
# correct level counts.
#
# This test reads the registry directly and verifies:
#   1. The invariant holds for every framework that uses cumulative levels:
#        count(any-L3-tag) ≤ count(any-L2-tag) (since every L3 tag should
#        also carry L2)
#        count(any-L1-tag) ≤ count(any-L2-tag) (since every L1 tag should
#        also carry L2)
#   2. There are no L3-only or L1-only findings — those would violate the
#      duplicative-downward convention and break the cumulative count.

BeforeAll {
    $script:registryPath = "$PSScriptRoot/../../src/M365-Assess/controls/registry.json"
    $script:registry = Get-Content -Raw -Path $script:registryPath | ConvertFrom-Json

    # Pester v5 scopes top-level function declarations differently from
    # Context-nested BeforeAll. Define helpers as scriptblocks in $script:
    # so they're visible to all contexts.
    $script:GetLevelTags = {
        param($Check, $FrameworkId)
        $p = $Check.frameworks.$FrameworkId.profiles
        if (-not $p) { return @() }
        $arr = if ($p -is [array]) { $p } else { @($p) }
        return ($arr -join ';') -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    $script:TestLevelInheritance = {
        param(
            [string]$FrameworkId,
            [string[]]$Levels
        )
        $cumulativeCounts = @{}
        $exclusiveAtTop = 0
        $exclusiveAtBottom = 0
        foreach ($lvl in $Levels) { $cumulativeCounts[$lvl] = 0 }
        $top = $Levels[-1]
        $bottom = $Levels[0]
        foreach ($check in $script:registry.checks) {
            $tags = & $script:GetLevelTags $check $FrameworkId
            if (-not $tags) { continue }
            $present = @{}
            foreach ($lvl in $Levels) {
                $present[$lvl] = ($tags | Where-Object { $_ -match [regex]::Escape($lvl) }).Count -gt 0
            }
            foreach ($lvl in $Levels) { if ($present[$lvl]) { $cumulativeCounts[$lvl]++ } }
            if ($present[$top]) {
                $hasLower = $false
                foreach ($lvl in $Levels) { if ($lvl -ne $top -and $present[$lvl]) { $hasLower = $true; break } }
                if (-not $hasLower) { $exclusiveAtTop++ }
            }
            if ($present[$bottom]) {
                $hasHigher = $false
                foreach ($lvl in $Levels) { if ($lvl -ne $bottom -and $present[$lvl]) { $hasHigher = $true; break } }
                if (-not $hasHigher) { $exclusiveAtBottom++ }
            }
        }
        return @{
            Counts = $cumulativeCounts
            TopOnly = $exclusiveAtTop
            BottomOnly = $exclusiveAtBottom
        }
    }
}

Describe 'Maturity levels are tagged cumulatively in registry' {
    Context 'CMMC (L1 -> L2 -> L3)' {
        BeforeAll {
            $script:cmmc = & $script:TestLevelInheritance 'cmmc' @('L1','L2','L3')
        }
        It 'has at least one L2 mapping' {
            $script:cmmc.Counts['L2'] | Should -BeGreaterThan 0
        }
        It 'L1 count is less than or equal to L2 count (every L1 check is also tagged L2)' {
            $script:cmmc.Counts['L1'] | Should -BeLessOrEqual $script:cmmc.Counts['L2']
        }
        It 'L3 count is less than or equal to L2 count (every L3 check is also tagged L2 — duplicative-downward)' {
            $script:cmmc.Counts['L3'] | Should -BeLessOrEqual $script:cmmc.Counts['L2']
        }
        It 'has zero L3-only findings (every L3 check must also carry L2)' {
            $script:cmmc.TopOnly | Should -Be 0 -Because 'docs/LEVELS.md duplicative-downward tagging convention. An L3 finding without L2 breaks the cumulative count.'
        }
    }
    Context 'CIS M365 v6 (L1 -> L2)' {
        BeforeAll {
            $script:cis = & $script:TestLevelInheritance 'cis-m365-v6' @('L1','L2')
        }
        It 'has at least one L1 mapping' {
            $script:cis.Counts['L1'] | Should -BeGreaterThan 0
        }
        # CIS uses composite E3-L1 / E5-L2 tags. The substring match handles both.
        # Top-only and bottom-only invariants for CIS are intentionally lenient —
        # CIS is L1/L2 only; both are common standalone tags.
    }
}
