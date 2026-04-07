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
