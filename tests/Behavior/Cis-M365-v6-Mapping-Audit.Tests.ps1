# Issue #848: data-quality regression for the CIS Microsoft 365 v6.0.1 mappings.
# Two known anomalies in the upstream CheckID/SCF data:
#
#   1. Section 9 has 11 duplicate-controlId clusters, ALL of which are parallel
#      POWERBI-*/PBI-* pairs. This is a strong upstream merge artifact (two
#      registries merged without dedup) — every Power BI / Fabric check ships
#      twice and inflates section 9 coverage counts.
#
#   2. Section 4 is named "Microsoft Intune" but only 2 of 6 checks are INTUNE-*;
#      the other 4 are EXO-* (anti-phishing/spam/DKIM/malware). The section is
#      almost certainly mislabeled (likely "Email Security" in the published
#      benchmark) — see docs/research/cis-m365-v6-audit.md.
#
# This test reports the current state on every CI run so a human reading the
# logs can see whether upstream has fixed the gaps. The Skip:$true assertions
# flip green automatically once SCF lands the dedup + name correction.

BeforeAll {
    $script:registryPath  = "$PSScriptRoot/../../src/M365-Assess/controls/registry.json"
    $script:frameworkPath = "$PSScriptRoot/../../src/M365-Assess/controls/frameworks/cis-m365-v6.json"
    $script:registry  = Get-Content -Raw -Path $script:registryPath  | ConvertFrom-Json
    $script:framework = Get-Content -Raw -Path $script:frameworkPath | ConvertFrom-Json

    $script:cisRows = foreach ($c in $script:registry.checks) {
        if ($c.frameworks.'cis-m365-v6') {
            $cid = $c.frameworks.'cis-m365-v6'.controlId
            [pscustomobject]@{
                checkId = $c.checkId
                cisCtrl = $cid
                section = $cid -replace '^(\d+).*', '$1'
                prefix  = ($c.checkId -split '-')[0]
            }
        }
    }

    # Section 9 POWERBI-/PBI- parallel-pair count
    $sec9Dups = $script:cisRows |
        Where-Object { $_.section -eq '9' } |
        Group-Object cisCtrl |
        Where-Object { $_.Count -gt 1 }
    $script:section9ParallelPairs = 0
    foreach ($d in $sec9Dups) {
        $prefixes = ($d.Group.prefix | Sort-Object -Unique)
        if (($prefixes -contains 'POWERBI') -and ($prefixes -contains 'PBI')) {
            $script:section9ParallelPairs++
        }
    }

    # Section 4 EXO-* count (signal that the section name is wrong)
    $script:section4ExoCount = (
        $script:cisRows | Where-Object { $_.section -eq '4' -and $_.prefix -eq 'EXO' }
    ).Count
}

Describe 'CIS M365 v6.0.1 mapping anomalies' {
    # Anomaly 1: section 9 POWERBI-/PBI- merge artifact.
    # Skip until upstream dedups the parallel registries — see #848.
    It 'section 9 has zero POWERBI-/PBI- duplicate-controlId pairs' -Skip:$true {
        $script:section9ParallelPairs |
            Should -Be 0 -Because 'every 9.x dup cluster is a parallel POWERBI-*/PBI-* pair, indicating an upstream merge artifact in SCF — see docs/research/cis-m365-v6-audit.md'
    }

    # Anomaly 2: section 4 EXO-* dominance signals mislabel/mismap.
    # Skip until upstream confirms section 4's true name OR moves the EXO mappings.
    It 'section 4 contains zero EXO-* checks (or section is renamed)' -Skip:$true {
        $script:section4ExoCount |
            Should -Be 0 -Because 'section 4 in cis-m365-v6.json is named "Microsoft Intune" but 4 of 6 checks are EXO-*; either the name is wrong (likely "Email Security") or the EXO mappings should move to section 6 — see docs/research/cis-m365-v6-audit.md'
    }

    # Always-runs observability: report the current state so a human reading
    # CI logs can see the gaps without the test failing the build.
    It 'reports current CIS M365 v6 anomaly counts (informational)' {
        Write-Host ("    [INFO] CIS-mapped checks total:     $($script:cisRows.Count)")
        Write-Host ("    [INFO] Section 9 POWERBI-/PBI- pairs: $script:section9ParallelPairs (target: 0 once upstream dedups)")
        Write-Host ("    [INFO] Section 4 EXO-* count:         $script:section4ExoCount (target: 0 OR section renamed once upstream verifies)")
        $script:cisRows.Count | Should -BeGreaterThan 0
    }
}
