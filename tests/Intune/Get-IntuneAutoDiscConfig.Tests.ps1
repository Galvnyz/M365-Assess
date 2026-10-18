Describe 'Get-IntuneAutoDiscConfig - MDM auto-enrollment configured' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest -ParameterFilter { $Uri -match 'deviceEnrollmentConfigurations' } {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.deviceEnrollmentWindowsAutoEnrollment'; displayName = 'MDM Auto Enrollment' }
            ) }
        }
        Mock Invoke-MgGraphRequest -ParameterFilter { $Uri -match 'windowsAutopilotDeploymentProfiles' } {
            return @{ value = @() }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAutoDiscConfig.ps1"
    }

    It 'Returns one Pass row for the enrollment config' {
        $settings.Count | Should -Be 1
        $settings[0].Status | Should -Be 'Pass'
    }

    It 'Setting includes config name' {
        $settings[0].Setting | Should -Match 'MDM Auto Enrollment'
    }

    It 'CheckId follows naming convention' {
        $settings[0].CheckId | Should -Match '^INTUNE-AUTODISC-001\.\d+$'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneAutoDiscConfig - Autopilot profiles configured' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest -ParameterFilter { $Uri -match 'deviceEnrollmentConfigurations' } {
            return @{ value = @() }
        }
        Mock Invoke-MgGraphRequest -ParameterFilter { $Uri -match 'windowsAutopilotDeploymentProfiles' } {
            return @{ value = @(
                @{ displayName = 'Corp Autopilot Profile' }
                @{ displayName = 'BYOD Autopilot Profile' }
            ) }
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAutoDiscConfig.ps1"
    }

    It 'Returns one row per Autopilot profile' {
        $settings.Count | Should -Be 2
    }

    It 'All rows are Pass' {
        $settings | ForEach-Object { $_.Status | Should -Be 'Pass' }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneAutoDiscConfig - No enrollment or Autopilot' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

        Mock Invoke-MgGraphRequest { return @{ value = @() } }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAutoDiscConfig.ps1"
    }

    It 'Emits one Warning sentinel row' {
        $settings.Count | Should -Be 1
        $settings[0].Status | Should -Be 'Warning'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-IntuneAutoDiscConfig - Enrollment permission denied' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAutoDiscConfig.ps1"
    }

    It 'Reports Review and the service configuration permission for enrollment' {
        $enrollment = @($settings | Where-Object { $_.CheckId -like 'INTUNE-AUTODISC-001*' })
        $enrollment.Count | Should -Be 1
        $enrollment[0].Status | Should -Be 'Review'
        $enrollment[0].Remediation | Should -Match 'DeviceManagementServiceConfig\.Read\.All'
        $enrollment[0].Remediation | Should -Not -Match 'DeviceManagementConfiguration\.Read\.All'
    }

    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
