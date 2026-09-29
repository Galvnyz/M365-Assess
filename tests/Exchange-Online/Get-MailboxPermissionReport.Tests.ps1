BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-MailboxPermissionReport' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-EXOMailbox { param($Identity) }
        function Get-MailboxPermission { param($Identity, $ResultSize) }
        function Get-RecipientPermission { param($Identity, $ResultSize) }
        Mock Get-RecipientPermission -ParameterFilter { -not $Identity } {
            @(
                [PSCustomObject]@{ Identity = 'alice@contoso.com'; Trustee = 'NT AUTHORITY\SELF' }
                [PSCustomObject]@{ Identity = 'bob@contoso.com'; Trustee = 'alice@contoso.com' }
                [PSCustomObject]@{ Identity = 'unselected@contoso.com'; Trustee = 'outside@contoso.com' }
            )
        }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock Get-EXOMailbox with two realistic mailboxes
        Mock Get-EXOMailbox {
            param($Identity)
            $targets = @(
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
            if ($Identity) { return $targets | Where-Object { $_.PrimarySmtpAddress -eq $Identity } }
            return $targets
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
        Mock Get-RecipientPermission -ParameterFilter { $Identity } {
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
            Should -Invoke Get-RecipientPermission -Times 0 -Scope It -ParameterFilter { -not $Identity }
        }
    }

    Context 'Bulk Send As collection' {
        It 'uses one unlimited bulk query and keeps self-only mailboxes covered' {
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs
            @($output).Count | Should -Be 1
            $output.MailboxAddress | Should -Be 'bob@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 1 -Exactly -ParameterFilter { -not $Identity -and $ResultSize -eq 'Unlimited' }
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { $Identity }
            Should -Invoke Get-MailboxPermission -Times 0
        }

        It 'falls back for a mailbox absent from the bulk response' {
            Mock Get-RecipientPermission -ParameterFilter { -not $Identity } { [PSCustomObject]@{Identity='alice@contoso.com';Trustee='NT AUTHORITY\SELF'} }
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs
            $output.GrantedTo | Should -Be 'alice@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 1 -Exactly -ParameterFilter { $Identity -eq 'bob@contoso.com' -and $ResultSize -eq 'Unlimited' }
        }

        It 'discards partial bulk output after an error and queries all targets' {
            Mock Get-RecipientPermission -ParameterFilter { -not $Identity } {
                [PSCustomObject]@{Identity='bob@contoso.com';Trustee='partial@contoso.com'}
                throw 'Transient bulk failure'
            }
            $warnings = @()
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs -WarningVariable warnings -WarningAction SilentlyContinue
            $output.GrantedTo | Should -Be 'alice@contoso.com'
            ($warnings -join ' ') | Should -Match 'using individual mailbox queries'
            Should -Invoke Get-RecipientPermission -Times 2 -Exactly -ParameterFilter { $Identity }
        }

        It 'does not infer empty permissions from an unidentified bulk row' {
            Mock Get-RecipientPermission -ParameterFilter { -not $Identity } { [PSCustomObject]@{Trustee='unmapped@contoso.com'} }
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs -WarningAction SilentlyContinue
            $output.GrantedTo | Should -Be 'alice@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 2 -Exactly -ParameterFilter { $Identity }
        }

        It 'uses targeted queries when Identity is specified' {
            $null = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -Identity bob@contoso.com -PermissionType SendAs
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { -not $Identity }
            Should -Invoke Get-RecipientPermission -Times 1 -Exactly -ParameterFilter { $Identity -eq 'bob@contoso.com' }
        }

        It 'avoids a tenant-wide query for a single mailbox' {
            Mock Get-EXOMailbox { [PSCustomObject]@{DisplayName='Bob';PrimarySmtpAddress='bob@contoso.com';GrantSendOnBehalfTo=@()} }
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs
            $output.GrantedTo | Should -Be 'alice@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { -not $Identity }
            Should -Invoke Get-RecipientPermission -Times 1 -ParameterFilter { $Identity }
        }

        It 'falls back instead of merging ambiguous recipient identifiers' {
            Mock Get-EXOMailbox {
                [PSCustomObject]@{DisplayName='Bob';PrimarySmtpAddress='bob@contoso.com';Identity='id-bob';GrantSendOnBehalfTo=@()}
                [PSCustomObject]@{DisplayName='Alice';PrimarySmtpAddress='alice@contoso.com';Identity='id-alice';GrantSendOnBehalfTo=@()}
            }
            Mock Get-RecipientPermission -ParameterFilter { -not $Identity } {
                [PSCustomObject]@{Identity='bob@contoso.com';Trustee='first@contoso.com'}
                [PSCustomObject]@{Identity='id-bob';Trustee='second@contoso.com'}
                [PSCustomObject]@{Identity='id-alice';Trustee='NT AUTHORITY\SELF'}
            }
            $output = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs
            $output.GrantedTo | Should -Be 'alice@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 1 -Exactly -ParameterFilter { $Identity }
        }

        It 'does not query Send As for FullAccess or SendOnBehalf-only reports' {
            $null = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType FullAccess
            $null = & "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendOnBehalf
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { -not $Identity }
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { $Identity }
            Should -Invoke Get-MailboxPermission -Times 2 -Exactly -ParameterFilter { $ResultSize -eq 'Unlimited' }
        }

        It 'preserves all delegates beyond 1000 recipients with one bulk call' {
            Mock Get-EXOMailbox {
                1..2500 | ForEach-Object {
                    [PSCustomObject]@{DisplayName="Mailbox $_";PrimarySmtpAddress="mbx$_@contoso.com";Identity="id-$_";GrantSendOnBehalfTo=@()}
                }
            }
            Mock Get-RecipientPermission -ParameterFilter { -not $Identity } {
                1..2500 | ForEach-Object {
                    [PSCustomObject]@{Identity="id-$_";Trustee="delegate$_@contoso.com"}
                }
            }
            $output = @(& "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-MailboxPermissionReport.ps1" -PermissionType SendAs)
            $output.Count | Should -Be 2500
            $output[-1].GrantedTo | Should -Be 'delegate2500@contoso.com'
            Should -Invoke Get-RecipientPermission -Times 1 -Exactly -ParameterFilter { -not $Identity -and $ResultSize -eq 'Unlimited' }
            Should -Invoke Get-RecipientPermission -Times 0 -ParameterFilter { $Identity }
        }
    }
}
