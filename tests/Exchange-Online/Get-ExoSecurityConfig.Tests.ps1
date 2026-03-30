BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-ExoSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO cmdlets so Mock can find them
        function Get-OrganizationConfig { }
        function Get-ExternalInOutlook { }
        function Get-RemoteDomain { }
        function Get-OwaMailboxPolicy { }
        function Get-SharingPolicy { }
        function Get-MailboxAuditBypassAssociation { }
        function Get-TransportConfig { }
        function Get-RoleAssignmentPolicy { }
        function Get-HostedConnectionFilterPolicy { }
        function Get-TransportRule { }
        function Get-Mailbox { }
        function Get-InboundConnector { }

        # Mock all Exchange Online cmdlets with realistic data
        Mock Get-OrganizationConfig {
            return [PSCustomObject]@{
                OAuth2ClientProfileEnabled          = $true
                AuditDisabled                       = $false
                CustomerLockBoxEnabled              = $true
                MailTipsAllTipsEnabled               = $true
                MailTipsExternalRecipientsTipsEnabled = $true
                MailTipsGroupMetricsEnabled          = $true
                MailTipsLargeAudienceThreshold       = 25
            }
        }

        Mock Get-ExternalInOutlook {
            return [PSCustomObject]@{ Enabled = $true }
        }

        Mock Get-RemoteDomain {
            return [PSCustomObject]@{ AutoForwardEnabled = $false }
        }

        Mock Get-OwaMailboxPolicy {
            return @([PSCustomObject]@{
                Name                             = 'OwaMailboxPolicy-Default'
                AdditionalStorageProvidersAvailable = $false
            })
        }

        Mock Get-SharingPolicy {
            return @([PSCustomObject]@{
                Default = $true
                Domains = @('contoso.com: CalendarSharingFreeBusySimple')
            })
        }

        Mock Get-MailboxAuditBypassAssociation {
            return @()
        }

        Mock Get-TransportConfig {
            return [PSCustomObject]@{
                SmtpClientAuthenticationDisabled = $true
            }
        }

        Mock Get-RoleAssignmentPolicy {
            return @([PSCustomObject]@{
                Name          = 'Default Role Assignment Policy'
                IsDefault     = $true
                AssignedRoles = @('MyBaseOptions', 'MyContactInformation')
            })
        }

        Mock Get-HostedConnectionFilterPolicy {
            return @([PSCustomObject]@{
                Name           = 'Default'
                IPAllowList    = @()
                EnableSafeList = $false
            })
        }

        Mock Get-TransportRule {
            return @()
        }

        Mock Get-Mailbox {
            return @(
                [PSCustomObject]@{ UserPrincipalName = 'user1@contoso.com'; AuditEnabled = $true }
                [PSCustomObject]@{ UserPrincipalName = 'user2@contoso.com'; AuditEnabled = $true }
            )
        }

        # Mock Get-Command to indicate Get-InboundConnector is available
        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Get-InboundConnector') {
                return [PSCustomObject]@{ Name = 'Get-InboundConnector' }
            }
            if ($Name -eq 'Update-CheckProgress') {
                return [PSCustomObject]@{ Name = 'Update-CheckProgress' }
            }
            return $null
        }

        Mock Get-InboundConnector {
            return @([PSCustomObject]@{
                Name                       = 'Partner Connector'
                Enabled                    = $true
                RequireTls                 = $true
                RestrictDomainsToIPAddresses = $true
            })
        }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            if ($Uri -like '*/subscribedSkus*') {
                return @{ value = @(
                    @{ skuId = '06ebc4ee-1bb5-47dd-8120-11324bc54e06'; skuPartNumber = 'SPE_E5'; capabilityStatus = 'Enabled' }
                )}
            }
            return @{ accountEnabled = $false }
        }

        # Shared mailboxes mock - no shared mailboxes to keep simple
        # The collector calls Get-Mailbox with -RecipientTypeDetails SharedMailbox too
        # We need to handle both calls via parameter filter
        Mock Get-Mailbox -ParameterFilter { $RecipientTypeDetails -eq 'SharedMailbox' } {
            return @()
        }

        Mock Get-Mailbox -ParameterFilter { $RecipientTypeDetails -eq 'UserMailbox' } {
            return @(
                [PSCustomObject]@{ UserPrincipalName = 'user1@contoso.com'; AuditEnabled = $true }
                [PSCustomObject]@{ UserPrincipalName = 'user2@contoso.com'; AuditEnabled = $true }
            )
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-ExoSecurityConfig.ps1"
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

    It 'All CheckIds use the EXO- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^EXO-' `
                -Because "CheckId '$($s.CheckId)' should start with EXO-"
        }
    }

    It 'Modern authentication check passes' {
        $check = $settings | Where-Object { $_.Setting -eq 'Modern Authentication Enabled' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'SMTP AUTH disabled check passes' {
        $check = $settings | Where-Object { $_.Setting -like 'SMTP AUTH Disabled*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Auto-forward to external check passes' {
        $check = $settings | Where-Object { $_.Setting -like 'Auto-Forward*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
