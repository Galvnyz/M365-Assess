BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DefenderSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO/Defender cmdlets so Mock can find them
        function Get-AntiPhishPolicy { }
        function Get-HostedContentFilterPolicy { }
        function Get-MalwareFilterPolicy { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }
        function Get-AtpPolicyForO365 { }
        function Get-HostedOutboundSpamFilterPolicy { }
        function Get-EOPProtectionPolicyRule { }

        # Mock Get-Command to indicate Defender P1+ cmdlets are available
        Mock Get-Command {
            param($Name, $ErrorAction)
            switch ($Name) {
                'Get-SafeLinksPolicy'         { return [PSCustomObject]@{ Name = 'Get-SafeLinksPolicy' } }
                'Get-SafeAttachmentPolicy'    { return [PSCustomObject]@{ Name = 'Get-SafeAttachmentPolicy' } }
                'Get-AtpPolicyForO365'        { return [PSCustomObject]@{ Name = 'Get-AtpPolicyForO365' } }
                'Get-EOPProtectionPolicyRule' { return [PSCustomObject]@{ Name = 'Get-EOPProtectionPolicyRule' } }
                'Update-CheckProgress'        { return [PSCustomObject]@{ Name = 'Update-CheckProgress' } }
                default { return $null }
            }
        }

        # 1. Anti-Phishing Policies
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

        # 2. Anti-Spam Policies
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

        # 3. Anti-Malware Policies
        Mock Get-MalwareFilterPolicy {
            return @([PSCustomObject]@{
                Name                                  = 'Default'
                IsDefault                             = $true
                EnableFileFilter                      = $true
                ZapEnabled                            = $true
                EnableInternalSenderAdminNotifications = $true
                FileTypes                             = @('ace','ani','apk','app','cab','cmd','com','deb',
                    'dmg','exe','hta','img','iso','jar','js','jse','lnk','msi','pif','ps1',
                    'reg','rgs','scr','sct','vb','vbe','vbs','vhd','vxd','wsc','wsf','wsh')
            })
        }

        # 4. Safe Links Policies
        Mock Get-SafeLinksPolicy {
            return @([PSCustomObject]@{
                Name                    = 'Built-In Protection Policy'
                ScanUrls                = $true
                DoNotTrackUserClicks    = $false
                EnableForInternalSenders = $true
                DeliverMessageAfterScan = $true
            })
        }

        # 5. Safe Attachments Policies
        Mock Get-SafeAttachmentPolicy {
            return @([PSCustomObject]@{
                Name     = 'Built-In Protection Policy'
                Enable   = $true
                Action   = 'Block'
                Redirect = $true
            })
        }

        # 5b. ATP Policy for O365 (SPO/OneDrive/Teams + ZAP for Teams)
        Mock Get-AtpPolicyForO365 {
            return [PSCustomObject]@{
                EnableATPForSPOTeamsODB = $true
                ZapEnabled             = $true
            }
        }

        # 6. Outbound Spam Policies
        Mock Get-HostedOutboundSpamFilterPolicy {
            return @([PSCustomObject]@{
                Name                       = 'Default'
                IsDefault                  = $true
                AutoForwardingMode         = 'Off'
                BccSuspiciousOutboundMail  = $true
                NotifyOutboundSpam         = $true
            })
        }

        # 9. EOP Protection Policy Rules (priority accounts)
        Mock Get-EOPProtectionPolicyRule {
            return @(
                [PSCustomObject]@{
                    Identity         = 'Strict Preset Security Policy'
                    SentTo           = @('admin@contoso.com')
                    SentToMemberOf   = @()
                    RecipientDomainIs = @()
                }
                [PSCustomObject]@{
                    Identity         = 'Standard Preset Security Policy'
                    SentTo           = @()
                    SentToMemberOf   = @('all-users@contoso.com')
                    RecipientDomainIs = @()
                }
            )
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../Security/Get-DefenderSecurityConfig.ps1"
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

    It 'All CheckIds use DEFENDER- or EXO- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^(DEFENDER|EXO)-' `
                -Because "CheckId '$($s.CheckId)' should start with DEFENDER- or EXO-"
        }
    }

    It 'Phishing threshold check passes with level 2' {
        $check = $settings | Where-Object { $_.Setting -like 'Phishing Threshold*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Common attachment filter check passes' {
        $check = $settings | Where-Object { $_.Setting -like 'Common Attachment Filter*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Safe Attachments for SPO/OneDrive/Teams check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'Safe Attachments for SPO/OneDrive/Teams' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 5
    }

    It 'Produces at least 25 settings for a fully licensed tenant' {
        $settings.Count | Should -BeGreaterOrEqual 25
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DefenderSecurityConfig - No Defender License' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO/Defender cmdlets so Mock can find them
        function Get-AntiPhishPolicy { }
        function Get-HostedContentFilterPolicy { }
        function Get-MalwareFilterPolicy { }
        function Get-SafeLinksPolicy { }
        function Get-SafeAttachmentPolicy { }
        function Get-AtpPolicyForO365 { }
        function Get-HostedOutboundSpamFilterPolicy { }
        function Get-EOPProtectionPolicyRule { }

        # Mock Get-Command to indicate no Defender P1+ cmdlets
        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Update-CheckProgress') {
                return [PSCustomObject]@{ Name = 'Update-CheckProgress' }
            }
            return $null
        }

        # Basic EOP policies still available without Defender license
        Mock Get-AntiPhishPolicy {
            return @([PSCustomObject]@{
                Name                    = 'Office365 AntiPhish Default'
                IsDefault               = $true
                PhishThresholdLevel     = 1
                EnableSpoofIntelligence = $true
            })
        }

        Mock Get-HostedContentFilterPolicy {
            return @([PSCustomObject]@{
                Name                      = 'Default'
                IsDefault                 = $true
                BulkThreshold             = 7
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

        Mock Get-MalwareFilterPolicy {
            return @([PSCustomObject]@{
                Name                                  = 'Default'
                IsDefault                             = $true
                EnableFileFilter                      = $false
                ZapEnabled                            = $true
                EnableInternalSenderAdminNotifications = $false
                FileTypes                             = @()
            })
        }

        Mock Get-HostedOutboundSpamFilterPolicy {
            return @([PSCustomObject]@{
                Name                       = 'Default'
                IsDefault                  = $true
                AutoForwardingMode         = 'Automatic'
                BccSuspiciousOutboundMail  = $false
                NotifyOutboundSpam         = $false
            })
        }

        . "$PSScriptRoot/../../Security/Get-DefenderSecurityConfig.ps1"
    }

    It 'Returns settings even without Defender license' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'Safe Links shows Review status when not licensed' {
        $check = $settings | Where-Object { $_.Setting -like 'Safe Links*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    It 'Safe Attachments shows Review status when not licensed' {
        $check = $settings | Where-Object { $_.Setting -like 'Safe Attachments*' -and $_.CheckId -like 'DEFENDER-SAFEATTACH-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
