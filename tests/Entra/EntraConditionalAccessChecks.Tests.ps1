BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'EntraConditionalAccessChecks' {
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
                '*/identity/conditionalAccess/policies' {
                    return @{ value = @(
                        @{ id = 'ca-1'; displayName = 'Require MFA for all users'; state = 'enabled'; conditions = @{}; grantControls = @{} }
                        @{ id = 'ca-2'; displayName = 'Block legacy auth'; state = 'enabled'; conditions = @{}; grantControls = @{} }
                        @{ id = 'ca-3'; displayName = 'Report-only policy'; state = 'enabledForReportingButNotEnforced'; conditions = @{}; grantControls = @{} }
                    )}
                }
                '*/v1.0/policies/deviceRegistrationPolicy' {
                    return @{
                        azureADJoin = @{
                            isAdminConfigurable = $true
                            allowedToJoin = @{ '@odata.type' = '#microsoft.graph.selectedDeviceRegistrationMembership' }
                            localAdmins = @{ enableGlobalAdmins = $false }
                        }
                        userDeviceQuota = 10
                    }
                }
                '*/beta/policies/deviceRegistrationPolicy' {
                    return @{
                        azureADJoin = @{
                            localAdmins = @{
                                registeredUsers = @{ additionalLocalAdminsCount = 0 }
                            }
                        }
                        localAdminPassword = @{ isEnabled = $true }
                    }
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

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraConditionalAccessChecks.ps1"
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

    It 'Total CA policies count is reported as Info' {
        $check = $settings | Where-Object { $_.Setting -eq 'Total CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Info'
    }

    It 'Enabled CA policies check passes when policies are enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Enabled CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Azure AD join restriction passes when restricted' {
        $check = $settings | Where-Object { $_.Setting -eq 'Azure AD Join Restriction' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Maximum devices per user passes when 10 or fewer' {
        $check = $settings | Where-Object { $_.Setting -eq 'Maximum Devices Per User' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Global admins as local admin passes when disabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Global Admins as Local Admin on Join' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'LAPS passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -like '*LAPS*' -or $_.Setting -like '*Local Administrator Password*' }
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

Describe 'EntraConditionalAccessChecks - No CA Policies' {
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
                '*/identity/conditionalAccess/policies' {
                    return @{ value = @() }
                }
                '*/v1.0/policies/deviceRegistrationPolicy' {
                    return @{
                        azureADJoin = @{
                            allowedToJoin = @{ '@odata.type' = '#microsoft.graph.allDeviceRegistrationMembership' }
                            localAdmins = @{ enableGlobalAdmins = $true }
                        }
                        userDeviceQuota = 50
                    }
                }
                '*/beta/policies/deviceRegistrationPolicy' {
                    return @{
                        azureADJoin = @{ localAdmins = @{ registeredUsers = @{ additionalLocalAdminsCount = 0 } } }
                        localAdminPassword = @{ isEnabled = $false }
                    }
                }
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

        . "$PSScriptRoot/../../src/M365-Assess/Entra/EntraConditionalAccessChecks.ps1"
    }

    It 'Enabled CA policies warns when none enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Enabled CA Policies' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Warning'
    }

    It 'Azure AD join restriction fails when all users allowed' {
        $check = $settings | Where-Object { $_.Setting -eq 'Azure AD Join Restriction' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Max devices fails when above 15' {
        $check = $settings | Where-Object { $_.Setting -eq 'Maximum Devices Per User' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'LAPS fails when disabled' {
        $check = $settings | Where-Object { $_.Setting -like '*LAPS*' -or $_.Setting -like '*Local Administrator Password*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-MgContext -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
