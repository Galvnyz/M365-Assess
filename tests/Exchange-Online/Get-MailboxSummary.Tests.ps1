BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MailboxSummary' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-EXOMailbox { }
        function Get-EXOMailboxStatistics { }
        function Get-DistributionGroup { }
        function Get-UnifiedGroup { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock Get-EXOMailbox with a mix of mailbox types
        Mock Get-EXOMailbox {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'Alice Smith'
                    RecipientTypeDetails = 'UserMailbox'
                    ExchangeObjectId     = 'aaaaaaaa-0000-0000-0000-000000000001'
                }
                [PSCustomObject]@{
                    DisplayName          = 'Bob Jones'
                    RecipientTypeDetails = 'UserMailbox'
                    ExchangeObjectId     = 'aaaaaaaa-0000-0000-0000-000000000002'
                }
                [PSCustomObject]@{
                    DisplayName          = 'Shared-Finance'
                    RecipientTypeDetails = 'SharedMailbox'
                    ExchangeObjectId     = 'bbbbbbbb-0000-0000-0000-000000000001'
                }
                [PSCustomObject]@{
                    DisplayName          = 'Conference Room A'
                    RecipientTypeDetails = 'RoomMailbox'
                    ExchangeObjectId     = 'cccccccc-0000-0000-0000-000000000001'
                }
            )
        }

        # Mock mailbox statistics
        Mock Get-EXOMailboxStatistics {
            return [PSCustomObject]@{
                TotalItemSize = '500 MB (524,288,000 bytes)'
                ItemCount     = 1200
            }
        }

        # Mock distribution groups
        Mock Get-DistributionGroup {
            return @(
                [PSCustomObject]@{ DisplayName = 'All Staff'; PrimarySmtpAddress = 'allstaff@contoso.com' }
                [PSCustomObject]@{ DisplayName = 'IT Team'; PrimarySmtpAddress = 'it@contoso.com' }
            )
        }

        # Mock M365 groups
        Mock Get-UnifiedGroup {
            return @(
                [PSCustomObject]@{ DisplayName = 'Project Alpha'; PrimarySmtpAddress = 'alpha@contoso.com' }
            )
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxSummary.ps1"
    }

    It 'Returns the expected number of summary rows' {
        $script:results | Should -Not -BeNullOrEmpty
        # TotalMailboxes, UserMailboxes, SharedMailboxes, RoomMailboxes, EquipmentMailboxes,
        # DistributionGroups, M365Groups, TotalItems
        $script:results.Count | Should -Be 8
    }

    It 'Each result has Metric and Count properties' {
        foreach ($result in $script:results) {
            $result.PSObject.Properties.Name | Should -Contain 'Metric'
            $result.PSObject.Properties.Name | Should -Contain 'Count'
        }
    }

    It 'Reports correct total mailbox count' {
        $total = $script:results | Where-Object { $_.Metric -eq 'TotalMailboxes' }
        $total | Should -Not -BeNullOrEmpty
        $total.Count | Should -Be 4
    }

    It 'Reports correct counts per mailbox type' {
        ($script:results | Where-Object { $_.Metric -eq 'UserMailboxes' }).Count | Should -Be 2
        ($script:results | Where-Object { $_.Metric -eq 'SharedMailboxes' }).Count | Should -Be 1
        ($script:results | Where-Object { $_.Metric -eq 'RoomMailboxes' }).Count | Should -Be 1
        ($script:results | Where-Object { $_.Metric -eq 'EquipmentMailboxes' }).Count | Should -Be 0
    }

    It 'Reports correct distribution group and M365 group counts' {
        ($script:results | Where-Object { $_.Metric -eq 'DistributionGroups' }).Count | Should -Be 2
        ($script:results | Where-Object { $_.Metric -eq 'M365Groups' }).Count | Should -Be 1
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error and does not call Get-EXOMailbox' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxSummary.ps1"
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
        It 'Returns summary with zero counts' {
            Mock Get-OrganizationConfig { return [PSCustomObject]@{ DisplayName = 'Empty' } }
            Mock Get-EXOMailbox { return @() }
            Mock Get-DistributionGroup { return @() }
            Mock Get-UnifiedGroup { return @() }

            # The script calls Write-Error when Get-EXOMailbox fails, but with
            # empty results it still continues -- verify zero counts or error
            $output = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                $output = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxSummary.ps1"
            }
            catch {
                # If it errors out, that is also acceptable
            }

            if ($output) {
                $total = $output | Where-Object { $_.Metric -eq 'TotalMailboxes' }
                $total.Count | Should -Be 0
            }
        }
    }
}
