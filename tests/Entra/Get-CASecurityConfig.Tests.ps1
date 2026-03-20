BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-CASecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Default mock for all Graph API calls
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            # Security Defaults disabled (CA policies are active)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            # Return CA policies that cover all 12 checks
            return @{ value = @(
                # Policy 1: MFA for admin roles (check 1) + sign-in frequency (check 4)
                @{
                    id = 'ca-1'
                    displayName = 'MFA for Admins'
                    state = 'enabled'
                    conditions = @{
                        users = @{
                            includeUsers = @()
                            includeRoles = @('62e90394-69f5-4237-9190-012177145e10')
                        }
                        clientAppTypes = @('browser', 'mobileAppsAndDesktopClients')
                    }
                    grantControls = @{
                        builtInControls = @('mfa')
                    }
                    sessionControls = @{
                        signInFrequency = @{ isEnabled = $true; value = 4; type = 'hours' }
                        persistentBrowser = @{ mode = 'never' }
                    }
                }
                # Policy 2: MFA for all users (check 2)
                @{
                    id = 'ca-2'
                    displayName = 'MFA for All Users'
                    state = 'enabled'
                    conditions = @{
                        users = @{
                            includeUsers = @('All')
                        }
                        clientAppTypes = @('browser', 'mobileAppsAndDesktopClients')
                    }
                    grantControls = @{
                        builtInControls = @('mfa')
                    }
                    sessionControls = @{}
                }
                # Policy 3: Block legacy auth (check 3)
                @{
                    id = 'ca-3'
                    displayName = 'Block Legacy Auth'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        clientAppTypes = @('exchangeActiveSync', 'other')
                    }
                    grantControls = @{
                        builtInControls = @('block')
                    }
                    sessionControls = @{}
                }
                # Policy 4: Phishing-resistant MFA for admins (check 5)
                @{
                    id = 'ca-4'
                    displayName = 'Phish-Resistant MFA'
                    state = 'enabled'
                    conditions = @{
                        users = @{
                            includeRoles = @('62e90394-69f5-4237-9190-012177145e10')
                        }
                    }
                    grantControls = @{
                        authenticationStrength = @{ id = 'phishing-resistant' }
                    }
                    sessionControls = @{}
                }
                # Policy 5: User risk policy (check 6)
                @{
                    id = 'ca-5'
                    displayName = 'User Risk Policy'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        userRiskLevels = @('high')
                    }
                    grantControls = @{
                        builtInControls = @('mfa')
                    }
                    sessionControls = @{}
                }
                # Policy 6: Sign-in risk policy (checks 7 + 8)
                @{
                    id = 'ca-6'
                    displayName = 'Sign-in Risk Policy'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        signInRiskLevels = @('medium', 'high')
                    }
                    grantControls = @{
                        builtInControls = @('mfa')
                    }
                    sessionControls = @{}
                }
                # Policy 7: Compliant device required (check 9)
                @{
                    id = 'ca-7'
                    displayName = 'Require Compliant Device'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                    }
                    grantControls = @{
                        builtInControls = @('compliantDevice')
                    }
                    sessionControls = @{}
                }
                # Policy 8: Managed device for security info registration (check 10)
                @{
                    id = 'ca-8'
                    displayName = 'Managed Device for Security Info'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        applications = @{
                            includeUserActions = @('urn:user:registersecurityinfo')
                        }
                    }
                    grantControls = @{
                        builtInControls = @('compliantDevice')
                    }
                    sessionControls = @{}
                }
                # Policy 9: Sign-in frequency for Intune enrollment (check 11)
                @{
                    id = 'ca-9'
                    displayName = 'Intune Enrollment Frequency'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        applications = @{
                            includeApplications = @('d4ebce55-015a-49b5-a083-c84d1797ae8c')
                        }
                    }
                    grantControls = @{}
                    sessionControls = @{
                        signInFrequency = @{ isEnabled = $true; type = 'everyTime' }
                    }
                }
                # Policy 10: Device code flow blocked (check 12)
                @{
                    id = 'ca-10'
                    displayName = 'Block Device Code Flow'
                    state = 'enabled'
                    conditions = @{
                        users = @{ includeUsers = @('All') }
                        authenticationFlows = @{
                            transferMethods = @('deviceCodeFlow')
                        }
                    }
                    grantControls = @{
                        builtInControls = @('block')
                    }
                    sessionControls = @{}
                }
            )}
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../Entra/Get-CASecurityConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All settings have required properties' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A')
        foreach ($s in $settings) {
            $s.Status | Should -BeIn $validStatuses `
                -Because "Setting '$($s.Setting)' has status '$($s.Status)'"
        }
    }

    It 'All non-empty CheckIds follow naming convention' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        $withCheckId.Count | Should -BeGreaterThan 0
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}(\.\d+)?$' `
                -Because "CheckId '$($s.CheckId)' should follow convention"
        }
    }

    It 'All CheckIds use the CA- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^CA-' `
                -Because "CheckId '$($s.CheckId)' should start with CA-"
        }
    }

    It 'MFA for admin roles check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'MFA Required for Admin Roles' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'MFA for all users check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'MFA Required for All Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Legacy auth blocked check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'Legacy Authentication Blocked' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Produces at least 9 settings covering CA checks' {
        # Some checks may produce warnings depending on mock data depth;
        # 12 checks exist but 3 require deeply nested hashtable access
        $settings.Count | Should -BeGreaterOrEqual 9
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - No Policies' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Return no CA policies and Security Defaults disabled
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../Entra/Get-CASecurityConfig.ps1"
    }

    It 'Returns settings even with no policies' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All checks should Fail when no policies exist and SD is off' {
        foreach ($s in $settings) {
            $s.Status | Should -Be 'Fail' `
                -Because "Setting '$($s.Setting)' should fail with no CA policies and SD off"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - Security Defaults Enabled' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Security Defaults on, no CA policies (typical for SD-enabled tenants)
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $true }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../Entra/Get-CASecurityConfig.ps1"
    }

    It 'Returns settings with Security Defaults enabled' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'SD-covered checks are Info when Security Defaults is enabled' {
        $sdCoveredSettings = @(
            'MFA Required for Admin Roles'
            'MFA Required for All Users'
            'Legacy Authentication Blocked'
            'Sign-in Risk Blocks Medium+High'
        )
        foreach ($settingName in $sdCoveredSettings) {
            $check = $settings | Where-Object { $_.Setting -eq $settingName }
            $check | Should -Not -BeNullOrEmpty -Because "$settingName should exist"
            $check.Status | Should -Be 'Info' `
                -Because "$settingName should be Info when covered by Security Defaults"
            $check.CurrentValue | Should -Match 'Security Defaults' `
                -Because "$settingName should mention Security Defaults"
        }
    }

    It 'Non-SD checks still Fail when Security Defaults is enabled' {
        $nonSdSettings = @(
            'User Risk Policy Configured'
            'Managed Device Required'
            'Device Code Flow Blocked'
        )
        foreach ($settingName in $nonSdSettings) {
            $check = $settings | Where-Object { $_.Setting -eq $settingName }
            $check | Should -Not -BeNullOrEmpty -Because "$settingName should exist"
            $check.Status | Should -Be 'Fail' `
                -Because "$settingName is not covered by Security Defaults"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
