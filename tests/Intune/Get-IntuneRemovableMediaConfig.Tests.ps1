Describe 'Get-IntuneRemovableMediaConfig - Block Profile Assigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            return @{
                value = @(
                    @{
                        '@odata.type'                = '#microsoft.graph.windows10GeneralConfiguration'
                        displayName                  = 'CMMC Removable Media Block'
                        storageBlockRemovableStorage = $true
                        assignments                  = @(@{ id = 'assign-001'; target = @{ groupId = 'grp-001' } })
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneRemovableMediaConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Status is Pass when block profile exists and is assigned' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'CurrentValue includes the profile name' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.CurrentValue | Should -Match 'CMMC Removable Media Block'
    }

    It 'CheckId follows naming convention' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.CheckId | Should -Match '^INTUNE-REMOVABLEMEDIA-001\.\d+$'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneRemovableMediaConfig - Block Profile Not Assigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            return @{
                value = @(
                    @{
                        '@odata.type'                = '#microsoft.graph.windows10GeneralConfiguration'
                        displayName                  = 'Unassigned Block Policy'
                        storageBlockRemovableStorage = $true
                        assignments                  = @()
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneRemovableMediaConfig.ps1"
    }

    It 'Status is Fail when block profile has no assignments' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.Status | Should -Be 'Fail'
    }

    It 'CurrentValue mentions no active assignments' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.CurrentValue | Should -Match 'no active assignments'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneRemovableMediaConfig - No Block Profile' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest {
            return @{
                value = @(
                    @{
                        '@odata.type'                = '#microsoft.graph.windows10GeneralConfiguration'
                        displayName                  = 'Generic Profile'
                        storageBlockRemovableStorage = $false
                        assignments                  = @(@{ id = 'assign-001' })
                    }
                )
            }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneRemovableMediaConfig.ps1"
    }

    It 'Status is Fail when no removable storage block profile exists' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.Status | Should -Be 'Fail'
    }

    It 'CurrentValue mentions no profile found' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.CurrentValue | Should -Match 'No removable storage block profile found'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneRemovableMediaConfig - Empty Config List' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest { return @{ value = @() } }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneRemovableMediaConfig.ps1"
    }

    It 'Status is Fail when device configuration list is empty' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneRemovableMediaConfig - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneRemovableMediaConfig.ps1"
    }

    It 'Status is Review when Graph returns 403' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOVABLEMEDIA-001*' }
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
