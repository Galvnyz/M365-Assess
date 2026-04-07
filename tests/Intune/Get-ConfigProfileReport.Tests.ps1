BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-ConfigProfileReport' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }

        # Stub the Graph cmdlet so Pester can mock it (must exist before Mock is called)
        function global:Get-MgDeviceManagementDeviceConfiguration { param([switch]$All) }

        # Stub Import-Module so the DeviceManagement submodule import is a no-op
        Mock Import-Module { }

        Mock Get-MgDeviceManagementDeviceConfiguration {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'Windows 10 Baseline'
                    Id                   = 'profile-001'
                    CreatedDateTime      = [datetime]'2026-01-01'
                    LastModifiedDateTime = [datetime]'2026-03-01'
                    Version              = 3
                    Description          = 'Corporate Windows baseline'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.windows10GeneralConfiguration'
                    }
                }
                [PSCustomObject]@{
                    DisplayName          = 'iOS Corp Policy'
                    Id                   = 'profile-002'
                    CreatedDateTime      = [datetime]'2026-01-15'
                    LastModifiedDateTime = [datetime]'2026-03-15'
                    Version              = 1
                    Description          = 'iOS device policy'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.iosGeneralDeviceConfiguration'
                    }
                }
            )
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Intune/Get-ConfigProfileReport.ps1"
    }

    It 'returns an array of profile objects' {
        $script:result | Should -Not -BeNullOrEmpty
        @($script:result).Count | Should -BeGreaterOrEqual 1
    }

    It 'all profiles have a DisplayName property' {
        foreach ($p in @($script:result)) {
            $p.DisplayName | Should -Not -BeNullOrEmpty
        }
    }

    It 'all profiles have an Id property' {
        foreach ($p in @($script:result)) {
            $p.Id | Should -Not -BeNullOrEmpty
        }
    }

    It 'all profiles have a Platform property' {
        foreach ($p in @($script:result)) {
            $p.PSObject.Properties.Name | Should -Contain 'Platform'
        }
    }

    It 'Windows 10 odata type maps to friendly platform name' {
        $winProfile = @($script:result) | Where-Object { $_.DisplayName -eq 'Windows 10 Baseline' }
        $winProfile | Should -Not -BeNullOrEmpty
        $winProfile.Platform | Should -Be 'Windows 10'
    }

    It 'iOS odata type maps to friendly platform name' {
        $iosProfile = @($script:result) | Where-Object { $_.DisplayName -eq 'iOS Corp Policy' }
        $iosProfile | Should -Not -BeNullOrEmpty
        $iosProfile.Platform | Should -Be 'iOS'
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceConfiguration -ErrorAction SilentlyContinue
    }
}

Describe 'Get-ConfigProfileReport - empty response' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }
        function global:Get-MgDeviceManagementDeviceConfiguration { param([switch]$All) }

        Mock Import-Module { }

        Mock Get-MgDeviceManagementDeviceConfiguration {
            return @()
        }

        $script:emptyResult = & "$PSScriptRoot/../../src/M365-Assess/Intune/Get-ConfigProfileReport.ps1" -WarningAction SilentlyContinue
    }

    It 'returns empty array when no profiles exist' {
        @($script:emptyResult).Count | Should -Be 0
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceConfiguration -ErrorAction SilentlyContinue
    }
}
