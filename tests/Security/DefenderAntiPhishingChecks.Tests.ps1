BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'DefenderAntiPhishingChecks' {
    BeforeAll {
        # Stub progress function so Add-Setting guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO cmdlets so Mock can find them
        function global:Get-AntiPhishPolicy { }

        # Stub Test-PresetPolicy (shared scope function from Get-DefenderSecurityConfig)
        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        Mock Get-AntiPhishPolicy {
            return @([PSCustomObject]@{
                Name                                = 'Office365 AntiPhish Default'
                IsDefault                           = $true
                PhishThresholdLevel                 = 2
                EnableMailboxIntelligenceProtection  = $true
                EnableTargetedUserProtection         = $true
                EnableTargetedDomainsProtection      = $true
                HonorDmarcPolicy                     = $true
                EnableSpoofIntelligence              = $true
                EnableFirstContactSafetyTips         = $true
            })
        }

        # Set up shared scope that the checks fragment requires
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderAntiPhishingChecks.ps1"
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

    It 'Phishing threshold check passes with level 2' {
        $check = $settings | Where-Object { $_.Setting -like 'Phishing Threshold*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Spoof intelligence check passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Spoof Intelligence*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Honor DMARC check passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Honor DMARC*' }
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
        Remove-Item Function:\Get-AntiPhishPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderAntiPhishingChecks - Failing Policy' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-AntiPhishPolicy { }

        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        # Policy with insecure settings
        Mock Get-AntiPhishPolicy {
            return @([PSCustomObject]@{
                Name                                = 'Office365 AntiPhish Default'
                IsDefault                           = $true
                PhishThresholdLevel                 = 1
                EnableMailboxIntelligenceProtection  = $false
                EnableTargetedUserProtection         = $false
                EnableTargetedDomainsProtection      = $false
                HonorDmarcPolicy                     = $false
                EnableSpoofIntelligence              = $false
                EnableFirstContactSafetyTips         = $false
            })
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderAntiPhishingChecks.ps1"
    }

    It 'Phishing threshold check fails with level 1' {
        $check = $settings | Where-Object { $_.Setting -like 'Phishing Threshold*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Spoof intelligence check fails when disabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Spoof Intelligence*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Honor DMARC check fails when disabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Honor DMARC*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AntiPhishPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderAntiPhishingChecks - Preset Policy' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-AntiPhishPolicy { }

        # Preset policy returns a tier name -- overrides individual checks
        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return 'Standard'
        }

        Mock Get-AntiPhishPolicy {
            return @([PSCustomObject]@{
                Name      = 'Standard Preset Security Policy'
                IsDefault = $false
            })
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderAntiPhishingChecks.ps1"
    }

    It 'Preset-managed policy produces a Pass result' {
        $check = $settings | Where-Object { $_.Setting -like 'Policy (*' -and $_.Category -eq 'Anti-Phishing' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AntiPhishPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
    }
}
