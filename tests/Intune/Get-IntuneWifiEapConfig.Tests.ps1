Describe 'Get-IntuneWifiEapConfig - WPA2-Enterprise EAP-TLS Assigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windowsWifiEnterpriseEAPConfiguration'
                   displayName = 'CMMC Wi-Fi EAP-TLS'
                   wifiSecurityType = 'wpa2Enterprise'
                   eapType = 'eapTls'
                   assignments = @(@{ id = 'assign-001'; target = @{ groupId = 'grp-001' } }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneWifiEapConfig.ps1"
    }
    It 'Status is Pass when WPA2-Enterprise EAP-TLS profile is assigned' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }
    It 'CheckId follows naming convention' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).CheckId |
            Should -Match '^INTUNE-WIFI-001\.\d+$'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneWifiEapConfig - Wrong EAP Type (PEAP)' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windowsWifiEnterpriseEAPConfiguration'
                   displayName = 'Wi-Fi PEAP'; wifiSecurityType = 'wpa2Enterprise'
                   eapType = 'peap'
                   assignments = @(@{ id = 'assign-001' }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneWifiEapConfig.ps1"
    }
    It 'Status is Fail when EAP type is not eapTls' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneWifiEapConfig - Profile Unassigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windowsWifiEnterpriseEAPConfiguration'
                   displayName = 'Unassigned EAP-TLS'; wifiSecurityType = 'wpa2Enterprise'
                   eapType = 'eapTls'; assignments = @() }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneWifiEapConfig.ps1"
    }
    It 'Status is Fail when compliant profile has no assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).Status | Should -Be 'Fail'
    }
    It 'CurrentValue mentions no active assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).CurrentValue |
            Should -Match 'no active assignments'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneWifiEapConfig - No Wi-Fi Profiles' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { return @{ value = @() } }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneWifiEapConfig.ps1"
    }
    It 'Status is Fail when no Wi-Fi EAP profiles exist' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneWifiEapConfig - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneWifiEapConfig.ps1"
    }
    It 'Status is Review when Graph returns 403' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-WIFI-001*' }).Status | Should -Be 'Review'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
