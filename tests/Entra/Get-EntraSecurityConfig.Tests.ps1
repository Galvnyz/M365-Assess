BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-EntraSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub Get-MgContext so the connection check passes
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Default mock for all Graph API calls — returns empty/safe responses
        # Specific endpoints get targeted mocks below
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/identitySecurityDefaultsEnforcementPolicy' {
                    return @{ isEnabled = $false }
                }
                '*/directoryRoles?*Global Administrator*' {
                    return @{ value = @(
                        @{ id = 'ga-role-id'; displayName = 'Global Administrator' }
                    )}
                }
                '*/directoryRoles/ga-role-id/members' {
                    return @{ value = @(
                        @{ displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ displayName = 'Admin Two'; userPrincipalName = 'admin2@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ displayName = 'Admin Three'; userPrincipalName = 'admin3@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                    )}
                }
                '*/policies/authorizationPolicy' {
                    return @{
                        defaultUserRolePermissions = @{
                            permissionGrantPoliciesAssigned = @('ManagePermissionGrantsForSelf.microsoft-user-default-low')
                            allowedToCreateApps            = $false
                            allowedToCreateSecurityGroups  = $true
                            allowedToReadBitlockerKeysForOwnedDevice = $true
                        }
                        allowInvitesFrom     = 'adminsAndGuestInviters'
                        restrictNonAdminUsers = $true
                    }
                }
                '*/policies/adminConsentRequestPolicy' {
                    return @{ isEnabled = $true }
                }
                '*/policies/authenticationMethodsPolicy' {
                    return @{
                        authenticationMethodConfigurations = @(
                            @{ id = 'MicrosoftAuthenticator'; state = 'enabled'; '@odata.type' = '#microsoft.graph.microsoftAuthenticatorAuthenticationMethodConfiguration' }
                            @{ id = 'Sms'; state = 'disabled'; '@odata.type' = '#microsoft.graph.smsAuthenticationMethodConfiguration' }
                        )
                    }
                }
                '*/policies/passwordHashSyncPolicy*' {
                    return @{ isEnabled = $true }
                }
                '*/domains' {
                    return @{ value = @(
                        @{ id = 'contoso.com'; isDefault = $true; isVerified = $true; authenticationType = 'Managed' }
                    )}
                }
                '*/identity/conditionalAccess/policies' {
                    return @{ value = @(
                        @{ id = 'ca-1'; displayName = 'Require MFA'; state = 'enabled'; conditions = @{}; grantControls = @{} }
                    )}
                }
                '*/users?*guest*' {
                    return @{ '@odata.count' = 2 }
                }
                '*/policies/deviceRegistrationPolicy' {
                    return @{
                        azureADRegistration = @{ isAdminConfigurable = $true; allowedToRegister = @{ '@odata.type' = '#microsoft.graph.allDeviceRegistrationMembership' } }
                        azureADJoin         = @{ isAdminConfigurable = $true; allowedToJoin = @{ '@odata.type' = '#microsoft.graph.allDeviceRegistrationMembership' } }
                    }
                }
                '*/groupSettings' {
                    return @{ value = @() }
                }
                '*/policies/crossTenantAccessPolicy/default' {
                    return @{
                        b2bCollaborationInbound  = @{ applications = @{ accessType = 'blocked' } }
                        b2bCollaborationOutbound = @{ applications = @{ accessType = 'blocked' } }
                    }
                }
                '*/groups?*groupTypes*' {
                    return @{ value = @() }
                }
                '*/beta/policies/deviceRegistrationPolicy' {
                    return @{
                        localAdminPassword = @{ isEnabled = $false }
                    }
                }
                '*/beta/roleManagement/directory/roleAssignmentScheduleInstances*' {
                    return @{ value = @() }
                }
                '*/beta/identityGovernance/accessReviews/definitions*' {
                    return @{ value = @() }
                }
                '*/beta/policies/roleManagementPolicies*' {
                    return @{ value = @() }
                }
                '*/directoryRoles/ga-role-id/members?*' {
                    return @{ value = @() }
                }
                '*/users?*select=displayName*' {
                    return @{ value = @(
                        @{ displayName = 'User1'; userPrincipalName = 'user1@contoso.com'; accountEnabled = $true }
                        @{ displayName = 'BreakGlass1'; userPrincipalName = 'breakglass1@contoso.com'; accountEnabled = $true }
                        @{ displayName = 'EmergencyAccess2'; userPrincipalName = 'emergency2@contoso.com'; accountEnabled = $true }
                    )}
                }
                '*/organization' {
                    return @{ value = @(
                        @{ onPremisesSyncEnabled = $false; verifiedDomains = @(@{ name = 'contoso.com' }) }
                    )}
                }
                '*/subscribedSkus' {
                    return @{ value = @(
                        @{ skuId = '06ebc4ee-1bb5-47dd-8120-11324bc54e06'; skuPartNumber = 'SPE_E5'; capabilityStatus = 'Enabled'; prepaidUnits = @{ enabled = 10 }; consumedUnits = 5 }
                    )}
                }
                '*/policies/activityBasedTimeoutPolicies' {
                    return @{ value = @() }
                }
                '*/applications?*' {
                    return @{ value = @() }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraSecurityConfig.ps1"
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

    It 'Global admin count check produces a result with status Pass for 3 admins' {
        $adminCheck = $settings | Where-Object {
            $_.CheckId -like 'ENTRA-ADMIN-001*' -and $_.Setting -eq 'Global Administrator Count'
        }
        $adminCheck | Should -Not -BeNullOrEmpty
        $adminCheck.Status | Should -Be 'Pass'
    }

    It 'Emergency access accounts are detected' {
        $bgCheck = $settings | Where-Object {
            $_.CheckId -like 'ENTRA-ADMIN-003*' -and $_.Setting -eq 'Emergency Access Accounts'
        }
        $bgCheck | Should -Not -BeNullOrEmpty
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

# Note: Dot-sourcing the collector re-initialises $settings and $checkIdCounter,
# so this Describe block gets a fresh state independent of the main Describe above.
Describe 'Get-EntraSecurityConfig - Edge Cases' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Stub Import-Module to prevent actual module loading
        Mock Import-Module { }
    }

    Context 'when Global Administrator role is not activated' {
        BeforeAll {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                switch -Wildcard ($Uri) {
                    '*/directoryRoles?*Global Administrator*' {
                        return @{ value = @() }  # Empty - role not activated
                    }
                    default {
                        return @{ value = @() }
                    }
                }
            }
            . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraSecurityConfig.ps1"
        }

        It 'should not throw' {
            $settings | Should -Not -BeNullOrEmpty
        }

        It 'should produce a Warning status for admin count' {
            $adminCheck = $settings | Where-Object {
                $_.Setting -eq 'Global Administrator Count'
            }
            $adminCheck | Should -Not -BeNullOrEmpty
            $adminCheck.Status | Should -Be 'Warning'
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
