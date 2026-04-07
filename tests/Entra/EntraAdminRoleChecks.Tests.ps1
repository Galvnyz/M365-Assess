BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'EntraAdminRoleChecks' {
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
                '*/directoryRoles?*Global Administrator*' {
                    return @{ value = @(
                        @{ id = 'ga-role-id'; displayName = 'Global Administrator' }
                    )}
                }
                '*/directoryRoles/ga-role-id/members' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u2'; displayName = 'Admin Two'; userPrincipalName = 'admin2@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u3'; displayName = 'Admin Three'; userPrincipalName = 'admin3@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                    )}
                }
                '*/directoryRoles/roleTemplateId=62e90394*/members?*onPremisesSyncEnabled*' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com'; onPremisesSyncEnabled = $false }
                        @{ id = 'u2'; displayName = 'Admin Two'; userPrincipalName = 'admin2@contoso.com'; onPremisesSyncEnabled = $false }
                        @{ id = 'u3'; displayName = 'Admin Three'; userPrincipalName = 'admin3@contoso.com'; onPremisesSyncEnabled = $false }
                    )}
                }
                '*/directoryRoles/roleTemplateId=62e90394*/members?*assignedLicenses*' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Admin One'; assignedLicenses = @() }
                        @{ id = 'u2'; displayName = 'Admin Two'; assignedLicenses = @() }
                        @{ id = 'u3'; displayName = 'Admin Three'; assignedLicenses = @() }
                    )}
                }
                '*/directoryRoles/roleTemplateId=62e90394*/members?*id,displayName*' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com' }
                    )}
                }
                '*/subscribedSkus' {
                    return @{ value = @(
                        @{ skuId = '06ebc4ee-1bb5-47dd-8120-11324bc54e06'; skuPartNumber = 'SPE_E5'; capabilityStatus = 'Enabled' }
                    )}
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
                '*/users?*select=displayName*' {
                    return @{ value = @(
                        @{ displayName = 'Regular User'; userPrincipalName = 'user@contoso.com'; accountEnabled = $true }
                        @{ displayName = 'BreakGlass1'; userPrincipalName = 'breakglass1@contoso.com'; accountEnabled = $true }
                        @{ displayName = 'EmergencyAccess2'; userPrincipalName = 'emergency2@contoso.com'; accountEnabled = $true }
                    )}
                }
                '*/beta/reports/authenticationMethods/userRegistrationDetails*' {
                    return @{ value = @(
                        @{ id = 'u1'; userDisplayName = 'Admin One'; isMfaRegistered = $true; methodsRegistered = @('fido2') }
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

        # authPolicy used for Entra Admin Center check
        $authPolicy = @{ restrictNonAdminUsers = $true }

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraAdminRoleChecks.ps1"
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

    It 'Global admin count passes with 3 admins' {
        $check = $settings | Where-Object { $_.Setting -eq 'Global Administrator Count' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Cloud-only admin check passes when no synced admins' {
        $check = $settings | Where-Object { $_.Setting -eq 'Cloud-Only Global Admins' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Entra admin center restriction passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Entra Admin Center Restricted' }
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

Describe 'EntraAdminRoleChecks - Too Many Admins' {
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
                '*/directoryRoles?*Global Administrator*' {
                    return @{ value = @(
                        @{ id = 'ga-role-id'; displayName = 'Global Administrator' }
                    )}
                }
                '*/directoryRoles/ga-role-id/members' {
                    return @{ value = @(
                        @{ id = 'u1'; displayName = 'Admin One'; userPrincipalName = 'admin1@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u2'; displayName = 'Admin Two'; userPrincipalName = 'admin2@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u3'; displayName = 'Admin Three'; userPrincipalName = 'admin3@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u4'; displayName = 'Admin Four'; userPrincipalName = 'admin4@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u5'; displayName = 'Admin Five'; userPrincipalName = 'admin5@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                        @{ id = 'u6'; displayName = 'Admin Six'; userPrincipalName = 'admin6@contoso.com'; '@odata.type' = '#microsoft.graph.user' }
                    )}
                }
                '*/subscribedSkus' { return @{ value = @() } }
                '*/beta/roleManagement/*' { return @{ value = @() } }
                '*/beta/identityGovernance/*' { return @{ value = @() } }
                '*/beta/policies/roleManagementPolicies*' { return @{ value = @() } }
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

        $authPolicy = @{ restrictNonAdminUsers = $false }

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraAdminRoleChecks.ps1"
    }

    It 'Global admin count warns with 6 admins (above recommended maximum)' {
        $check = $settings | Where-Object { $_.Setting -eq 'Global Administrator Count' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Warning'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
