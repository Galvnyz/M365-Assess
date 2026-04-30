# Issue #884: lock-down regression preventing silent growth in Review /
# Unknown / Skipped status emissions across collectors. The full audit
# catalogue + classification framework lives at
# docs/research/review-status-audit.md.
#
# When a contributor adds a new emission site, this test fails, forcing
# them to:
#   1. Justify the new emission in the PR description (genuine limitation
#      vs. collector bug?)
#   2. Add the new site to the audit catalogue in
#      docs/research/review-status-audit.md
#   3. Raise the ceiling in this test
#
# Without this guardrail, "I couldn't measure it, returning Review"
# silently accumulates and erodes the report's credibility.
#
# Ceiling values are the snapshot taken 2026-04-30. Adjust ONLY when
# the audit doc has been updated to reflect the new state.

BeforeAll {
    $script:srcRoot = "$PSScriptRoot/../../src/M365-Assess"
    $script:emissionPattern = "Status\s*=\s*'(Review|Unknown|Skipped)'"

    $script:emissions = Get-ChildItem -Path $script:srcRoot -Recurse -Filter '*.ps1' |
        Select-String -Pattern $script:emissionPattern |
        ForEach-Object {
            if ($_.Line -match "'(Review|Unknown|Skipped)'") {
                [pscustomobject]@{
                    File   = $_.Path
                    Line   = $_.LineNumber
                    Status = $Matches[1]
                }
            }
        }

    $script:counts = @{
        Review  = ($script:emissions | Where-Object Status -EQ 'Review').Count
        Skipped = ($script:emissions | Where-Object Status -EQ 'Skipped').Count
        Unknown = ($script:emissions | Where-Object Status -EQ 'Unknown').Count
    }
}

Describe 'Review/Unknown/Skipped emission count lock-down (#884)' {
    # Ceiling values capture the audited state as of 2026-04-30. Raising
    # these requires a corresponding entry in docs/research/review-status-
    # audit.md classifying the new emission as genuine-limitation vs.
    # collector-bug.

    It "Review emissions stay at or below the audited ceiling (68)" {
        $script:counts.Review |
            Should -BeLessOrEqual 68 -Because 'a new Review emission was added without updating docs/research/review-status-audit.md — see issue #884'
    }

    It "Skipped emissions stay at or below the audited ceiling (28)" {
        $script:counts.Skipped |
            Should -BeLessOrEqual 28 -Because 'a new Skipped emission was added without updating docs/research/review-status-audit.md — see issue #884'
    }

    It "Unknown emissions stay at or below the audited ceiling (1)" {
        $script:counts.Unknown |
            Should -BeLessOrEqual 1 -Because 'a new Unknown emission was added without updating docs/research/review-status-audit.md — see issue #884'
    }

    It 'reports current emission counts for visibility (informational)' {
        Write-Host ("    [INFO] Review:  $($script:counts.Review) / 68")
        Write-Host ("    [INFO] Skipped: $($script:counts.Skipped) / 28")
        Write-Host ("    [INFO] Unknown: $($script:counts.Unknown) / 1")
        Write-Host ("    [INFO] Total:   $($script:emissions.Count)")
        $script:emissions.Count | Should -BeGreaterThan 0
    }
}
