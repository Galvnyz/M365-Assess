Describe 'Get-EntraAdminRoleSeparationConfig - Admin Has No Exchange Plans' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $ErrorAction)
            if ($Uri -match 'roleAssignments') {
                return @{ value = @(@{ principalId = 'user-001' }) }
            }
            if ($Uri -match 'licenseDetails') {
                return @{
                    value = @(@{ servicePlans = @(@{ servicePlanId = 'aad-premium-plan-guid' }) })
                }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Status is Pass when no admin has Exchange plans' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'CheckId follows naming convention' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.CheckId | Should -Match '^ENTRA-ADMINROLE-SEPARATION-001\.\d+$'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-EntraAdminRoleSeparationConfig - Admin Has Exchange Plan 1' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $ErrorAction)
            if ($Uri -match 'roleAssignments') {
                return @{ value = @(@{ principalId = 'admin-001' }) }
            }
            if ($Uri -match 'licenseDetails') {
                return @{
                    value = @(@{ servicePlans = @(@{ servicePlanId = 'efb87545-963c-4e0d-99df-69c6916d9eb0' }) })
                }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
    }

    It 'Status is Fail when admin has Exchange Plan 1' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.Status | Should -Be 'Fail'
    }

    It 'CurrentValue mentions Exchange Online' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.CurrentValue | Should -Match 'Exchange Online'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-EntraAdminRoleSeparationConfig - Admin Has Exchange Plan 2' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $ErrorAction)
            if ($Uri -match 'roleAssignments') {
                return @{ value = @(@{ principalId = 'admin-002' }) }
            }
            if ($Uri -match 'licenseDetails') {
                return @{
                    value = @(@{ servicePlans = @(@{ servicePlanId = '19ec0d23-8335-4cbd-94ac-6050e30712fa' }) })
                }
            }
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
    }

    It 'Status is Fail when admin has Exchange Plan 2' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-EntraAdminRoleSeparationConfig - No Role Assignments' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest { return @{ value = @() } }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
    }

    It 'Status is Pass when no privileged role assignments exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.Status | Should -Be 'Pass'
    }

    It 'CurrentValue mentions no assignments found' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.CurrentValue | Should -Match 'No privileged role assignments found'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-EntraAdminRoleSeparationConfig - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
    }

    It 'Status is Review when Graph returns 403' {
        $check = $settings | Where-Object { $_.CheckId -like 'ENTRA-ADMINROLE-SEPARATION-001*' }
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
