BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'DefenderPresetZapChecks - With Preset Policies' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-AtpPolicyForO365 { }

        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Get-AtpPolicyForO365') {
                return [PSCustomObject]@{ Name = 'Get-AtpPolicyForO365' }
            }
            return $null
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

        # Pre-populate the script-scoped eopRules variable that DefenderPresetZapChecks reads
        $script:eopRules = @(
            [PSCustomObject]@{
                Identity          = 'Strict Preset Security Policy'
                SentTo            = @('admin@contoso.com')
                SentToMemberOf    = @()
                RecipientDomainIs = @()
            }
            [PSCustomObject]@{
                Identity          = 'Standard Preset Security Policy'
                SentTo            = @()
                SentToMemberOf    = @('all-users@contoso.com')
                RecipientDomainIs = @()
            }
        )

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderPresetZapChecks.ps1"
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

    It 'Preset security policies configured check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'Preset Security Policies Configured' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Strict preset covers priority users check passes when SentTo is populated' {
        $check = $settings | Where-Object { $_.Setting -eq 'Strict Preset Covers Priority Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'ZAP for Teams passes when ZapEnabled is true' {
        $check = $settings | Where-Object { $_.Setting -eq 'ZAP for Teams' }
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
        Remove-Item Function:\Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderPresetZapChecks - No Preset Policies' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-AtpPolicyForO365 { }

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

        # No EOP rules -- simulates tenant without preset policies loaded
        $script:eopRules = @()

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderPresetZapChecks.ps1"
    }

    It 'Returns settings even without preset policies' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Preset security policies check shows Review when no rules found' {
        $check = $settings | Where-Object { $_.Setting -eq 'Preset Security Policies Configured' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    It 'Strict preset covers priority users shows Review when no rules found' {
        $check = $settings | Where-Object { $_.Setting -eq 'Strict Preset Covers Priority Users' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
