BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-GroupInventory' {
    BeforeAll {
        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-DistributionGroup { }
        function Get-DistributionGroupMember { }
        function Get-UnifiedGroup { }

        # Mock the connection guard
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{ DisplayName = 'Contoso' }
        }

        # Mock distribution groups
        Mock Get-DistributionGroup {
            return @(
                [PSCustomObject]@{
                    DisplayName                        = 'All Staff'
                    PrimarySmtpAddress                 = 'allstaff@contoso.com'
                    RecipientTypeDetails               = 'MailUniversalDistributionGroup'
                    ManagedBy                          = @('admin@contoso.com')
                    WhenCreated                        = [datetime]'2022-03-15'
                    HiddenFromAddressListsEnabled      = $false
                    RequireSenderAuthenticationEnabled = $true
                }
                [PSCustomObject]@{
                    DisplayName                        = 'Security-IT'
                    PrimarySmtpAddress                 = 'security-it@contoso.com'
                    RecipientTypeDetails               = 'MailUniversalSecurityGroup'
                    ManagedBy                          = @('itadmin@contoso.com')
                    WhenCreated                        = [datetime]'2023-01-10'
                    HiddenFromAddressListsEnabled      = $true
                    RequireSenderAuthenticationEnabled = $true
                }
            )
        }

        # Mock distribution group members
        Mock Get-DistributionGroupMember {
            param($Identity)
            if ($Identity -eq 'allstaff@contoso.com') {
                return @(
                    [PSCustomObject]@{ DisplayName = 'Alice'; PrimarySmtpAddress = 'alice@contoso.com' }
                    [PSCustomObject]@{ DisplayName = 'Bob'; PrimarySmtpAddress = 'bob@contoso.com' }
                    [PSCustomObject]@{ DisplayName = 'Carol'; PrimarySmtpAddress = 'carol@contoso.com' }
                )
            }
            return @(
                [PSCustomObject]@{ DisplayName = 'Dave'; PrimarySmtpAddress = 'dave@contoso.com' }
            )
        }

        # Mock M365 groups
        Mock Get-UnifiedGroup {
            return @(
                [PSCustomObject]@{
                    DisplayName                        = 'Project Alpha'
                    PrimarySmtpAddress                 = 'alpha@contoso.com'
                    GroupMemberCount                   = 12
                    GroupExternalMemberCount            = 2
                    ManagedBy                          = @('pm@contoso.com')
                    WhenCreated                        = [datetime]'2024-06-01'
                    AccessType                         = 'Private'
                    HiddenFromAddressListsEnabled      = $false
                    RequireSenderAuthenticationEnabled = $true
                }
            )
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-GroupInventory.ps1"
    }

    It 'Returns a non-empty result list' {
        $script:results | Should -Not -BeNullOrEmpty
        $script:results.Count | Should -Be 3
    }

    It 'Each result has all expected properties' {
        $expectedProps = @(
            'DisplayName', 'PrimarySmtpAddress', 'GroupType', 'MemberCount',
            'ExternalMemberCount', 'ManagedBy', 'WhenCreated', 'AccessType',
            'HiddenFromAddressLists', 'RequireSenderAuthentication'
        )
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.DisplayName)' should have property '$prop'"
            }
        }
    }

    It 'Correctly identifies group types' {
        $dl = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'allstaff@contoso.com' }
        $dl.GroupType | Should -Be 'DistributionList'

        $sec = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'security-it@contoso.com' }
        $sec.GroupType | Should -Be 'MailEnabledSecurity'

        $m365 = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alpha@contoso.com' }
        $m365.GroupType | Should -Be 'M365Group'
    }

    It 'Counts distribution group members correctly' {
        $dl = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'allstaff@contoso.com' }
        $dl.MemberCount | Should -Be 3
    }

    It 'Reports M365 group member and external counts from properties' {
        $m365 = $script:results | Where-Object { $_.PrimarySmtpAddress -eq 'alpha@contoso.com' }
        $m365.MemberCount | Should -Be 12
        $m365.ExternalMemberCount | Should -Be 2
    }

    Context 'When not connected to Exchange Online' {
        It 'Writes an error' {
            Mock Get-OrganizationConfig { throw 'Not connected' }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-GroupInventory.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Exchange Online'
        }
    }

    Context 'When tenant has no groups' {
        It 'Returns nothing' {
            Mock Get-OrganizationConfig { return [PSCustomObject]@{ DisplayName = 'Empty' } }
            Mock Get-DistributionGroup { return @() }
            Mock Get-UnifiedGroup { return @() }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-GroupInventory.ps1"
            $output | Should -BeNullOrEmpty
        }
    }
}
