BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MfaReport' {
    BeforeAll {
        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Get-MgReportAuthenticationMethodUserRegistrationDetail with realistic data
        Mock Get-MgReportAuthenticationMethodUserRegistrationDetail {
            return @(
                [PSCustomObject]@{
                    UserPrincipalName     = 'user1@contoso.com'
                    UserDisplayName       = 'User One'
                    IsMfaRegistered       = $true
                    IsMfaCapable          = $true
                    IsPasswordlessCapable = $false
                    IsSsprRegistered      = $true
                    IsSsprCapable         = $true
                    MethodsRegistered     = @('microsoftAuthenticatorPush', 'softwareOneTimePasscode')
                    DefaultMfaMethod      = 'microsoftAuthenticatorPush'
                    IsAdmin               = $false
                },
                [PSCustomObject]@{
                    UserPrincipalName     = 'admin@contoso.com'
                    UserDisplayName       = 'Admin User'
                    IsMfaRegistered       = $true
                    IsMfaCapable          = $true
                    IsPasswordlessCapable = $true
                    IsSsprRegistered      = $true
                    IsSsprCapable         = $true
                    MethodsRegistered     = @('microsoftAuthenticatorPush', 'fido2')
                    DefaultMfaMethod      = 'microsoftAuthenticatorPush'
                    IsAdmin               = $true
                },
                [PSCustomObject]@{
                    UserPrincipalName     = 'nomfa@contoso.com'
                    UserDisplayName       = 'No MFA User'
                    IsMfaRegistered       = $false
                    IsMfaCapable          = $false
                    IsPasswordlessCapable = $false
                    IsSsprRegistered      = $false
                    IsSsprCapable         = $false
                    MethodsRegistered     = @()
                    DefaultMfaMethod      = ''
                    IsAdmin               = $false
                }
            )
        }

        # Run the collector
        $result = & "$PSScriptRoot/../../Entra/Get-MfaReport.ps1"
    }

    It 'Returns a non-empty MFA report' {
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Output has expected properties' {
        $first = $result | Select-Object -First 1
        $first.PSObject.Properties.Name | Should -Contain 'UserPrincipalName'
        $first.PSObject.Properties.Name | Should -Contain 'IsMfaRegistered'
        $first.PSObject.Properties.Name | Should -Contain 'IsMfaCapable'
        $first.PSObject.Properties.Name | Should -Contain 'MethodsRegistered'
        $first.PSObject.Properties.Name | Should -Contain 'DefaultMfaMethod'
        $first.PSObject.Properties.Name | Should -Contain 'IsAdmin'
    }

    It 'Returns one row per user' {
        @($result).Count | Should -Be 3
    }

    It 'Joins methods into semicolon-delimited string' {
        $user1 = $result | Where-Object { $_.UserPrincipalName -eq 'user1@contoso.com' }
        $user1.MethodsRegistered | Should -Match 'microsoftAuthenticatorPush'
        $user1.MethodsRegistered | Should -Match ';'
    }
}

Describe 'Get-MfaReport - Edge Cases' {
    BeforeAll {
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }
        Mock Import-Module { }
    }

    Context 'when no MFA registration details are returned' {
        BeforeAll {
            Mock Get-MgReportAuthenticationMethodUserRegistrationDetail { return @() }
            $result = & "$PSScriptRoot/../../Entra/Get-MfaReport.ps1"
        }

        It 'Returns empty result without error' {
            $result | Should -BeNullOrEmpty
        }
    }
}
