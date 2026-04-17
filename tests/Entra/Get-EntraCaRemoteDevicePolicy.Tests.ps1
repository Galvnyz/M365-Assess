Describe 'Get-EntraCaRemoteDevicePolicy - Compliant Device Policy with Named Location Exclusion' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ id = 'policy-001'; displayName = 'CMMC Remote Compliant Device'
                   state = 'enabled'
                   grantControls = @{ builtInControls = @('compliantDevice'); operator = 'OR' }
                   conditions    = @{ locations = @{ excludeLocations = @('named-loc-001') } } }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraCaRemoteDevicePolicy.ps1"
    }
    It 'Status is Pass when enabled CA policy requires compliantDevice with named location exclusion' {
        $check = $settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }
    It 'CheckId follows naming convention' {
        ($settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }).CheckId |
            Should -Match '^CA-REMOTEDEVICE-001\.\d+$'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-EntraCaRemoteDevicePolicy - Report-Only Mode' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ id = 'policy-001'; displayName = 'Remote Access (Report-Only)'
                   state = 'enabledForReportingButNotEnforced'
                   grantControls = @{ builtInControls = @('compliantDevice') }
                   conditions    = @{ locations = @{ excludeLocations = @('loc-001') } } }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraCaRemoteDevicePolicy.ps1"
    }
    It 'Status is Warning when policy is report-only' {
        ($settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }).Status | Should -Be 'Warning'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-EntraCaRemoteDevicePolicy - No Named Location Exclusion' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ id = 'policy-001'; displayName = 'Compliant Device No Location'
                   state = 'enabled'
                   grantControls = @{ builtInControls = @('compliantDevice') }
                   conditions    = @{ locations = @{ excludeLocations = @() } } }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraCaRemoteDevicePolicy.ps1"
    }
    It 'Status is Fail when compliantDevice policy has no named location exclusion' {
        ($settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-EntraCaRemoteDevicePolicy - No Policies' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { return @{ value = @() } }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraCaRemoteDevicePolicy.ps1"
    }
    It 'Status is Fail when no CA policies exist' {
        ($settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-EntraCaRemoteDevicePolicy - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraCaRemoteDevicePolicy.ps1"
    }
    It 'Status is Review when Graph returns 403' {
        ($settings | Where-Object { $_.CheckId -like 'CA-REMOTEDEVICE-001*' }).Status | Should -Be 'Review'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
