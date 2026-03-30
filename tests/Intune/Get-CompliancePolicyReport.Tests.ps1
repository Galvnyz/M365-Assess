BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-CompliancePolicyReport' {
    BeforeAll {
        # Stub the Graph context guard so the connection check passes
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }

        # Stub Import-Module so the submodule load is a no-op
        function global:Import-Module { }

        # Stub Get-MgDeviceManagementDeviceCompliancePolicy before Mocking it
        function global:Get-MgDeviceManagementDeviceCompliancePolicy { }

        # AdditionalProperties carries the @odata.type used for platform resolution.
        Mock Get-MgDeviceManagementDeviceCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'Windows 10 Compliance Policy'
                    Id                   = 'policy-001'
                    CreatedDateTime      = [datetime]'2024-01-10T08:00:00Z'
                    LastModifiedDateTime = [datetime]'2025-01-15T09:00:00Z'
                    Version              = 3
                    Description          = 'Baseline Windows 10 compliance policy'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.windows10CompliancePolicy'
                    }
                },
                [PSCustomObject]@{
                    DisplayName          = 'iOS Compliance Policy'
                    Id                   = 'policy-002'
                    CreatedDateTime      = [datetime]'2024-02-20T10:00:00Z'
                    LastModifiedDateTime = [datetime]'2025-02-01T11:00:00Z'
                    Version              = 1
                    Description          = 'iOS device compliance requirements'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.iosCompliancePolicy'
                    }
                },
                [PSCustomObject]@{
                    DisplayName          = 'Android Compliance Policy'
                    Id                   = 'policy-003'
                    CreatedDateTime      = [datetime]'2024-03-05T12:00:00Z'
                    LastModifiedDateTime = [datetime]'2025-03-01T08:00:00Z'
                    Version              = 2
                    Description          = 'Android device compliance requirements'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.androidCompliancePolicy'
                    }
                }
            )
        }

        # Dot-source the collector; results land in $results (script scope)
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-CompliancePolicyReport.ps1"
    }

    It 'Returns a non-empty policy list' {
        $results.Count | Should -BeGreaterThan 0
    }

    It 'Returns the correct number of policies' {
        $results.Count | Should -Be 3
    }

    It 'All results have required properties' {
        $requiredProps = @(
            'DisplayName', 'Id', 'CreatedDateTime',
            'LastModifiedDateTime', 'Platform', 'Version', 'Description'
        )
        foreach ($policy in $results) {
            foreach ($prop in $requiredProps) {
                $policy.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "Policy '$($policy.DisplayName)' should have property '$prop'"
            }
        }
    }

    It 'Results are sorted by DisplayName' {
        $sorted = $results | Sort-Object DisplayName
        for ($i = 0; $i -lt $results.Count; $i++) {
            $results[$i].DisplayName | Should -Be $sorted[$i].DisplayName
        }
    }

    It 'Resolves Windows 10 odata.type to friendly platform name' {
        $policy = $results | Where-Object { $_.Id -eq 'policy-001' }
        $policy | Should -Not -BeNullOrEmpty
        $policy.Platform | Should -Be 'Windows 10'
    }

    It 'Resolves iOS odata.type to friendly platform name' {
        $policy = $results | Where-Object { $_.Id -eq 'policy-002' }
        $policy | Should -Not -BeNullOrEmpty
        $policy.Platform | Should -Be 'iOS'
    }

    It 'Resolves Android odata.type to friendly platform name' {
        $policy = $results | Where-Object { $_.Id -eq 'policy-003' }
        $policy | Should -Not -BeNullOrEmpty
        $policy.Platform | Should -Be 'Android'
    }

    It 'Policy DisplayNames match expected values' {
        $results.DisplayName | Should -Contain 'Windows 10 Compliance Policy'
        $results.DisplayName | Should -Contain 'iOS Compliance Policy'
        $results.DisplayName | Should -Contain 'Android Compliance Policy'
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceCompliancePolicy -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CompliancePolicyReport - Unknown Platform' {
    BeforeAll {
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementDeviceCompliancePolicy { }

        # Policy with an unrecognised odata.type should fall back to the raw type string
        Mock Get-MgDeviceManagementDeviceCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'Custom Platform Policy'
                    Id                   = 'policy-custom'
                    CreatedDateTime      = [datetime]'2025-01-01T00:00:00Z'
                    LastModifiedDateTime = [datetime]'2025-01-01T00:00:00Z'
                    Version              = 1
                    Description          = 'Policy with unrecognised platform'
                    AdditionalProperties = @{
                        '@odata.type' = '#microsoft.graph.unknownFuturePlatformPolicy'
                    }
                }
            )
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-CompliancePolicyReport.ps1"
    }

    It 'Falls back to raw odata.type string for unrecognised platforms' {
        $policy = $results | Where-Object { $_.Id -eq 'policy-custom' }
        $policy | Should -Not -BeNullOrEmpty
        $policy.Platform | Should -Be '#microsoft.graph.unknownFuturePlatformPolicy'
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceCompliancePolicy -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CompliancePolicyReport - No AdditionalProperties' {
    BeforeAll {
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementDeviceCompliancePolicy { }

        # Policy with null AdditionalProperties should resolve to 'Unknown'
        Mock Get-MgDeviceManagementDeviceCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'No OData Policy'
                    Id                   = 'policy-null'
                    CreatedDateTime      = [datetime]'2025-01-01T00:00:00Z'
                    LastModifiedDateTime = [datetime]'2025-01-01T00:00:00Z'
                    Version              = 1
                    Description          = ''
                    AdditionalProperties = $null
                }
            )
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-CompliancePolicyReport.ps1"
    }

    It 'Resolves to Unknown when AdditionalProperties is null' {
        $policy = $results | Where-Object { $_.Id -eq 'policy-null' }
        $policy | Should -Not -BeNullOrEmpty
        $policy.Platform | Should -Be 'Unknown'
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceCompliancePolicy -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CompliancePolicyReport - No Policies Configured' {
    BeforeAll {
        function global:Get-MgContext { return [PSCustomObject]@{ TenantId = 'test-tenant' } }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementDeviceCompliancePolicy { }

        # Return empty array to simulate no compliance policies
        Mock Get-MgDeviceManagementDeviceCompliancePolicy { return @() }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-CompliancePolicyReport.ps1"
    }

    It 'Returns an empty array when no policies are configured' {
        # Collector emits Write-Output @() and returns; $results is not set in this path
        $results | Should -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceCompliancePolicy -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CompliancePolicyReport - Not Connected' {
    BeforeAll {
        # Return null context to simulate no Graph connection
        function global:Get-MgContext { return $null }
        function global:Import-Module { }
        function global:Get-MgDeviceManagementDeviceCompliancePolicy { }

        Mock Get-MgDeviceManagementDeviceCompliancePolicy {}
    }

    It 'Does not call Get-MgDeviceManagementDeviceCompliancePolicy when not connected' {
        # Dot-source; script aborts at the connection guard with a terminating Write-Error
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        try { . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-CompliancePolicyReport.ps1" } catch { }
        Should -Invoke Get-MgDeviceManagementDeviceCompliancePolicy -Times 0 -Exactly
    }

    AfterAll {
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Import-Module -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgDeviceManagementDeviceCompliancePolicy -ErrorAction SilentlyContinue
    }
}
