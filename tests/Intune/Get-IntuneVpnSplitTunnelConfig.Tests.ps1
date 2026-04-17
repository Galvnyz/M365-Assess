Describe 'Get-IntuneVpnSplitTunnelConfig - Split Tunnel Disabled and Assigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'CMMC VPN Full Tunnel'
                   enableSplitTunneling = $false
                   assignments = @(@{ id = 'assign-001'; target = @{ groupId = 'grp-001' } }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneVpnSplitTunnelConfig.ps1"
    }
    It 'Returns a non-empty settings list' { $settings.Count | Should -BeGreaterThan 0 }
    It 'Status is Pass when split tunnel is disabled and profile is assigned' {
        $check = $settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }
    It 'CheckId follows naming convention' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).CheckId |
            Should -Match '^INTUNE-VPNCONFIG-001\.\d+$'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneVpnSplitTunnelConfig - Split Tunnel Enabled' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'VPN Split Tunnel'
                   enableSplitTunneling = $true
                   assignments = @(@{ id = 'assign-001' }) }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneVpnSplitTunnelConfig.ps1"
    }
    It 'Status is Fail when split tunneling is enabled' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneVpnSplitTunnelConfig - Profile Exists but Unassigned' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest {
            return @{ value = @(
                @{ '@odata.type' = '#microsoft.graph.windows10VpnConfiguration'
                   displayName = 'Unassigned Full Tunnel VPN'
                   enableSplitTunneling = $false
                   assignments = @() }
            )}
        }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneVpnSplitTunnelConfig.ps1"
    }
    It 'Status is Fail when compliant profile has no assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).Status | Should -Be 'Fail'
    }
    It 'CurrentValue mentions no active assignments' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).CurrentValue |
            Should -Match 'no active assignments'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneVpnSplitTunnelConfig - No VPN Profiles' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { return @{ value = @() } }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneVpnSplitTunnelConfig.ps1"
    }
    It 'Status is Fail when no VPN configuration profiles exist' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).Status | Should -Be 'Fail'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}

Describe 'Get-IntuneVpnSplitTunnelConfig - Forbidden' {
    BeforeAll {
        function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }
        Mock Invoke-MgGraphRequest { throw '403 Forbidden - Authorization_RequestDenied' }
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Intune/Get-IntuneVpnSplitTunnelConfig.ps1"
    }
    It 'Status is Review when Graph returns 403' {
        ($settings | Where-Object { $_.CheckId -like 'INTUNE-VPNCONFIG-001*' }).Status | Should -Be 'Review'
    }
    AfterAll { Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue }
}
