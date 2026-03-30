BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MailboxInventory' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-EXOMailbox { }
        function Get-EXOMailboxStatistics { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock Get-EXOMailbox with two realistic mailboxes
        Mock Get-EXOMailbox {
            return @(
                [PSCustomObject]@{
                    DisplayName                     = 'Alice Smith'
                    PrimarySmtpAddress              = 'alice@contoso.com'
                    RecipientTypeDetails            = 'UserMailbox'
                    WhenCreated                     = [datetime]'2023-01-15'
                    ForwardingAddress               = $null
                    ForwardingSmtpAddress           = $null
                    DeliverToMailboxAndForward      = $false
                    ArchiveStatus                   = 'None'
                    LitigationHoldEnabled           = $false
                    RetentionPolicy                 = 'Default MRM Policy'
                    HiddenFromAddressListsEnabled   = $false
                    ExchangeObjectId                = 'aaaaaaaa-0000-0000-0000-000000000001'
                }
                [PSCustomObject]@{
                    DisplayName                     = 'Shared-Finance'
                    PrimarySmtpAddress              = 'finance@contoso.com'
                    RecipientTypeDetails            = 'SharedMailbox'
                    WhenCreated                     = [datetime]'2022-06-01'
                    ForwardingAddress               = $null
                    ForwardingSmtpAddress           = 'external@partner.com'
                    DeliverToMailboxAndForward      = $true
                    ArchiveStatus                   = 'Active'
                    LitigationHoldEnabled           = $true
                    RetentionPolicy                 = 'Finance Retention'
                    HiddenFromAddressListsEnabled   = $true
                    ExchangeObjectId                = 'bbbbbbbb-0000-0000-0000-000000000002'
                }
            )
        }

        # Mock mailbox statistics — return realistic TotalItemSize string
        Mock Get-EXOMailboxStatistics {
            return [PSCustomObject]@{
                TotalItemSize = '1.5 GB (1,610,612,736 bytes)'
                ItemCount     = 4200
            }
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-MailboxInventory.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
        $script:results.Count | Should -Be 2
    }

    It 'Each result has all expected properties' {
        $expectedProps = @(
            'DisplayName'
            'PrimarySmtpAddress'
            'RecipientTypeDetails'
            'WhenCreated'
            'TotalItemSizeMB'
            'ItemCount'
            'ArchiveStatus'
            'ForwardingAddress'
            'ForwardingSmtpAddress'
            'DeliverToMailboxAndForward'
            'LitigationHoldEnabled'
            'RetentionPolicy'
            'HiddenFromAddressLists'
        )
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.PrimarySmtpAddress)' should have property '$prop'"
            }
        }
    }

    It 'Correctly maps DisplayName and PrimarySmtpAddress' {
        $alice = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alice@contoso.com' }
        $alice | Should -Not -BeNullOrEmpty
        $alice.DisplayName | Should -Be 'Alice Smith'
    }

    It 'Correctly maps RecipientTypeDetails' {
        $alice   = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alice@contoso.com' }
        $finance = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'finance@contoso.com' }
        $alice.RecipientTypeDetails   | Should -Be 'UserMailbox'
        $finance.RecipientTypeDetails | Should -Be 'SharedMailbox'
    }

    It 'Parses TotalItemSizeMB from statistics bytes string' {
        foreach ($result in $script:results) {
            $result.TotalItemSizeMB | Should -Not -BeNullOrEmpty
            # [math]::Round returns [decimal]; allow decimal or double
            $result.TotalItemSizeMB | Should -BeGreaterThan 0
            { [double]$result.TotalItemSizeMB } | Should -Not -Throw
        }
    }

    It 'Correctly maps ItemCount from statistics' {
        foreach ($result in $script:results) {
            $result.ItemCount | Should -Be 4200
        }
    }

    It 'Correctly maps forwarding properties' {
        $finance = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'finance@contoso.com' }
        $finance.ForwardingSmtpAddress       | Should -Be 'external@partner.com'
        $finance.DeliverToMailboxAndForward  | Should -Be $true
    }

    It 'Correctly maps LitigationHoldEnabled' {
        $alice   = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alice@contoso.com' }
        $finance = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'finance@contoso.com' }
        $alice.LitigationHoldEnabled   | Should -Be $false
        $finance.LitigationHoldEnabled | Should -Be $true
    }

    It 'Correctly maps ArchiveStatus' {
        $alice   = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alice@contoso.com' }
        $finance = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'finance@contoso.com' }
        $alice.ArchiveStatus   | Should -Be 'None'
        $finance.ArchiveStatus | Should -Be 'Active'
    }

    It 'Correctly maps HiddenFromAddressLists (renamed from HiddenFromAddressListsEnabled)' {
        $alice   = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alice@contoso.com' }
        $finance = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'finance@contoso.com' }
        $alice.HiddenFromAddressLists   | Should -Be $false
        $finance.HiddenFromAddressLists | Should -Be $true
    }

    It 'Calls Get-EXOMailbox exactly once' {
        Should -Invoke Get-EXOMailbox -Exactly 1 -Scope Describe
    }

    It 'Calls Get-EXOMailboxStatistics once per mailbox' {
        Should -Invoke Get-EXOMailboxStatistics -Exactly 2 -Scope Describe
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error and does not call Get-EXOMailbox' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            # The collector calls Write-Error which throws under Stop preference;
            # wrap to capture the terminating error without failing the test
            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-MailboxInventory.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Exchange Online'
            Should -Invoke Get-EXOMailbox -Exactly 0 -Scope It
        }
    }

    Context 'When tenant has no mailboxes' {
        It 'Returns nothing' {
            Mock Get-OrganizationConfig { return [PSCustomObject]@{ DisplayName = 'Empty' } }
            Mock Get-EXOMailbox { return @() }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-MailboxInventory.ps1"
            $output | Should -BeNullOrEmpty
        }
    }
}
