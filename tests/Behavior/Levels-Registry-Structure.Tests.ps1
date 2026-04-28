# Issue #844: structural assertions about level/profile tags in the registry.
#
# This test does NOT assert any cumulative or inheritance relationship
# between levels (L1 ⊆ L2, etc.). Per docs/LEVELS.md, those relationships
# are NOT universal across frameworks (CMMC L2 isn't always a superset
# of L1; CIS L2 sometimes replaces L1 controls; NIST baselines differ
# per tier). The previous version of this test asserted L1 ≤ L2 ≤ L3 and
# was rejected as encoding a wrong model — the registry's per-check
# designations must be respected as-authored.
#
# What it DOES assert:
#   - The registry is well-formed (every framework key resolves; profile
#     tags are non-empty strings).
#   - Maturity-level frameworks have at least some content under each
#     level they declare (catches a sync regression that wipes a level).
#   - License-tier (CIS) tags use the documented `<licenseTier>-<level>`
#     composite shape (e.g. `E3-L1`, `E5-L2`), so the substring match
#     in matchProfileToken keeps working.

BeforeAll {
    $script:registryPath = "$PSScriptRoot/../../src/M365-Assess/controls/registry.json"
    $script:registry = Get-Content -Raw -Path $script:registryPath | ConvertFrom-Json

    $script:CollectTags = {
        param($FrameworkId)
        $all = New-Object System.Collections.Generic.List[string]
        foreach ($check in $script:registry.checks) {
            $p = $check.frameworks.$FrameworkId.profiles
            if (-not $p) { continue }
            $arr = if ($p -is [array]) { $p } else { @($p) }
            foreach ($entry in $arr) {
                foreach ($tag in (($entry -split ';') | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
                    $all.Add($tag)
                }
            }
        }
        return $all
    }
}

Describe 'Registry profile-tag structure' {
    Context 'CMMC' {
        BeforeAll {
            $script:cmmcTags = & $script:CollectTags 'cmmc'
        }
        It 'has at least one profile tag (registry not empty for CMMC)' {
            $script:cmmcTags.Count | Should -BeGreaterThan 0
        }
        It 'every CMMC tag is one of the documented values' {
            $expected = @('L1','L2','L3')
            $unexpected = $script:cmmcTags | Where-Object { $_ -notin $expected } | Select-Object -Unique
            $unexpected | Should -BeNullOrEmpty -Because "CMMC profiles in registry should be L1/L2/L3 only; saw: $($unexpected -join ', ')"
        }
        It 'every documented level has at least one tag (none zeroed out)' {
            foreach ($level in @('L1','L2','L3')) {
                ($script:cmmcTags | Where-Object { $_ -eq $level }).Count | Should -BeGreaterThan 0 -Because "level $level has zero tags in registry"
            }
        }
    }
    Context 'CIS M365 v6' {
        BeforeAll {
            $script:cisTags = & $script:CollectTags 'cis-m365-v6'
        }
        It 'has at least one profile tag' {
            $script:cisTags.Count | Should -BeGreaterThan 0
        }
        It 'every CIS tag matches the documented composite shape <licenseTier>-<level>' {
            $expected = @('E3-L1','E3-L2','E5-L1','E5-L2')
            $unexpected = $script:cisTags | Where-Object { $_ -notin $expected } | Select-Object -Unique
            $unexpected | Should -BeNullOrEmpty -Because "CIS profiles should be E3-L1/E3-L2/E5-L1/E5-L2; saw: $($unexpected -join ', ')"
        }
        It 'each license tier has both L1 and L2 entries (none missing)' {
            foreach ($tier in @('E3','E5')) {
                foreach ($level in @('L1','L2')) {
                    $tag = "$tier-$level"
                    ($script:cisTags | Where-Object { $_ -eq $tag }).Count | Should -BeGreaterThan 0 -Because "tag $tag is absent from registry"
                }
            }
        }
    }
}
