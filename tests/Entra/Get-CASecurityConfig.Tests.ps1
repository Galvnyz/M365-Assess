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
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
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
        # 15 checks exist (inc. FALLBACK-001, NAMEDLOC-002, STALEREF-001) but
        # NAMEDLOC-002 is skipped when named locations mock returns empty
        $settings.Count | Should -BeGreaterOrEqual 9
    }

    It 'CA-FALLBACK-001 passes when all enabled policies have include targets' {
        $check = $settings | Where-Object { $_.Setting -eq 'CA Policies with Empty Include Targets' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'CA-STALEREF-001 passes when no referenced groups are deleted' {
        $check = $settings | Where-Object { $_.Setting -eq 'Stale Group References in CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
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

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'Returns settings even with no policies' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All checks should Fail or Pass-by-absence when no policies exist and SD is off' {
        # Checks that correctly Pass when no policies exist (absence is the desired state)
        $passOnAbsence = @('Report-Only Policies', 'Persistent Browser Without Device Compliance',
            'Combined Risk Policy Anti-Pattern', 'Trusted IP Named Locations',
            'Tier-0 Role Coverage in CA Policies',
            'CA Policies with Empty Include Targets',
            'Stale Group References in CA Policies')
        foreach ($s in $settings) {
            if ($s.Setting -in $passOnAbsence) {
                $s.Status | Should -BeIn @('Pass', 'Review') -Because "Setting '$($s.Setting)' should pass or review when no problematic policies exist"
            }
            else {
                $s.Status | Should -Be 'Fail' -Because "Setting '$($s.Setting)' should fail with no CA policies and SD off"
            }
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

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
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

Describe 'Get-CASecurityConfig - CA-REPORTONLY-001 Warning path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # One report-only policy present; security defaults off
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{ value = @() }
            }
            return @{
                value = @(
                    @{
                        id              = 'ca-ro-1'
                        displayName     = 'Audit Only Policy'
                        state           = 'enabledForReportingButNotEnforced'
                        conditions      = @{ users = @{ includeUsers = @('All') }; clientAppTypes = @('browser') }
                        grantControls   = @{ builtInControls = @('mfa') }
                        sessionControls = @{}
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-REPORTONLY-001 returns Warning when report-only policies exist' {
        $check = $settings | Where-Object { $_.Setting -eq 'Report-Only Policies' }
        $check | Should -Not -BeNullOrEmpty -Because 'Report-Only Policies setting should always be emitted'
        $check.Status | Should -Be 'Warning'
    }

    It 'CA-REPORTONLY-001 Warning CurrentValue includes policy count and name' {
        $check = $settings | Where-Object { $_.Setting -eq 'Report-Only Policies' }
        $check.CurrentValue | Should -Match '1'
        $check.CurrentValue | Should -Match 'Audit Only Policy'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - CA-NAMEDLOC-001 Review path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Trusted IP-based named location present; no CA policies so other checks pass trivially
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{
                    value = @(
                        @{
                            '@odata.type' = '#microsoft.graph.ipNamedLocation'
                            id            = 'loc-1'
                            displayName   = 'Corporate HQ'
                            isTrusted     = $true
                            ipRanges      = @(@{ cidrAddress = '203.0.113.0/24' })
                        }
                    )
                }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-NAMEDLOC-001 returns Review when trusted IP locations exist' {
        $check = $settings | Where-Object { $_.Setting -eq 'Trusted IP Named Locations' }
        $check | Should -Not -BeNullOrEmpty -Because 'Trusted IP Named Locations setting should always be emitted'
        $check.Status | Should -Be 'Review'
    }

    It 'CA-NAMEDLOC-001 Review CurrentValue includes location name' {
        $check = $settings | Where-Object { $_.Setting -eq 'Trusted IP Named Locations' }
        $check.CurrentValue | Should -Match 'Corporate HQ'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - CA-SESSION-001 Warning path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # One enabled policy with persistent browser=always without device compliance
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{ value = @() }
            }
            return @{
                value = @(
                    @{
                        id              = 'ca-sess-1'
                        displayName     = 'Persistent Session Policy'
                        state           = 'enabled'
                        conditions      = @{ users = @{ includeUsers = @('All') }; clientAppTypes = @('browser') }
                        grantControls   = @{ builtInControls = @('mfa') }
                        sessionControls = @{
                            persistentBrowser = @{ mode = 'always'; isEnabled = $true }
                        }
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-SESSION-001 returns Warning when persistent browser sessions exist without device compliance' {
        $check = $settings | Where-Object { $_.Setting -eq 'Persistent Browser Without Device Compliance' }
        $check | Should -Not -BeNullOrEmpty -Because 'Persistent Browser setting should always be emitted'
        $check.Status | Should -Be 'Warning'
    }

    It 'CA-SESSION-001 Warning CurrentValue includes policy name' {
        $check = $settings | Where-Object { $_.Setting -eq 'Persistent Browser Without Device Compliance' }
        $check.CurrentValue | Should -Match 'Persistent Session Policy'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - CA-FALLBACK-001 Warning path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # One enabled policy with no include targets at all
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{ value = @() }
            }
            if ($Uri -like '*roleAssignments*') {
                return @{ value = @() }
            }
            return @{
                value = @(
                    @{
                        id              = 'ca-empty-1'
                        displayName     = 'Orphaned Policy'
                        state           = 'enabled'
                        conditions      = @{
                            users           = @{ includeUsers = @('None'); includeGroups = @(); includeRoles = @() }
                            clientAppTypes  = @('browser')
                        }
                        grantControls   = @{ builtInControls = @('mfa') }
                        sessionControls = @{}
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-FALLBACK-001 returns Warning when enabled policies have no include targets' {
        $check = $settings | Where-Object { $_.Setting -eq 'CA Policies with Empty Include Targets' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Warning'
    }

    It 'CA-FALLBACK-001 Warning CurrentValue includes the policy name' {
        $check = $settings | Where-Object { $_.Setting -eq 'CA Policies with Empty Include Targets' }
        $check.CurrentValue | Should -Match 'Orphaned Policy'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - CA-NAMEDLOC-002 Fail path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Policy references a location ID not in the named locations list
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{ value = @(
                    @{ id = 'loc-existing-001'; '@odata.type' = '#microsoft.graph.countryNamedLocation'; displayName = 'US Offices'; isTrusted = $false }
                )}
            }
            if ($Uri -like '*roleAssignments*') {
                return @{ value = @() }
            }
            return @{
                value = @(
                    @{
                        id              = 'ca-stale-loc-1'
                        displayName     = 'Policy With Deleted Location'
                        state           = 'enabled'
                        conditions      = @{
                            users     = @{ includeUsers = @('All') }
                            locations = @{
                                includeLocations = @('loc-deleted-999')
                                excludeLocations = @()
                            }
                        }
                        grantControls   = @{ builtInControls = @('mfa') }
                        sessionControls = @{}
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-NAMEDLOC-002 returns Fail when policies reference deleted named locations' {
        $check = $settings | Where-Object { $_.Setting -eq 'Stale Named Location References in CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'CA-NAMEDLOC-002 Fail CurrentValue includes the affected policy name' {
        $check = $settings | Where-Object { $_.Setting -eq 'Stale Named Location References in CA Policies' }
        $check.CurrentValue | Should -Match 'Policy With Deleted Location'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-CASecurityConfig - CA-STALEREF-001 Fail path' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        $staleGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

        # Policy references a group that returns 404
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') {
                return @{ isEnabled = $false }
            }
            if ($Uri -like '*namedLocations*') {
                return @{ value = @() }
            }
            if ($Uri -like '*roleAssignments*') {
                return @{ value = @() }
            }
            if ($Uri -like "*groups/$staleGroupId*") {
                throw "Request_ResourceNotFound: Resource '$staleGroupId' does not exist."
            }
            return @{
                value = @(
                    @{
                        id              = 'ca-stale-grp-1'
                        displayName     = 'Policy With Deleted Group'
                        state           = 'enabled'
                        conditions      = @{
                            users = @{
                                includeUsers  = @()
                                includeGroups = @($staleGroupId)
                                excludeGroups = @()
                            }
                        }
                        grantControls   = @{ builtInControls = @('mfa') }
                        sessionControls = @{}
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-CASecurityConfig.ps1"
    }

    It 'CA-STALEREF-001 returns Fail when policies reference deleted groups' {
        $check = $settings | Where-Object { $_.Setting -eq 'Stale Group References in CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'CA-STALEREF-001 Fail CurrentValue includes the affected policy name' {
        $check = $settings | Where-Object { $_.Setting -eq 'Stale Group References in CA Policies' }
        $check.CurrentValue | Should -Match 'Policy With Deleted Group'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
