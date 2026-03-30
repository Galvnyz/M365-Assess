BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-InactiveUsers' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Get-MgUser to return realistic inactive user data
        Mock Get-MgUser {
            return @(
                [PSCustomObject]@{
                    DisplayName       = 'Stale User'
                    UserPrincipalName = 'stale@contoso.com'
                    UserType          = 'Member'
                    AccountEnabled    = $true
                    CreatedDateTime   = '2024-01-15T10:00:00Z'
                    SignInActivity    = @{
                        LastSignInDateTime               = '2025-06-01T08:00:00Z'
                        LastNonInteractiveSignInDateTime = '2025-05-20T12:00:00Z'
                    }
                },
                [PSCustomObject]@{
                    DisplayName       = 'Never Signed In'
                    UserPrincipalName = 'neversignedin@contoso.com'
                    UserType          = 'Member'
                    AccountEnabled    = $true
                    CreatedDateTime   = '2024-03-01T10:00:00Z'
                    SignInActivity    = @{
                        LastSignInDateTime               = $null
                        LastNonInteractiveSignInDateTime = $null
                    }
                },
                [PSCustomObject]@{
                    DisplayName       = 'Active User'
                    UserPrincipalName = 'active@contoso.com'
                    UserType          = 'Member'
                    AccountEnabled    = $true
                    CreatedDateTime   = '2024-02-10T10:00:00Z'
                    SignInActivity    = @{
                        LastSignInDateTime               = (Get-Date).AddDays(-5).ToString('o')
                        LastNonInteractiveSignInDateTime = (Get-Date).AddDays(-2).ToString('o')
                    }
                }
            )
        }

        # Run the collector
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-InactiveUsers.ps1" -DaysInactive 90
    }

    It 'Returns inactive users when Graph returns data' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'DisplayName'
        $first.PSObject.Properties.Name | Should -Contain 'UserPrincipalName'
        $first.PSObject.Properties.Name | Should -Contain 'LastSignIn'
        $first.PSObject.Properties.Name | Should -Contain 'DaysSinceActivity'
    }

    It 'Excludes recently active users' {
        $activeInResult = $result | Where-Object { $_.UserPrincipalName -eq 'active@contoso.com' }
        $activeInResult | Should -BeNullOrEmpty
    }

    It 'Includes users who never signed in' {
        $neverSignedIn = $result | Where-Object { $_.UserPrincipalName -eq 'neversignedin@contoso.com' }
        $neverSignedIn | Should -Not -BeNullOrEmpty
        $neverSignedIn.DaysSinceActivity | Should -Be 'Never'
    }
}

Describe 'Get-InactiveUsers - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
    }

    Context 'when Graph returns no users' {
        BeforeAll {
            Mock Get-MgUser { return @() }
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $result = & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-InactiveUsers.ps1" -DaysInactive 90
        }

        It 'Returns empty result without error' {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            { & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-InactiveUsers.ps1" -DaysInactive 90 } | Should -Not -Throw
        }
    }

    Context 'when not connected to Graph' {
        BeforeAll {
            function Get-MgContext { return $null }
        }

        It 'Throws an error when not connected' {
            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            { & "$PSScriptRoot/../../src/M365-Assess/Entra/Get-InactiveUsers.ps1" -DaysInactive 90 } | Should -Throw
        }
    }
}
