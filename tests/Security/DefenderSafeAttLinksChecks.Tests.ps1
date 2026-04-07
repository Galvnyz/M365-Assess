BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'DefenderSafeAttLinksChecks - With Defender License' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-SafeLinksPolicy { }
        function global:Get-SafeAttachmentPolicy { }
        function global:Get-AtpPolicyForO365 { }

        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-SafeLinksPolicy'      { return [PSCustomObject]@{ Name = 'Get-SafeLinksPolicy' } }
                'Get-SafeAttachmentPolicy' { return [PSCustomObject]@{ Name = 'Get-SafeAttachmentPolicy' } }
                'Get-AtpPolicyForO365'     { return [PSCustomObject]@{ Name = 'Get-AtpPolicyForO365' } }
                default                    { return $null }
            }
        }

        Mock Get-SafeLinksPolicy {
            return @([PSCustomObject]@{
                Name                    = 'Safe Links Policy'
                ScanUrls                = $true
                DoNotTrackUserClicks    = $false
                EnableForInternalSenders = $true
                DeliverMessageAfterScan = $true
            })
        }

        Mock Get-SafeAttachmentPolicy {
            return @([PSCustomObject]@{
                Name     = 'Safe Attachments Policy'
                Enable   = $true
                Action   = 'Block'
                Redirect = $true
            })
        }

        Mock Get-AtpPolicyForO365 {
            return [PSCustomObject]@{
                EnableATPForSPOTeamsODB = $true
                ZapEnabled             = $true
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderSafeAttLinksChecks.ps1"
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

    It 'Real-time URL scanning passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Real-time URL Scanning*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Track user clicks passes when DoNotTrack is false' {
        $check = $settings | Where-Object { $_.Setting -like 'Track User Clicks*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Safe Attachments for SPO/OneDrive/Teams passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -eq 'Safe Attachments for SPO/OneDrive/Teams' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Safe attachment policy action passes with Block' {
        $check = $settings | Where-Object { $_.Setting -like 'Action (*' -and $_.CheckId -like 'DEFENDER-SAFEATTACH*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'All checks use DEFENDER- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^DEFENDER-' `
                -Because "CheckId '$($s.CheckId)' should start with DEFENDER-"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-SafeLinksPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-SafeAttachmentPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderSafeAttLinksChecks - No Defender License' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-SafeLinksPolicy { }
        function global:Get-SafeAttachmentPolicy { }
        function global:Get-AtpPolicyForO365 { }

        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        # No Defender cmdlets available
        Mock Get-Command {
            param($Name, $ErrorAction)
            return $null
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderSafeAttLinksChecks.ps1"
    }

    It 'Returns settings even when not licensed' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Safe Links availability shows Review status when not licensed' {
        $check = $settings | Where-Object { $_.Setting -eq 'Safe Links Availability' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    It 'Safe Attachments availability shows Review status when not licensed' {
        $check = $settings | Where-Object { $_.Setting -eq 'Safe Attachments Availability' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-SafeLinksPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-SafeAttachmentPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
