BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-UserSummary' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Invoke-MgGraphRequest with paginated user response
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers)
            return @{
                value = @(
                    @{
                        id                     = 'u1'
                        displayName            = 'Licensed Member'
                        userPrincipalName      = 'member1@contoso.com'
                        userType               = 'Member'
                        accountEnabled         = $true
                        assignedLicenses       = @(@{ skuId = 'sku-1' })
                        onPremisesSyncEnabled  = $false
                        signInActivity         = @{ lastSignInDateTime = (Get-Date).AddDays(-5).ToString('o') }
                    },
                    @{
                        id                     = 'u2'
                        displayName            = 'Guest User'
                        userPrincipalName      = 'guest@external.com'
                        userType               = 'Guest'
                        accountEnabled         = $true
                        assignedLicenses       = @()
                        onPremisesSyncEnabled  = $false
                        signInActivity         = @{ lastSignInDateTime = $null }
                    },
                    @{
                        id                     = 'u3'
                        displayName            = 'Disabled Synced'
                        userPrincipalName      = 'disabled@contoso.com'
                        userType               = 'Member'
                        accountEnabled         = $false
                        assignedLicenses       = @(@{ skuId = 'sku-2' })
                        onPremisesSyncEnabled  = $true
                        signInActivity         = @{ lastSignInDateTime = (Get-Date).AddDays(-1).ToString('o') }
                    }
                )
                '@odata.nextLink' = $null
            }
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-UserSummary.ps1"
    }

    It 'Returns a non-empty user summary' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $result.PSObject.Properties.Name | Should -Contain 'TotalUsers'
        $result.PSObject.Properties.Name | Should -Contain 'Licensed'
        $result.PSObject.Properties.Name | Should -Contain 'GuestUsers'
        $result.PSObject.Properties.Name | Should -Contain 'DisabledUsers'
        $result.PSObject.Properties.Name | Should -Contain 'SyncedFromOnPrem'
        $result.PSObject.Properties.Name | Should -Contain 'CloudOnly'
    }

    It 'Counts totals correctly' {
        $result.TotalUsers | Should -Be 3
        $result.Licensed | Should -Be 2
        $result.GuestUsers | Should -Be 1
        $result.DisabledUsers | Should -Be 1
        $result.SyncedFromOnPrem | Should -Be 1
        $result.CloudOnly | Should -Be 2
    }
}

Describe 'Get-UserSummary - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
    }

    Context 'when Graph returns no users' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                return @{ value = @(); '@odata.nextLink' = $null }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-UserSummary.ps1"
        }

        It 'Returns summary with zero counts' {
            $result.TotalUsers | Should -Be 0
        }
    }

    Context 'when not connected to Graph' {
        BeforeAll {
            function Get-MgContext { return $null }
        }

        It 'Throws an error when not connected' {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            { & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-UserSummary.ps1" } | Should -Throw
        }
    }
}
