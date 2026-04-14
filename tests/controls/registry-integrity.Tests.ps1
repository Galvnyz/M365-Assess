Describe 'Control Registry Integrity' {
    BeforeAll {
        $registryPath = "$PSScriptRoot/../../src/M365-Assess/controls/registry.json"
        $raw = Get-Content -Path $registryPath -Raw | ConvertFrom-Json
        $checks = $raw.checks
    }

    It 'Has at least 139 entries (matching CIS benchmark count)' {
        $checks.Count | Should -BeGreaterOrEqual 139
    }

    It 'Has no duplicate CheckIds' {
        $ids = $checks | ForEach-Object { $_.checkId }
        $dupes = $ids | Group-Object | Where-Object { $_.Count -gt 1 }
        $dupes | Should -BeNullOrEmpty -Because "CheckIds must be unique"
    }

    It 'Every entry has required fields' {
        foreach ($check in $checks) {
            $check.checkId | Should -Not -BeNullOrEmpty
            $check.name | Should -Not -BeNullOrEmpty
            # frameworks must be declared (not $null); empty {} is allowed for local
            # extension checks that are pending upstream CheckID framework mapping
            $check.frameworks | Should -Not -Be $null -Because "$($check.checkId) must declare a frameworks property"
        }
    }

    It 'CIS-mapped entries have valid CIS framework data' {
        $cisMapped = $checks | Where-Object { $_.frameworks.'cis-m365-v6' }
        $cisMapped.Count | Should -BeGreaterOrEqual 139 -Because "at least 139 CIS benchmark controls exist"
        foreach ($check in $cisMapped) {
            $check.frameworks.'cis-m365-v6'.controlId | Should -Not -BeNullOrEmpty `
                -Because "$($check.checkId) has CIS mapping and needs a controlId"
        }
    }

    It 'All automated checks have a collector field' {
        $automated = $checks | Where-Object { $_.hasAutomatedCheck -eq $true }
        foreach ($check in $automated) {
            $check.collector | Should -Not -BeNullOrEmpty `
                -Because "$($check.checkId) is automated and needs a collector"
        }
    }

    It 'CheckId format matches convention {COLLECTOR}-{AREA}-{NNN} for automated checks' {
        $automated = $checks | Where-Object { $_.hasAutomatedCheck -eq $true }
        foreach ($check in $automated) {
            $check.checkId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}$' `
                -Because "$($check.checkId) must follow naming convention"
        }
    }

    It 'SOC 2 mappings exist for checks that have NIST 800-53 AC/AU/IA/SC/SI families' {
        $nistFamilies = @('AC-', 'AU-', 'IA-', 'SC-', 'SI-')
        $automated = $checks | Where-Object { $_.hasAutomatedCheck -eq $true }
        foreach ($check in $automated) {
            $nist = $check.frameworks.'nist-800-53'
            if ($nist -and $nist.controlId) {
                $matchesFamily = $nistFamilies | Where-Object {
                    $nist.controlId -like "$_*"
                }
                if ($matchesFamily) {
                    $check.frameworks.soc2 | Should -Not -BeNullOrEmpty `
                        -Because "$($check.checkId) maps to NIST $($nist.controlId) which should have SOC 2 mapping"
                }
            }
        }
    }
}
