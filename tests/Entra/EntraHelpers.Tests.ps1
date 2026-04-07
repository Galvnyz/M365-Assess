BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'EntraHelpers' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraHelpers.ps1"
    }

    Describe 'Get-BreakGlassAccounts' {
        It 'Detects accounts with BreakGlass in display name' {
            $users = @(
                @{ displayName = 'BreakGlass Admin'; userPrincipalName = 'bg@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Regular User'; userPrincipalName = 'user@contoso.com'; accountEnabled = $true }
            )
            $result = Get-BreakGlassAccounts -Users $users
            $result.Count | Should -BeGreaterThan 0
            $result | Where-Object { $_['displayName'] -eq 'BreakGlass Admin' } | Should -Not -BeNullOrEmpty
        }

        It 'Detects accounts with EmergencyAccess in display name' {
            $users = @(
                @{ displayName = 'EmergencyAccess1'; userPrincipalName = 'ea@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Normal Admin'; userPrincipalName = 'admin@contoso.com'; accountEnabled = $true }
            )
            $result = Get-BreakGlassAccounts -Users $users
            $result.Count | Should -BeGreaterThan 0
            $result | Where-Object { $_['displayName'] -eq 'EmergencyAccess1' } | Should -Not -BeNullOrEmpty
        }

        It 'Detects accounts with break-glass in UPN' {
            $users = @(
                @{ displayName = 'Break Glass'; userPrincipalName = 'breakglass@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Normal'; userPrincipalName = 'normal@contoso.com'; accountEnabled = $true }
            )
            $result = Get-BreakGlassAccounts -Users $users
            $result.Count | Should -BeGreaterThan 0
        }

        It 'Returns empty array when no break-glass accounts found' {
            $users = @(
                @{ displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Admin Two'; userPrincipalName = 'admin2@contoso.com'; accountEnabled = $true }
            )
            $result = Get-BreakGlassAccounts -Users $users
            $result.Count | Should -Be 0
        }

        It 'Returns empty array when users list is empty' {
            $result = Get-BreakGlassAccounts -Users @()
            $result.Count | Should -Be 0
        }

        It 'Detects multiple break-glass accounts' {
            $users = @(
                @{ displayName = 'BreakGlass One'; userPrincipalName = 'bg1@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Emergency Admin'; userPrincipalName = 'emergency.admin@contoso.com'; accountEnabled = $true }
                @{ displayName = 'Normal User'; userPrincipalName = 'user@contoso.com'; accountEnabled = $true }
            )
            $result = Get-BreakGlassAccounts -Users $users
            $result.Count | Should -BeGreaterThan 0
            $result | Where-Object { $_['displayName'] -eq 'Normal User' } | Should -BeNullOrEmpty
        }
    }
}
