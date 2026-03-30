BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MailFlowReport' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-AcceptedDomain { }
        function Get-InboundConnector { }
        function Get-OutboundConnector { }
        function Get-TransportRule { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock accepted domains
        Mock Get-AcceptedDomain {
            return @(
                [PSCustomObject]@{
                    DomainName = 'contoso.com'
                    DomainType = 'Authoritative'
                    Default    = $true
                }
                [PSCustomObject]@{
                    DomainName = 'fabrikam.com'
                    DomainType = 'InternalRelay'
                    Default    = $false
                }
            )
        }

        # Mock inbound connectors
        Mock Get-InboundConnector {
            return @(
                [PSCustomObject]@{
                    Name                         = 'Partner Inbound'
                    ConnectorType                = 'Partner'
                    SenderDomains                = @('partner.com')
                    RequireTls                   = $true
                    RestrictDomainsToCertificate  = $false
                    SenderIPAddresses            = @('10.0.0.1')
                    TlsSenderCertificateName     = 'partner.com'
                    Enabled                      = $true
                }
            )
        }

        # Mock outbound connectors
        Mock Get-OutboundConnector {
            return @(
                [PSCustomObject]@{
                    Name             = 'Outbound to Partner'
                    ConnectorType    = 'Partner'
                    RecipientDomains = @('partner.com')
                    UseMXRecord      = $false
                    TlsSettings      = 'EncryptionOnly'
                    SmartHosts       = @('smtp.partner.com')
                    Enabled          = $true
                }
            )
        }

        # Mock transport rules
        Mock Get-TransportRule {
            return @(
                [PSCustomObject]@{
                    Name                  = 'Disclaimer Rule'
                    Priority              = 0
                    Mode                  = 'Enforce'
                    State                 = 'Enabled'
                    SentTo                = $null
                    SentToMemberOf        = $null
                    FromMemberOf          = $null
                    From                  = $null
                    SubjectContainsWords  = $null
                    HasAttachment         = $false
                    AddToRecipients       = $null
                    BlindCopyTo           = $null
                    ModerateMessageByUser = $null
                    RejectMessageReasonText = $null
                    DeleteMessage         = $false
                    PrependSubject        = $null
                    SetHeaderName         = $null
                    SetHeaderValue        = $null
                    ApplyHtmlDisclaimerText = '<p>Confidential</p>'
                }
            )
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailFlowReport.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
        $script:results.Count | Should -BeGreaterOrEqual 4
    }

    It 'Each result has all expected properties' {
        $expectedProps = @('ItemType', 'Name', 'Status', 'Details')
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.Name)' should have property '$prop'"
            }
        }
    }

    It 'Contains items for all four item types' {
        $itemTypes = $script:results | Select-Object -ExpandProperty ItemType -Unique
        $itemTypes | Should -Contain 'Domain'
        $itemTypes | Should -Contain 'InboundConnector'
        $itemTypes | Should -Contain 'OutboundConnector'
        $itemTypes | Should -Contain 'TransportRule'
    }

    It 'Correctly identifies the default domain' {
        $defaultDomain = $script:results | Where-Object {
            $_.ItemType -eq 'Domain' -and $_.Name -eq 'contoso.com'
        }
        $defaultDomain | Should -Not -BeNullOrEmpty
        $defaultDomain.Status | Should -Be 'Default'
    }

    It 'Transport rule includes ApplyDisclaimer action in Details' {
        $rule = $script:results | Where-Object {
            $_.ItemType -eq 'TransportRule' -and $_.Name -eq 'Disclaimer Rule'
        }
        $rule | Should -Not -BeNullOrEmpty
        $rule.Details | Should -Match 'ApplyDisclaimer'
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error and returns nothing' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailFlowReport.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Exchange Online'
        }
    }

    Context 'When tenant has no connectors or rules' {
        It 'Returns only domain entries' {
            Mock Get-OrganizationConfig { return [PSCustomObject]@{ DisplayName = 'Empty' } }
            Mock Get-AcceptedDomain {
                return @([PSCustomObject]@{ DomainName = 'contoso.com'; DomainType = 'Authoritative'; Default = $true })
            }
            Mock Get-InboundConnector { return @() }
            Mock Get-OutboundConnector { return @() }
            Mock Get-TransportRule { return @() }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailFlowReport.ps1"
            $output.Count | Should -Be 1
            $output[0].ItemType | Should -Be 'Domain'
        }
    }
}
