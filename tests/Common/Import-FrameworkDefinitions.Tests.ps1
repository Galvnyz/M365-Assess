Describe 'Import-FrameworkDefinitions' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Import-FrameworkDefinitions.ps1"
        $frameworksPath = "$PSScriptRoot/../../src/M365-Assess/controls/frameworks"
    }

    It 'Returns an array sorted by displayOrder' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $result | Should -Not -BeNullOrEmpty
        for ($i = 1; $i -lt $result.Count; $i++) {
            $result[$i].displayOrder | Should -BeGreaterOrEqual $result[$i - 1].displayOrder
        }
    }

    It 'Loads all 14 framework JSON files without error' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $result.Count | Should -Be 14
    }

    It 'Each framework has required frameworkId and label' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        foreach ($fw in $result) {
            $fw.frameworkId | Should -Not -BeNullOrEmpty
            $fw.label | Should -Not -BeNullOrEmpty
        }
    }

    It 'Each framework has expected keys' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $expectedKeys = @('frameworkId', 'label', 'description', 'css', 'totalControls', 'displayOrder', 'scoringMethod', 'profiles', 'filterFamily')
        foreach ($fw in $result) {
            foreach ($key in $expectedKeys) {
                $fw.Keys | Should -Contain $key
            }
        }
    }

    It 'Missing fields get defaults' {
        # Create a minimal framework JSON in TestDrive
        $minimalDir = Join-Path $TestDrive 'frameworks'
        New-Item -Path $minimalDir -ItemType Directory -Force | Out-Null
        @{ frameworkId = 'test-minimal'; label = 'Test Minimal' } |
            ConvertTo-Json | Set-Content -Path (Join-Path $minimalDir 'test-minimal.json')

        $result = Import-FrameworkDefinitions -FrameworksPath $minimalDir
        $result.Count | Should -Be 1
        $result[0].css | Should -Be 'fw-default'
        $result[0].totalControls | Should -Be 0
        $result[0].displayOrder | Should -Be 999
        $result[0].scoringMethod | Should -Be 'control-coverage'
        $result[0].description | Should -Be ''
        $result[0].profiles | Should -BeNullOrEmpty
    }

    It 'Invalid JSON files are skipped with warning' {
        $badDir = Join-Path $TestDrive 'bad-frameworks'
        New-Item -Path $badDir -ItemType Directory -Force | Out-Null
        'not valid json{{{' | Set-Content -Path (Join-Path $badDir 'bad.json')
        @{ frameworkId = 'good-one'; label = 'Good' } |
            ConvertTo-Json | Set-Content -Path (Join-Path $badDir 'good.json')

        $result = Import-FrameworkDefinitions -FrameworksPath $badDir -WarningAction SilentlyContinue
        $result.Count | Should -Be 1
        $result[0].frameworkId | Should -Be 'good-one'
    }

    It 'Skips JSON files missing frameworkId or label' {
        $incompleteDir = Join-Path $TestDrive 'incomplete'
        New-Item -Path $incompleteDir -ItemType Directory -Force | Out-Null
        @{ frameworkId = 'no-label' } |
            ConvertTo-Json | Set-Content -Path (Join-Path $incompleteDir 'no-label.json')
        @{ label = 'No ID' } |
            ConvertTo-Json | Set-Content -Path (Join-Path $incompleteDir 'no-id.json')

        $result = Import-FrameworkDefinitions -FrameworksPath $incompleteDir -WarningAction SilentlyContinue
        $result.Count | Should -Be 0
    }

    It 'filterFamily correctly derived from frameworkId prefix' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $lookup = @{}
        foreach ($fw in $result) { $lookup[$fw.frameworkId] = $fw.filterFamily }

        $lookup['cis-m365-v6'] | Should -Be 'CIS'
        $lookup['nist-800-53'] | Should -Be 'NIST'
        $lookup['nist-csf'] | Should -Be 'NIST'
        $lookup['iso-27001'] | Should -Be 'ISO'
        $lookup['stig'] | Should -Be 'STIG'
        $lookup['pci-dss'] | Should -Be 'PCI'
        $lookup['cmmc'] | Should -Be 'CMMC'
        $lookup['hipaa'] | Should -Be 'HIPAA'
        $lookup['cisa-scuba'] | Should -Be 'CISA'
        $lookup['soc2'] | Should -Be 'SOC2'
        $lookup['essential-eight'] | Should -Be 'Essential8'
        $lookup['fedramp'] | Should -Be 'FedRAMP'
        $lookup['mitre-attack'] | Should -Be 'MITRE'
        $lookup['cis-controls-v8'] | Should -Be 'CIS'
    }

    It 'Profile-based frameworks have profiles populated' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $cis = $result | Where-Object { $_.frameworkId -eq 'cis-m365-v6' }
        $cis.profiles | Should -Not -BeNullOrEmpty
        $cis.profiles.Keys | Should -Contain 'E3-L1'
        $cis.profiles.Keys | Should -Contain 'E5-L2'

        $nist = $result | Where-Object { $_.frameworkId -eq 'nist-800-53' }
        $nist.profiles | Should -Not -BeNullOrEmpty
        $nist.profiles.Keys | Should -Contain 'Low'
        $nist.profiles.Keys | Should -Contain 'High'
        $nist.profiles['Low'].controlCount | Should -BeGreaterThan 0
    }

    It 'Non-profile frameworks have null profiles' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $iso = $result | Where-Object { $_.frameworkId -eq 'iso-27001' }
        $iso.profiles | Should -BeNullOrEmpty
    }

    It 'Returns empty array for nonexistent directory' {
        $result = Import-FrameworkDefinitions -FrameworksPath (Join-Path $TestDrive 'nonexistent') -WarningAction SilentlyContinue
        $result.Count | Should -Be 0
    }

    It 'Returns empty array for directory with no JSON files' {
        $emptyDir = Join-Path $TestDrive 'empty-dir'
        New-Item -Path $emptyDir -ItemType Directory -Force | Out-Null
        $result = Import-FrameworkDefinitions -FrameworksPath $emptyDir -WarningAction SilentlyContinue
        $result.Count | Should -Be 0
    }

    It 'CIS M365 is first in display order' {
        $result = Import-FrameworkDefinitions -FrameworksPath $frameworksPath
        $result[0].frameworkId | Should -Be 'cis-m365-v6'
    }

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
}
