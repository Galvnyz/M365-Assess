BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'DefenderAntiSpamChecks' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-HostedContentFilterPolicy { }
        function global:Get-HostedOutboundSpamFilterPolicy { }

        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        Mock Get-HostedContentFilterPolicy {
            return @([PSCustomObject]@{
                Name                      = 'Default'
                IsDefault                 = $true
                BulkThreshold             = 6
                SpamAction                = 'MoveToJmf'
                HighConfidenceSpamAction  = 'Quarantine'
                HighConfidencePhishAction = 'Quarantine'
                PhishSpamAction           = 'Quarantine'
                ZapEnabled                = $true
                SpamZapEnabled            = $true
                PhishZapEnabled           = $true
                AllowedSenderDomains      = @()
            })
        }

        Mock Get-HostedOutboundSpamFilterPolicy {
            return @([PSCustomObject]@{
                Name                       = 'Default'
                IsDefault                  = $true
                AutoForwardingMode         = 'Off'
                BccSuspiciousOutboundMail  = $true
                NotifyOutboundSpam         = $true
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderAntiSpamChecks.ps1"
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

    It 'BCL threshold passes with value 6' {
        $check = $settings | Where-Object { $_.Setting -like 'Bulk Complaint Level*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'High confidence phish action passes with Quarantine' {
        $check = $settings | Where-Object { $_.Setting -like 'High Confidence Phish Action*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'ZAP check passes when enabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Zero-Hour Auto Purge*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Allowed sender domains passes when empty' {
        $check = $settings | Where-Object { $_.Setting -like 'Allowed Sender Domains*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Auto-forwarding passes when set to Off' {
        $check = $settings | Where-Object { $_.Setting -like 'Auto-Forwarding Mode*' }
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
        Remove-Item Function:\Get-HostedContentFilterPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-HostedOutboundSpamFilterPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}

Describe 'DefenderAntiSpamChecks - Insecure Settings' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function global:Get-HostedContentFilterPolicy { }
        function global:Get-HostedOutboundSpamFilterPolicy { }

        function global:Test-PresetPolicy {
            param([string]$PolicyName)
            return $null
        }

        Mock Get-HostedContentFilterPolicy {
            return @([PSCustomObject]@{
                Name                      = 'Default'
                IsDefault                 = $true
                BulkThreshold             = 9
                SpamAction                = 'MoveToJmf'
                HighConfidenceSpamAction  = 'MoveToJmf'
                HighConfidencePhishAction = 'MoveToJmf'
                PhishSpamAction           = 'MoveToJmf'
                ZapEnabled                = $false
                SpamZapEnabled            = $false
                PhishZapEnabled           = $false
                AllowedSenderDomains      = @('contoso.com', 'fabrikam.com')
            })
        }

        Mock Get-HostedOutboundSpamFilterPolicy {
            return @([PSCustomObject]@{
                Name               = 'Default'
                IsDefault          = $true
                AutoForwardingMode = 'Automatic'
                BccSuspiciousOutboundMail = $false
                NotifyOutboundSpam = $false
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

        . "$PSScriptRoot/../../src/M365-Assess/Security/DefenderAntiSpamChecks.ps1"
    }

    It 'BCL threshold fails or warns with value 9' {
        $check = $settings | Where-Object { $_.Setting -like 'Bulk Complaint Level*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -BeIn @('Fail', 'Warning')
    }

    It 'High confidence phish action fails when not Quarantine' {
        $check = $settings | Where-Object { $_.Setting -like 'High Confidence Phish Action*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'ZAP check fails when disabled' {
        $check = $settings | Where-Object { $_.Setting -like 'Zero-Hour Auto Purge*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Allowed sender domains fails when domains are configured' {
        $check = $settings | Where-Object { $_.Setting -like 'Allowed Sender Domains*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Auto-forwarding warns or fails when not Off' {
        $check = $settings | Where-Object { $_.Setting -like 'Auto-Forwarding Mode*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -BeIn @('Warning', 'Fail')
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-HostedContentFilterPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Get-HostedOutboundSpamFilterPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Test-PresetPolicy -ErrorAction SilentlyContinue
        Remove-Item Function:\Add-Setting -ErrorAction SilentlyContinue
    }
}
