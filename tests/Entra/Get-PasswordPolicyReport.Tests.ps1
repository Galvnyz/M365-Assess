BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-PasswordPolicyReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgDomain to return domain data
        Mock Get-MgDomain {
            return @(
                [PSCustomObject]@{
                    Id                               = 'contoso.com'
                    IsDefault                        = $true
                    PasswordValidityPeriodInDays     = 90
                    PasswordNotificationWindowInDays = 14
                },
                [PSCustomObject]@{
                    Id                               = 'fabrikam.com'
                    IsDefault                        = $false
                    PasswordValidityPeriodInDays     = 2147483647
                    PasswordNotificationWindowInDays = 14
                }
            )
        }

        # Mock Get-MgPolicyAuthorizationPolicy to return auth policy
        Mock Get-MgPolicyAuthorizationPolicy {
            return [PSCustomObject]@{
                AllowEmailVerifiedUsersToJoinOrganization = $false
                AllowedToUseSSPR                         = $true
            }
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-PasswordPolicyReport.ps1"
    }

    It 'Returns a non-empty policy report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'Domain'
        $first.PSObject.Properties.Name | Should -Contain 'IsDefault'
        $first.PSObject.Properties.Name | Should -Contain 'PasswordValidityPeriod'
        $first.PSObject.Properties.Name | Should -Contain 'PasswordNotificationWindowInDays'
        $first.PSObject.Properties.Name | Should -Contain 'AllowCloudPasswordValidation'
        $first.PSObject.Properties.Name | Should -Contain 'AllowEmailVerifiedUsersToJoinOrganization'
    }

    It 'Returns one row per domain' {
        @($result).Count | Should -Be 2
    }

    It 'Correctly maps authorization policy settings' {
        $first = $result | Where-Object { $_.Domain -eq 'contoso.com' }
        $first.AllowCloudPasswordValidation | Should -Be $true
        $first.AllowEmailVerifiedUsersToJoinOrganization | Should -Be $false
    }
}

Describe 'Get-PasswordPolicyReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
    }

    Context 'when not connected to Graph' {
        BeforeAll {
            function Get-MgContext { return $null }
        }

        It 'Throws an error when not connected' {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            { & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-PasswordPolicyReport.ps1" } | Should -Throw
        }
    }
}
