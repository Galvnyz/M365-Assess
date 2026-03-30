BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MailboxPermissionReport' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-EXOMailbox { }
        function Get-MailboxPermission { }
        function Get-RecipientPermission { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock Get-EXOMailbox with two realistic mailboxes
        Mock Get-EXOMailbox {
            return @(
                [PSCustomObject]@{
                    DisplayName          = 'Alice Smith'
                    PrimarySmtpAddress   = 'alice@contoso.com'
                    GrantSendOnBehalfTo  = @('bob@contoso.com')
                }
                [PSCustomObject]@{
                    DisplayName          = 'Bob Jones'
                    PrimarySmtpAddress   = 'bob@contoso.com'
                    GrantSendOnBehalfTo  = @()
                }
            )
        }

        # Mock Get-MailboxPermission with a FullAccess delegation
        Mock Get-MailboxPermission {
            param($Identity)
            if ($Identity -eq 'alice@contoso.com') {
                return @(
                    [PSCustomObject]@{
                        User         = 'bob@contoso.com'
                        AccessRights = @('FullAccess')
                        IsInherited  = $false
                    }
                    # System account -- should be filtered out
                    [PSCustomObject]@{
                        User         = 'NT AUTHORITY\SELF'
                        AccessRights = @('FullAccess')
                        IsInherited  = $false
                    }
                )
            }
            return @()
        }

        # Mock Get-RecipientPermission with a SendAs delegation
        Mock Get-RecipientPermission {
            param($Identity)
            if ($Identity -eq 'bob@contoso.com') {
                return @(
                    [PSCustomObject]@{
                        Trustee = 'alice@contoso.com'
                    }
                )
            }
            return @()
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
    }

    It 'Each result has all expected properties' {
        $expectedProps = @('Mailbox', 'MailboxAddress', 'PermissionType', 'GrantedTo', 'Inherited')
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result should have property '$prop'"
            }
        }
    }

    It 'Detects FullAccess permission and filters system accounts' {
        $fullAccess = $script:results | Where-Object {
            $_.PermissionType -eq 'FullAccess' -and $_.MailboxAddress -eq 'alice@contoso.com'
        }
        $fullAccess | Should -Not -BeNullOrEmpty
        $fullAccess.GrantedTo | Should -Be 'bob@contoso.com'

        # NT AUTHORITY should be filtered out
        $systemEntries = $script:results | Where-Object { $_.GrantedTo -like 'NT AUTHORITY*' }
        $systemEntries | Should -BeNullOrEmpty
    }

    It 'Detects SendAs permission' {
        $sendAs = $script:results | Where-Object {
            $_.PermissionType -eq 'SendAs' -and $_.MailboxAddress -eq 'bob@contoso.com'
        }
        $sendAs | Should -Not -BeNullOrEmpty
        $sendAs.GrantedTo | Should -Be 'alice@contoso.com'
    }

    It 'Detects SendOnBehalf permission' {
        $sendOnBehalf = $script:results | Where-Object {
            $_.PermissionType -eq 'SendOnBehalf' -and $_.MailboxAddress -eq 'alice@contoso.com'
        }
        $sendOnBehalf | Should -Not -BeNullOrEmpty
        $sendOnBehalf.GrantedTo | Should -Be 'bob@contoso.com'
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error and does not call Get-EXOMailbox' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1"
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
            $output = . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1"
            # With no mailboxes, results list will be empty -- output is the empty list
            $permEntries = @($output) | Where-Object { $_.PermissionType }
            $permEntries | Should -BeNullOrEmpty
        }
    }
}
