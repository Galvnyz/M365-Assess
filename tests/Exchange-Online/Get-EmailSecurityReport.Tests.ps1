BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-EmailSecurityReport' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-HostedContentFilterPolicy { }
        function Get-AntiPhishPolicy { }
        function Get-MalwareFilterPolicy { }
        function Get-DkimSigningConfig { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock anti-spam policy
        Mock Get-HostedContentFilterPolicy {
            return @(
                [PSCustomObject]@{
                    Name                       = 'Default'
                    IsDefault                  = $true
                    IsEnabled                  = $null
                    BulkThreshold              = 7
                    SpamAction                 = 'MoveToJmf'
                    HighConfidenceSpamAction   = 'Quarantine'
                    PhishSpamAction            = 'Quarantine'
                    BulkSpamAction             = 'MoveToJmf'
                    QuarantineRetentionPeriod  = 30
                    InlineSafetyTipsEnabled    = $true
                    SpamZapEnabled             = $true
                    PhishZapEnabled            = $true
                    AllowedSenders             = @()
                    AllowedSenderDomains       = @()
                    BlockedSenders             = @()
                    BlockedSenderDomains       = @()
                }
            )
        }

        # Mock anti-phish policy
        Mock Get-AntiPhishPolicy {
            return @(
                [PSCustomObject]@{
                    Name                                   = 'Office365 AntiPhish Default'
                    Enabled                                = $true
                    PhishThresholdLevel                    = 2
                    EnableMailboxIntelligence               = $true
                    EnableMailboxIntelligenceProtection     = $true
                    EnableSpoofIntelligence                = $true
                    EnableFirstContactSafetyTips           = $true
                    EnableUnauthenticatedSender            = $true
                    EnableViaTag                           = $true
                    EnableTargetedUserProtection           = $false
                    EnableTargetedDomainsProtection        = $false
                    EnableOrganizationDomainsProtection    = $true
                    TargetedUsersToProtect                 = @()
                }
            )
        }

        # Mock anti-malware policy
        Mock Get-MalwareFilterPolicy {
            return @(
                [PSCustomObject]@{
                    Name                                      = 'Default'
                    IsDefault                                 = $true
                    IsEnabled                                 = $null
                    EnableFileFilter                          = $true
                    FileFilterAction                          = 'Reject'
                    ZapEnabled                                = $true
                    EnableInternalSenderAdminNotifications     = $false
                    EnableExternalSenderAdminNotifications     = $false
                    InternalSenderAdminAddress                = $null
                    ExternalSenderAdminAddress                = $null
                    FileTypes                                 = @('exe', 'bat', 'cmd')
                }
            )
        }

        # Mock DKIM signing config
        Mock Get-DkimSigningConfig {
            return @(
                [PSCustomObject]@{
                    Domain         = 'contoso.com'
                    Enabled        = $true
                    Status         = 'Valid'
                    Selector1CNAME = 'selector1._domainkey.contoso.com'
                    Selector2CNAME = 'selector2._domainkey.contoso.com'
                }
            )
        }

        # Dot-source the collector and capture pipeline output (no DNS checks)
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-EmailSecurityReport.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
        $script:results.Count | Should -BeGreaterOrEqual 4
    }

    It 'Each result has all expected properties' {
        $expectedProps = @('PolicyType', 'Name', 'Enabled', 'KeySettings')
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.Name)' should have property '$prop'"
            }
        }
    }

    It 'Contains entries for all four policy types' {
        $policyTypes = $script:results | Select-Object -ExpandProperty PolicyType -Unique
        $policyTypes | Should -Contain 'AntiSpam'
        $policyTypes | Should -Contain 'AntiPhish'
        $policyTypes | Should -Contain 'AntiMalware'
        $policyTypes | Should -Contain 'DKIM'
    }

    It 'DKIM entry shows correct domain and enabled status' {
        $dkim = $script:results | Where-Object { $_.PolicyType -eq 'DKIM' }
        $dkim | Should -Not -BeNullOrEmpty
        $dkim.Name | Should -Be 'contoso.com'
        $dkim.Enabled | Should -Be $true
    }

    It 'Anti-malware entry includes FileTypesCount in KeySettings' {
        $malware = $script:results | Where-Object { $_.PolicyType -eq 'AntiMalware' }
        $malware | Should -Not -BeNullOrEmpty
        $malware.KeySettings | Should -Match 'FileTypesCount=3'
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-EmailSecurityReport.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Exchange Online'
        }
    }

    Context 'When all policies return empty' {
        It 'Returns an empty list gracefully' {
            Mock Get-OrganizationConfig { return [PSCustomObject]@{ DisplayName = 'Empty' } }
            Mock Get-HostedContentFilterPolicy { return @() }
            Mock Get-AntiPhishPolicy { return @() }
            Mock Get-MalwareFilterPolicy { return @() }
            Mock Get-DkimSigningConfig { return @() }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-EmailSecurityReport.ps1"
            @($output).Count | Should -Be 0
        }
    }
}
