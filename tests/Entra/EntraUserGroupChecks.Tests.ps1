BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'EntraUserGroupChecks' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers, $ErrorAction)
            switch -Wildcard ($Uri) {
                '*/policies/authorizationPolicy' {
                    return @{
                        defaultUserRolePermissions = @{
                            permissionGrantPoliciesAssigned = @('ManagePermissionGrantsForSelf.microsoft-user-default-low')
                            allowedToCreateApps             = $false
                            allowedToCreateSecurityGroups   = $false
                            allowedToCreateTenants          = $false
                        }
                        allowInvitesFrom     = 'adminsAndGuestInviters'
                        guestUserRoleId      = '2af84b1e-32c8-42b7-82bc-daa82404023b'
                        restrictNonAdminUsers = $true
                    }
                }
                '*/policies/adminConsentRequestPolicy' {
                    return @{ isEnabled = $true }
                }
                '*/policies/crossTenantAccessPolicy/default' {
                    return @{
                        b2bCollaborationInbound = @{
                            applications = @{ accessType = 'blocked' }
                        }
                    }
                }
                "*/users/`$count*" {
                    return 5
                }
                '*/groups?*Unified*' {
                    return @{ value = @(
                        @{
                            id          = 'grp-1'
                            displayName = 'Public Team'
                            visibility  = 'Public'
                        }
                    )}
                }
                '*/groups/grp-1/owners*' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Owner One' }
                    )}
                }
                '*/groups?*DynamicMembership*' {
                    return @{ value = @(
                        @{
                            id             = 'dyn-1'
                            displayName    = 'All Guests'
                            membershipRule = 'user.userType -eq "Guest"'
                        }
                    )}
                }
                "*/oauth2PermissionGrants*" {
                    return @{ value = @() }
                }
                '*/beta/organization*' {
                    return @{ linkedInConfiguration = @{ isDisabled = $true } }
                }
                '*/beta/reports/authenticationMethods/userRegistrationDetails*' {
                    return @{ value = @(
                        @{ userPrincipalName = 'user@contoso.com'; isMfaRegistered = $true; isMfaCapable = $true }
                    )}
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        # authPolicy is read from scope by EntraUserGroupChecks
        $authPolicy = @{
            defaultUserRolePermissions = @{
                permissionGrantPoliciesAssigned = @('ManagePermissionGrantsForSelf.microsoft-user-default-low')
                allowedToCreateApps             = $false
                allowedToCreateSecurityGroups   = $false
                allowedToCreateTenants          = $false
            }
            allowInvitesFrom     = 'adminsAndGuestInviters'
            guestUserRoleId      = '2af84b1e-32c8-42b7-82bc-daa82404023b'
            restrictNonAdminUsers = $true
        }

        $context = @{ TenantId = 'test-tenant-id' }

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraUserGroupChecks.ps1"
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
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A', 'Skipped')
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

    It 'Users can register applications passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Users Can Register Applications' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Admin consent workflow passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Admin Consent Workflow Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Guest invitation policy passes when restricted to admins and inviters' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest Invitation Policy' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Guest user access restriction passes with restricted role' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest User Access Restriction' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Dynamic group for guests passes when configured' {
        $check = $settings | Where-Object { $_.Setting -eq 'Dynamic Group for Guest Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Public groups with owners passes when all have owners' {
        $check = $settings | Where-Object { $_.Setting -eq 'Public Groups Have Owners' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'LinkedIn connections passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'LinkedIn Account Connections' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Guest count is reported as Info' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest User Count' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Info'
    }

    It 'Non-admin tenant creation restricted passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Non-Admin Tenant Creation Restricted' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'All checks use ENTRA- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^ENTRA-' `
                -Because "CheckId '$($s.CheckId)' should start with ENTRA-"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'EntraUserGroupChecks - Invitation domain evidence' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"
        function Invoke-MgGraphRequest { param($Method, $Uri, $Headers) }
        Mock Invoke-MgGraphRequest {
            param($Uri)
            if ($Uri -like '*/policies/crossTenantAccessPolicy/default') {
                return $script:crossTenantPolicy
            }
            return @{ value = @() }
        }
        Mock Write-Warning { }
    }

    BeforeEach {
        $ctx = Initialize-SecurityConfig
        $settings = $ctx.Settings
        $context = @{ TenantId = '11111111-1111-1111-1111-111111111111' }
        $authPolicy = @{ allowInvitesFrom = 'adminsAndGuestInviters' }
        $script:crossTenantPolicy = @{
            b2bCollaborationInbound = @{
                applications = @{ accessType = 'allowed'; targets = @(@{ target = 'AllApplications'; targetType = 'application' }) }
                usersAndGroups = @{ accessType = 'allowed'; targets = @(@{ target = 'AllUsers'; targetType = 'user' }) }
            }
        }
    }

    It 'should require domain review with <Inviters> inviters and <Access> inbound access' -ForEach @(
        foreach ($inviters in @('adminsAndGuestInviters', 'adminsGuestInvitersAndAllMembers', 'everyone', 'none')) {
            foreach ($access in @('allowed', 'blocked')) {
                @{ Inviters = $inviters; Access = $access }
            }
        }
    ) {
        $authPolicy.allowInvitesFrom = $Inviters
        $script:crossTenantPolicy.b2bCollaborationInbound.applications.accessType = $Access
        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraUserGroupChecks.ps1"
        $check = @($settings | Where-Object Setting -EQ 'Guest Invitation Domain Restrictions')
        $check.Count | Should -Be 1
        $check[0].Status | Should -Be 'Review'
        $check[0].CurrentValue | Should -Match ([regex]::Escape($Inviters))
        $check[0].CurrentValue | Should -Match 'not collected'
        $check[0].Limitations | Should -Match 'domain allow/block list'
        $check[0].Remediation | Should -Match 'Collaboration restrictions'
        $check[0].Remediation | Should -Match 'Target domains'
        Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Uri -like '*/policies/crossTenantAccessPolicy/default' }
    }

    It 'should retain manual review when <Name> authorization context is unavailable' -ForEach @(
        @{ Name = 'missing'; Policy = $null },
        @{ Name = 'empty'; Policy = @{} },
        @{ Name = 'null inviter'; Policy = @{ allowInvitesFrom = $null } }
    ) {
        $authPolicy = $Policy
        Mock Invoke-MgGraphRequest { throw '403 Forbidden' }
        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraUserGroupChecks.ps1"
        $check = @($settings | Where-Object Setting -EQ 'Guest Invitation Domain Restrictions')
        $check.Count | Should -Be 1
        $check[0].Status | Should -Be 'Review'
        $check[0].CurrentValue | Should -Match 'inviter policy: not collected'
        $check[0].Evidence | Should -Not -Match 'allowInvitesFrom='
        $check[0].Limitations | Should -Match 'domain allow/block list'
    }
}

Describe 'EntraUserGroupChecks - Insecure Settings' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Headers, $ErrorAction)
            switch -Wildcard ($Uri) {
                '*/policies/authorizationPolicy' {
                    return @{
                        defaultUserRolePermissions = @{
                            permissionGrantPoliciesAssigned = @('ManagePermissionGrantsForSelf.microsoft-user-default-legacy')
                            allowedToCreateApps             = $true
                            allowedToCreateSecurityGroups   = $true
                            allowedToCreateTenants          = $true
                        }
                        allowInvitesFrom = 'everyone'
                        guestUserRoleId  = 'a0b1b346-4d3e-4e8b-98f8-753987be4970'
                    }
                }
                '*/policies/adminConsentRequestPolicy' { return @{ isEnabled = $false } }
                '*/policies/crossTenantAccessPolicy/default' { return @{ b2bCollaborationInbound = @{} } }
                '*/groups?*Unified*' { return @{ value = @() } }
                '*/groups?*DynamicMembership*' { return @{ value = @() } }
                "*/oauth2PermissionGrants*" { return @{ value = @( @{ id = 'g1' }, @{ id = 'g2' } ) } }
                '*/beta/organization*' {
                    return @{ linkedInConfiguration = @{ isDisabled = $false } }
                }
                '*/beta/reports/authenticationMethods/userRegistrationDetails*' { return @{ value = @() } }
                "*/users/`$count*" { return 10 }
                default { return @{ value = @() } }
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        $authPolicy = @{
            defaultUserRolePermissions = @{
                permissionGrantPoliciesAssigned = @('ManagePermissionGrantsForSelf.microsoft-user-default-legacy')
                allowedToCreateApps             = $true
                allowedToCreateSecurityGroups   = $true
                allowedToCreateTenants          = $true
            }
            allowInvitesFrom = 'everyone'
            guestUserRoleId  = 'a0b1b346-4d3e-4e8b-98f8-753987be4970'
        }

        $context = @{ TenantId = 'test-tenant-id' }

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraUserGroupChecks.ps1"
    }

    It 'User consent for applications fails with legacy policy' {
        $check = $settings | Where-Object { $_.Setting -eq 'User Consent for Applications' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Users can register applications fails when allowed' {
        $check = $settings | Where-Object { $_.Setting -eq 'Users Can Register Applications' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Guest invitation policy warns when everyone can invite' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest Invitation Policy' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Warning'
    }

    It 'Dynamic guest group fails when none configured' {
        $check = $settings | Where-Object { $_.Setting -eq 'Dynamic Group for Guest Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'LinkedIn connections fails when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'LinkedIn Account Connections' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'EntraUserGroupChecks - Skipped fallback on API error' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-MgContext {
            return @{ TenantId = 'test-tenant-id' }
        }

        Mock Import-Module { }

        # Every Graph call throws to simulate throttle/auth failures
        Mock Invoke-MgGraphRequest {
            throw 'Simulated Graph API error'
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Common/SecurityConfigHelper.ps1"

        $ctx            = Initialize-SecurityConfig
        $settings       = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter

        function Add-Setting {
            param([string]$Category, [string]$Setting, [string]$CurrentValue,
                  [string]$RecommendedValue, [string]$Status,
                  [string]$CheckId = '', [string]$Remediation = '')
            Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
                -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
                -RecommendedValue $RecommendedValue -Status $Status `
                -CheckId $CheckId -Remediation $Remediation
        }

        $authPolicy = $null
        $context    = @{ TenantId = 'test-tenant-id' }

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraUserGroupChecks.ps1"
    }

    It 'should not throw when all Graph calls fail' {
        $settings | Should -Not -BeNullOrEmpty
    }

    It 'should emit a Skipped result for ENTRA-CONSENT-002 when admin consent API fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Admin Consent Workflow Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-CONSENT-003 when verified publisher check fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'User Consent Requires Verified Publisher' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-CONSENT-004 when tenant-wide consent grants fail' {
        $check = $settings | Where-Object { $_.Setting -eq 'Tenant-Wide Admin Consent Grants' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-GUEST-003 when guest count fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest User Count' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-LINKEDIN-001 when LinkedIn API fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'LinkedIn Account Connections' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should retain domain manual review when Graph context is unavailable' {
        $check = $settings | Where-Object { $_.Setting -eq 'Guest Invitation Domain Restrictions' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    It 'should emit a Skipped result for ENTRA-GROUP-002 when dynamic group query fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Dynamic Group for Guest Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-GROUP-003 when group owners query fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Public Groups Have Owners' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should emit a Skipped result for ENTRA-ORGSETTING-001 when app consent policy fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Org-Level App Consent Restriction' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Skipped'
    }

    It 'should include the error message in CurrentValue for skipped checks' {
        $skipped = @($settings | Where-Object { $_.Status -eq 'Skipped' })
        $skipped.Count | Should -BeGreaterThan 0
        foreach ($s in $skipped) {
            $s.CurrentValue | Should -Match 'Error:'
        }
    }

    It 'should still emit Review result for ENTRA-PERUSER-001 even when API call fails' {
        $check = $settings | Where-Object { $_.Setting -eq 'Per-user MFA (Legacy)' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
