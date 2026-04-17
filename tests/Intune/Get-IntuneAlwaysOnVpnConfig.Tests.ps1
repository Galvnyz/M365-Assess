Describe 'Get-IntuneAlwaysOnVpnConfig - Always-On Full Tunnel Assigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'CMMC Always-On VPN'; alwaysOn = $true
                   enableSplitTunneling = $false
                   assignments = @(@{ id = 'assign-001'; target = @{ groupId = 'grp-001' } }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAlwaysOnVpnConfig.ps1"
    }
    It 'Status is Pass when always-on VPN with full tunnel is assigned' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }
    It 'CheckId follows naming convention' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).CheckId |
            Should -Match '^INTUNE-REMOTEVPN-001\.\d+$'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneAlwaysOnVpnConfig - Always-On but Split Tunnel Enabled' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'Always-On Split Tunnel'; alwaysOn = $true
                   enableSplitTunneling = $true
                   assignments = @(@{ id = 'assign-001' }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAlwaysOnVpnConfig.ps1"
    }
    It 'Status is Fail when alwaysOn but split tunneling is enabled' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneAlwaysOnVpnConfig - Always-On Disabled' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'Manual VPN'; alwaysOn = $false
                   enableSplitTunneling = $false
                   assignments = @(@{ id = 'assign-001' }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAlwaysOnVpnConfig.ps1"
    }
    It 'Status is Fail when alwaysOn is false' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneAlwaysOnVpnConfig - Profile Unassigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'Unassigned Always-On VPN'; alwaysOn = $true
                   enableSplitTunneling = $false; assignments = @() }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAlwaysOnVpnConfig.ps1"
    }
    It 'Status is Fail when compliant profile has no assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).Status | Should -Be 'Fail'
    }
    It 'CurrentValue mentions no active assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).CurrentValue |
            Should -Match 'no active assignments'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneAlwaysOnVpnConfig - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneAlwaysOnVpnConfig.ps1"
    }
    It 'Status is Review when Graph returns 403' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-REMOTEVPN-001*' }).Status | Should -Be 'Review'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
