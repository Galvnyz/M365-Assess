BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-LicenseReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Invoke-WebRequest to prevent live SKU CSV download
        Mock Invoke-WebRequest { throw 'No network in tests' }

        # Mock Test-Path for bundled CSV fallback
        Mock Test-Path { return $false }

        # Mock Get-MgSubscribedSku with realistic SKU data
        Mock Get-MgSubscribedSku {
            return @(
                [PSCustomObject]@{
                    SkuId         = '06ebc4ee-1bb5-47dd-8120-11324bc54e06'
                    SkuPartNumber = 'SPE_E5'
                    PrepaidUnits  = @{ Enabled = 25; Suspended = 0; Warning = 0 }
                    ConsumedUnits = 18
                },
                [PSCustomObject]@{
                    SkuId         = 'c5928f49-12ba-48f7-ada3-0d743a3601d5'
                    SkuPartNumber = 'VISIOCLIENT'
                    PrepaidUnits  = @{ Enabled = 5; Suspended = 0; Warning = 2 }
                    ConsumedUnits = 3
                }
            )
        }

        # Run the collector (SKU summary mode, no -IncludeUserDetail)
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-LicenseReport.ps1"
    }

    It 'Returns a non-empty license report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'License'
        $first.PSObject.Properties.Name | Should -Contain 'SkuPartNumber'
        $first.PSObject.Properties.Name | Should -Contain 'Total'
        $first.PSObject.Properties.Name | Should -Contain 'Assigned'
        $first.PSObject.Properties.Name | Should -Contain 'Available'
    }

    It 'Calculates available licenses correctly' {
        $e5 = $result | Where-Object { $_.SkuPartNumber -eq 'SPE_E5' }
        $e5.Available | Should -Be 7
    }

    It 'Returns one row per SKU' {
        @($result).Count | Should -Be 2
    }
}

Describe 'Get-LicenseReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
        Mock Invoke-WebRequest { throw 'No network' }
        Mock Test-Path { return $false }
    }

    Context 'when no SKUs are returned' {
        BeforeAll {
            Mock Get-MgSubscribedSku { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-LicenseReport.ps1"
        }

        It 'Returns empty result without error' {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            { & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-LicenseReport.ps1" } | Should -Not -Throw
        }
    }
}
