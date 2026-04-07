BeforeDiscovery {
    # Discover all security-config collector scripts that should follow the contract
    $collectorRoot = Join-Path $PSScriptRoot '../../src/M365-Assess'
    # All collectors now migrated to SecurityConfigHelper contract (#256, #257)
    $deferredCollectors = @()
    $script:CollectorFiles = Get-ChildItem -Path $collectorRoot -Recurse -Filter 'Get-*SecurityConfig.ps1' |
        Where-Object { $_.FullName -notlike '*node_modules*' -and $_.Name -notin $deferredCollectors }

    # Also include Purview retention collector (uses same contract)
    $purviewFile = Get-ChildItem -Path $collectorRoot -Recurse -Filter 'Get-PurviewRetentionConfig.ps1'
    if ($purviewFile) { $script:CollectorFiles += $purviewFile }
}

Describe 'SecurityConfigHelper.ps1 - Contract Functions' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        # Stub progress tracker so Add-SecuritySetting's guard check passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }
    }

    Context 'Initialize-SecurityConfig' {
        BeforeAll {
            $ctx = Initialize-SecurityConfig
        }

        It 'Returns a hashtable' {
            $ctx | Should -BeOfType [hashtable]
        }

        It 'Contains a Settings key with an empty List' {
            # Use direct variable assertion to avoid pipeline unwrapping of empty collections
            ($null -ne $ctx.Settings) | Should -Be $true -Because 'Settings key must exist'
            $ctx.Settings.GetType().Name | Should -Be 'List`1'
            $ctx.Settings.Count | Should -Be 0
        }

        It 'Contains a CheckIdCounter key with an empty hashtable' {
            $ctx.CheckIdCounter | Should -BeOfType [hashtable]
            $ctx.CheckIdCounter.Count | Should -Be 0
        }
    }

    Context 'Add-SecuritySetting' {
        BeforeAll {
            $ctx = Initialize-SecurityConfig
            $settings = $ctx.Settings
            $counter = $ctx.CheckIdCounter
        }

        It 'Adds a setting with all 7 required properties' {
            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'Test' -Setting 'Test Setting' `
                -CurrentValue 'True' -RecommendedValue 'True' `
                -Status 'Pass' -CheckId 'TEST-001' -Remediation 'None needed'

            $settings.Count | Should -Be 1
            $s = $settings[0]
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
            $s.PSObject.Properties.Name | Should -Contain 'Remediation'
        }

        It 'Auto-numbers CheckIds with .N suffix' {
            $settings.Clear()
            $counter.Clear()

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'Auth' -Setting 'First' `
                -CurrentValue 'A' -RecommendedValue 'B' `
                -Status 'Pass' -CheckId 'EXO-AUTH-001'

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'Auth' -Setting 'Second' `
                -CurrentValue 'C' -RecommendedValue 'D' `
                -Status 'Fail' -CheckId 'EXO-AUTH-001'

            $settings[0].CheckId | Should -Be 'EXO-AUTH-001.1'
            $settings[1].CheckId | Should -Be 'EXO-AUTH-001.2'
        }

        It 'Preserves empty CheckId when not provided' {
            $settings.Clear()
            $counter.Clear()

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'Info' -Setting 'No CheckId' `
                -CurrentValue 'X' -RecommendedValue 'Y' `
                -Status 'Info'

            $settings[0].CheckId | Should -BeExactly ''
        }

        It 'Tracks independent CheckId sequences' {
            $settings.Clear()
            $counter.Clear()

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'A' -Setting 'First A' `
                -CurrentValue '1' -RecommendedValue '2' `
                -Status 'Pass' -CheckId 'TEST-AAA-001'

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'B' -Setting 'First B' `
                -CurrentValue '3' -RecommendedValue '4' `
                -Status 'Pass' -CheckId 'TEST-BBB-001'

            Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                -Category 'A' -Setting 'Second A' `
                -CurrentValue '5' -RecommendedValue '6' `
                -Status 'Fail' -CheckId 'TEST-AAA-001'

            $settings[0].CheckId | Should -Be 'TEST-AAA-001.1'
            $settings[1].CheckId | Should -Be 'TEST-BBB-001.1'
            $settings[2].CheckId | Should -Be 'TEST-AAA-001.2'
        }

        It 'Rejects invalid Status values' -ForEach @(
            @{ BadStatus = 'N/A' }
            @{ BadStatus = 'Error' }
            @{ BadStatus = 'OK' }
            @{ BadStatus = '' }
        ) {
            {
                Add-SecuritySetting -Settings $settings -CheckIdCounter $counter `
                    -Category 'Test' -Setting 'Bad Status' `
                    -CurrentValue 'X' -RecommendedValue 'Y' `
                    -Status $BadStatus
            } | Should -Throw
        }

        It 'Accepts all valid Status values' -ForEach @(
            @{ GoodStatus = 'Pass' }
            @{ GoodStatus = 'Fail' }
            @{ GoodStatus = 'Warning' }
            @{ GoodStatus = 'Review' }
            @{ GoodStatus = 'Info' }
            @{ GoodStatus = 'Unknown' }
        ) {
            $testSettings = [System.Collections.Generic.List[PSCustomObject]]::new()
            $testCounter = @{}
            {
                Add-SecuritySetting -Settings $testSettings -CheckIdCounter $testCounter `
                    -Category 'Test' -Setting 'Good Status' `
                    -CurrentValue 'X' -RecommendedValue 'Y' `
                    -Status $GoodStatus
            } | Should -Not -Throw
        }
    }

    Context 'Export-SecurityConfigReport' {
        BeforeAll {
            $testSettings = @(
                [PSCustomObject]@{ Category = 'A'; Setting = 'S1'; Status = 'Pass' }
                [PSCustomObject]@{ Category = 'B'; Setting = 'S2'; Status = 'Fail' }
            )
        }

        It 'Returns settings to pipeline when no OutputPath' {
            $result = Export-SecurityConfigReport -Settings $testSettings -ServiceLabel 'Test'
            # First output is the array of settings, second is the Write-Output string
            $result.Count | Should -BeGreaterOrEqual 2
        }

        It 'Exports to CSV when OutputPath is provided' {
            $tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) "contract-test-$(Get-Random).csv"
            try {
                Export-SecurityConfigReport -Settings $testSettings -OutputPath $tmpFile -ServiceLabel 'Test'
                Test-Path $tmpFile | Should -Be $true
                $csv = Import-Csv $tmpFile
                $csv.Count | Should -Be 2
            }
            finally {
                if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
            }
        }
    }
}

Describe 'Adoption Signal Accumulator' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"
    }

    BeforeEach {
        $global:AdoptionSignals = $null
    }

    It 'Should initialize with empty adoption signals' {
        $ctx = Initialize-SecurityConfig
        $signals = Get-AdoptionSignals
        $signals.Count | Should -Be 0
    }

    It 'Should accumulate signals from Add-SecuritySetting' {
        $ctx = Initialize-SecurityConfig
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'Test' -Setting 'Test Setting' -CurrentValue 'True' `
            -RecommendedValue 'True' -Status 'Pass' -CheckId 'TEST-001'

        $signals = Get-AdoptionSignals
        $signals.Count | Should -Be 1
        $signals['TEST-001.1'].Status | Should -Be 'Pass'
        $signals['TEST-001.1'].Setting | Should -Be 'Test Setting'
    }

    It 'Should return a clone (not a reference)' {
        $ctx = Initialize-SecurityConfig
        Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
            -Category 'Test' -Setting 'S1' -CurrentValue 'V1' `
            -RecommendedValue 'R1' -Status 'Pass' -CheckId 'TEST-002'

        $clone = Get-AdoptionSignals
        $clone['INJECTED'] = @{ Status = 'Hacked' }

        $original = Get-AdoptionSignals
        $original.ContainsKey('INJECTED') | Should -Be $false
    }
}

Describe 'SecurityConfigHelper.ps1 - Additional Edge Cases' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }
    }

    Context 'Add-SecuritySetting edge cases' {
        It 'should accept empty string for CurrentValue' {
            $ctx = Initialize-SecurityConfig
            {
                Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                    -Category 'Test' -Setting 'Empty Current' `
                    -CurrentValue '' -RecommendedValue 'Enabled' `
                    -Status 'Fail' -CheckId 'TEST-EDGE-001'
            } | Should -Not -Throw
            $ctx.Settings.Count | Should -Be 1
            $ctx.Settings[0].CurrentValue | Should -BeExactly ''
        }

        It 'should accept empty string for RecommendedValue' {
            $ctx = Initialize-SecurityConfig
            {
                Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                    -Category 'Test' -Setting 'Empty Recommended' `
                    -CurrentValue 'Value' -RecommendedValue '' `
                    -Status 'Info' -CheckId 'TEST-EDGE-002'
            } | Should -Not -Throw
        }

        It 'should produce .1, .2, .3 suffixes when same CheckId added three times' {
            $ctx = Initialize-SecurityConfig
            1..3 | ForEach-Object {
                Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                    -Category 'Auth' -Setting "Item $_" `
                    -CurrentValue 'X' -RecommendedValue 'Y' `
                    -Status 'Pass' -CheckId 'TEST-MULTI-001'
            }
            $ctx.Settings[0].CheckId | Should -Be 'TEST-MULTI-001.1'
            $ctx.Settings[1].CheckId | Should -Be 'TEST-MULTI-001.2'
            $ctx.Settings[2].CheckId | Should -Be 'TEST-MULTI-001.3'
        }
    }

    Context 'Export-SecurityConfigReport pipeline output' {
        It 'should return objects to pipeline when no OutputPath is provided' {
            $testSettings = @(
                [PSCustomObject]@{ Category = 'X'; Setting = 'S1'; Status = 'Pass' }
                [PSCustomObject]@{ Category = 'Y'; Setting = 'S2'; Status = 'Fail' }
                [PSCustomObject]@{ Category = 'Z'; Setting = 'S3'; Status = 'Warning' }
            )
            $result = @(Export-SecurityConfigReport -Settings $testSettings -ServiceLabel 'EdgeTest')
            # Output includes the Write-Output string message plus the settings array items
            $result.Count | Should -BeGreaterOrEqual 2
        }

        It 'should include all settings when returned to pipeline' {
            $testSettings = @(
                [PSCustomObject]@{ Category = 'A'; Setting = 'S1'; Status = 'Pass' }
                [PSCustomObject]@{ Category = 'B'; Setting = 'S2'; Status = 'Fail' }
            )
            $result = @(Export-SecurityConfigReport -Settings $testSettings -ServiceLabel 'PipelineEdge')
            # At least the 2 objects should be in the output
            $objectResults = @($result | Where-Object { $_ -is [PSCustomObject] })
            $objectResults.Count | Should -Be 2
        }
    }
}

Describe 'Collector Contract Compliance' -ForEach @(
    $CollectorFiles | ForEach-Object {
        @{ FileName = $_.Name; FilePath = $_.FullName; RelativePath = $_.FullName -replace [regex]::Escape((Resolve-Path "$PSScriptRoot/../..").Path + '\'), '' }
    }
) {

    It '<FileName> dot-sources SecurityConfigHelper.ps1' {
        $content = Get-Content -Path $FilePath -Raw
        $content | Should -Match 'SecurityConfigHelper\.ps1' `
            -Because "$FileName must use the shared contract helper"
    }

    It '<FileName> calls Initialize-SecurityConfig' {
        $content = Get-Content -Path $FilePath -Raw
        $content | Should -Match 'Initialize-SecurityConfig' `
            -Because "$FileName must initialize settings via the contract"
    }

    It '<FileName> defines a thin-wrapper Add-Setting function' {
        $content = Get-Content -Path $FilePath -Raw
        $content | Should -Match 'function\s+Add-Setting' `
            -Because "$FileName must define a local Add-Setting wrapper"
        $content | Should -Match 'Add-SecuritySetting' `
            -Because "$FileName Add-Setting must forward to Add-SecuritySetting"
    }

    It '<FileName> calls Export-SecurityConfigReport for output' {
        $content = Get-Content -Path $FilePath -Raw
        $content | Should -Match 'Export-SecurityConfigReport' `
            -Because "$FileName must use the standard output handler"
    }

    It '<FileName> has no inline settings list construction' {
        $content = Get-Content -Path $FilePath -Raw
        # After migration, collectors should NOT have the raw List construction
        # They should use Initialize-SecurityConfig instead
        $content | Should -Not -Match '\[System\.Collections\.Generic\.List\[PSCustomObject\]\]::new\(\)' `
            -Because "$FileName should use Initialize-SecurityConfig instead of raw List construction"
    }
}
