BeforeAll {
    $script:collectorPath = Join-Path $PSScriptRoot '../../src/M365-Assess/Compromise/Get-CompromiseIndicators.ps1'

    function global:Update-CheckProgress { param($CheckId, $Setting, $Status) }

    # Stubs so Pester can mock Exchange Online and Graph without the modules.
    function Get-AcceptedDomain { param($ErrorAction) }
    function Get-EXOMailbox { param($ResultSize, $Properties, $ErrorAction) }
    function Get-InboxRule { param($Mailbox, [switch]$IncludeHidden, $ErrorAction) }
    function Get-Recipient { param($Identity, $ErrorAction) }
    function Invoke-MgGraphRequest { param($Method, $Uri, $Body, $Headers, $OutputFilePath, $ErrorAction) }

    function New-TestMailbox {
        param([string]$Upn, [string]$ForwardingSmtpAddress = '', [string]$ForwardingAddress = '', [bool]$KeepCopy = $false)
        [PSCustomObject]@{
            UserPrincipalName          = $Upn
            PrimarySmtpAddress         = $Upn
            Identity                   = $Upn
            ForwardingSmtpAddress      = $ForwardingSmtpAddress
            ForwardingAddress          = $ForwardingAddress
            DeliverToMailboxAndForward = $KeepCopy
        }
    }

    function New-TestRule {
        param(
            [string]$Name = 'Rule', [bool]$Enabled = $true, [string[]]$ForwardTo = @(), [string[]]$RedirectTo = @(),
            [string[]]$ForwardAsAttachmentTo = @(), [bool]$DeleteMessage = $false, [string]$MoveToFolder = '',
            [string[]]$SubjectContainsWords = @()
        )
        [PSCustomObject]@{
            Name = $Name; Enabled = $Enabled; ForwardTo = $ForwardTo; RedirectTo = $RedirectTo
            ForwardAsAttachmentTo = $ForwardAsAttachmentTo; DeleteMessage = $DeleteMessage; MoveToFolder = $MoveToFolder
            SubjectContainsWords = $SubjectContainsWords; BodyContainsWords = @(); SubjectOrBodyContainsWords = @()
            FromAddressContainsWords = @()
        }
    }

    function New-TestAuditEvent {
        param([string]$Activity, [string]$Actor = 'admin@contoso.com', [string]$Target = 'Target', [hashtable[]]$Modified = @())
        @{
            activityDateTime    = '2026-11-10T09:15:00Z'
            activityDisplayName = $Activity
            result              = 'success'
            initiatedBy         = @{ user = @{ userPrincipalName = $Actor; ipAddress = '203.0.113.7' } }
            targetResources     = @(@{ displayName = $Target; modifiedProperties = $Modified })
        }
    }

    function Get-Finding {
        param([object[]]$Results, [string]$Setting)
        @($Results | Where-Object { $_.Setting -eq $Setting })[0]
    }
}

AfterAll {
    Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    Remove-Variable -Name IocTestRuleCalls -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Get-CompromiseIndicators mailbox scope' {
    BeforeAll {
        Mock Start-Sleep { }
        Mock Write-Progress { }
    }

    Context 'when every mailbox is clean and fully examined' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @((New-TestMailbox -Upn 'a@contoso.com'), (New-TestMailbox -Upn 'b@contoso.com')) }
            Mock Get-InboxRule {
                @(New-TestRule -Name 'Internal forward' -ForwardTo '"Colleague" [SMTP:c@contoso.com]', '"Team" [EX:/o=ExchangeLabs/cn=team]')
            }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should emit the three mailbox checks' {
            $script:results.Count | Should -Be 3
            $script:results.CheckId | Should -Be @('IOC-INBOXRULE-001.1', 'IOC-INBOXRULE-002.1', 'IOC-FORWARD-001.1')
        }

        It 'should pass <Setting>' -ForEach @(
            @{ Setting = 'Inbox rules forwarding to external domains' }
            @{ Setting = 'Inbox rules that hide mail' }
            @{ Setting = 'Mailbox forwarding to external addresses' }
        ) {
            (Get-Finding -Results $script:results -Setting $Setting).Status | Should -Be 'Pass'
        }

        It 'should state that both mailboxes were examined' {
            (Get-Finding -Results $script:results -Setting 'Inbox rules forwarding to external domains').CurrentValue |
                Should -Match 'examined 2 of 2 mailboxes'
        }

        It 'should ask for hidden rules' {
            Should -Invoke Get-InboxRule -Times 2 -Exactly -Scope Context -ParameterFilter { $IncludeHidden }
        }
    }

    Context 'when a rule forwards to an external domain' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @(New-TestMailbox -Upn 'victim@contoso.com') }
            Mock Get-InboxRule {
                @(
                    New-TestRule -Name '.' -ForwardTo '"x" [SMTP:drop@evil.example]'
                    New-TestRule -Name 'Redirect' -Enabled $false -RedirectTo 'bare@other.example'
                )
            }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
            $script:finding = Get-Finding -Results $script:results -Setting 'Inbox rules forwarding to external domains'
            $script:evidence = "$($script:finding.Evidence)" | ConvertFrom-Json
        }

        It 'should fail the external forwarding check' {
            $script:finding.Status | Should -Be 'Fail'
        }

        It 'should record one event per rule with mailbox, rule and target' {
            $script:evidence.total | Should -Be 2
            $script:evidence.events[0].Actor | Should -Be 'victim@contoso.com'
            $script:evidence.events[0].Target | Should -Be '.'
            $script:evidence.events[0].Detail | Should -Match 'drop@evil\.example'
        }

        It 'should include disabled rules and say they are disabled' {
            $script:evidence.events[1].Detail | Should -Match '\(disabled\).*bare@other\.example'
        }
    }

    Context 'when rules hide mail' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @(New-TestMailbox -Upn 'victim@contoso.com') }
            Mock Get-InboxRule {
                @(
                    New-TestRule -Name 'Clean' -DeleteMessage $true -SubjectContainsWords 'Invoice', 'payment overdue'
                    New-TestRule -Name '..' -MoveToFolder 'Archive'
                    New-TestRule -Name 'Feeds' -MoveToFolder 'RSS Subscriptions'
                    New-TestRule -Name 'Newsletters' -DeleteMessage $true -SubjectContainsWords 'unsubscribe'
                    New-TestRule -Name 'Projects' -MoveToFolder 'Project Alpha' -SubjectContainsWords 'invoice'
                )
            }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
            $script:finding = Get-Finding -Results $script:results -Setting 'Inbox rules that hide mail'
            $script:evidence = "$($script:finding.Evidence)" | ConvertFrom-Json
        }

        It 'should warn' {
            $script:finding.Status | Should -Be 'Warning'
        }

        It 'should flag keyword deletes, punctuation names and RSS moves only' {
            $script:evidence.total | Should -Be 3
            $script:evidence.events.Target | Should -Be @('Clean', '..', 'Feeds')
        }

        It 'should not flag ordinary clean-up or filing rules' {
            $script:evidence.events.Target | Should -Not -Contain 'Newsletters'
            $script:evidence.events.Target | Should -Not -Contain 'Projects'
        }
    }

    Context 'when mailboxes forward at mailbox level' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox {
                @(
                    New-TestMailbox -Upn 'ext@contoso.com' -ForwardingSmtpAddress 'smtp:me@gmail.example'
                    New-TestMailbox -Upn 'int@contoso.com' -ForwardingSmtpAddress 'smtp:boss@contoso.com'
                    New-TestMailbox -Upn 'contact@contoso.com' -ForwardingAddress 'External Contact'
                )
            }
            Mock Get-Recipient { [PSCustomObject]@{ ExternalEmailAddress = 'SMTP:partner@fabrikam.example'; PrimarySmtpAddress = '' } }
            Mock Get-InboxRule { @() }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
            $script:finding = Get-Finding -Results $script:results -Setting 'Mailbox forwarding to external addresses'
            $script:evidence = "$($script:finding.Evidence)" | ConvertFrom-Json
        }

        It 'should warn about external forwards only' {
            $script:finding.Status | Should -Be 'Warning'
            $script:evidence.total | Should -Be 2
            $script:evidence.events.Actor | Should -Be @('ext@contoso.com', 'contact@contoso.com')
        }

        It 'should resolve a directory recipient to its external address' {
            $script:evidence.events[1].Target | Should -Be 'partner@fabrikam.example'
        }
    }

    Context 'when the mailbox list cannot be read' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { throw 'Access denied' }
            Mock Get-InboxRule { @() }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should report Unknown for all three checks and never Pass' {
            $script:results.Count | Should -Be 3
            $script:results.Status | Should -Not -Contain 'Pass'
            @($script:results | Where-Object Status -eq 'Unknown').Count | Should -Be 3
        }

        It 'should explain why in Limitations' {
            $script:results[0].Limitations | Should -Match 'Could not list mailboxes: Access denied'
        }
    }

    Context 'when accepted domains cannot be read' {
        BeforeAll {
            Mock Get-AcceptedDomain { throw 'Connection closed' }
            Mock Get-EXOMailbox { @(New-TestMailbox -Upn 'a@contoso.com') }
            Mock Get-InboxRule { @() }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should report Unknown because external targets cannot be identified' {
            $script:results.Status | Should -Not -Contain 'Pass'
            $script:results[0].Limitations | Should -Match 'accepted domains'
        }

        It 'should not read mailboxes it cannot evaluate' {
            Should -Invoke Get-EXOMailbox -Times 0 -Exactly -Scope Context
        }
    }

    Context 'when rules cannot be read for one mailbox' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @((New-TestMailbox -Upn 'ok@contoso.com'), (New-TestMailbox -Upn 'broken@contoso.com')) }
            Mock Get-InboxRule { @() } -ParameterFilter { $Mailbox -eq 'ok@contoso.com' }
            Mock Get-InboxRule { throw 'The operation could not be performed' } -ParameterFilter { $Mailbox -eq 'broken@contoso.com' }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should report Unknown for both rule checks with the coverage gap stated' {
            $finding = Get-Finding -Results $script:results -Setting 'Inbox rules forwarding to external domains'
            $finding.Status | Should -Be 'Unknown'
            $finding.CurrentValue | Should -Match 'examined 1 of 2 mailboxes'
            $finding.Limitations | Should -Match 'broken@contoso\.com'
            (Get-Finding -Results $script:results -Setting 'Inbox rules that hide mail').Status | Should -Be 'Unknown'
        }

        It 'should still pass the forwarding check, which read every mailbox' {
            (Get-Finding -Results $script:results -Setting 'Mailbox forwarding to external addresses').Status | Should -Be 'Pass'
        }
    }

    Context 'when one mailbox fails but another has a malicious rule' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @((New-TestMailbox -Upn 'hit@contoso.com'), (New-TestMailbox -Upn 'broken@contoso.com')) }
            Mock Get-InboxRule { @(New-TestRule -Name 'fwd' -ForwardTo '"x" [SMTP:drop@evil.example]') } -ParameterFilter { $Mailbox -eq 'hit@contoso.com' }
            Mock Get-InboxRule { throw 'failed' } -ParameterFilter { $Mailbox -eq 'broken@contoso.com' }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should report the hit and say coverage was incomplete' {
            $finding = Get-Finding -Results $script:results -Setting 'Inbox rules forwarding to external domains'
            $finding.Status | Should -Be 'Fail'
            $finding.CurrentValue | Should -Match 'more may exist'
        }
    }

    Context 'when Exchange Online throttles a call' {
        BeforeAll {
            Mock Get-AcceptedDomain { @([PSCustomObject]@{ DomainName = 'contoso.com' }) }
            Mock Get-EXOMailbox { @(New-TestMailbox -Upn 'a@contoso.com') }
            $global:IocTestRuleCalls = 0
            Mock Get-InboxRule {
                $global:IocTestRuleCalls++
                if ($global:IocTestRuleCalls -eq 1) { throw 'Too many requests. Server busy.' }
                @()
            }
            $script:results = @(& $script:collectorPath -Scope Mailbox)
        }

        It 'should retry and then pass' {
            $global:IocTestRuleCalls | Should -Be 2
            (Get-Finding -Results $script:results -Setting 'Inbox rules forwarding to external domains').Status | Should -Be 'Pass'
            Should -Invoke Start-Sleep -Times 1 -Exactly -Scope Context
        }
    }
}

Describe 'Get-CompromiseIndicators directory scope' {
    BeforeAll {
        function New-SkuResponse {
            param([string[]]$Plans)
            @{ value = @(@{ capabilityStatus = 'Enabled'; servicePlans = @($Plans | ForEach-Object { @{ servicePlanName = $_ } }) }) }
        }
    }

    Context 'when the audit log has no matching events and every query succeeds' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { New-SkuResponse -Plans 'AAD_PREMIUM' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { @{ value = @() } } -ParameterFilter { $Uri -match 'directoryAudits' }
            $script:results = @(& $script:collectorPath -Scope Directory -LookbackDays 30)
        }

        It 'should emit the three directory checks as Pass' {
            $script:results.CheckId | Should -Be @('IOC-CONSENT-001.1', 'IOC-SPCRED-001.1', 'IOC-ROLEADD-001.1')
            @($script:results | Where-Object Status -eq 'Pass').Count | Should -Be 3
        }

        It 'should state the window that was examined' {
            $script:results[0].CurrentValue | Should -Match 'the last 30 days'
        }

        It 'should query each activity name separately with a date filter' {
            Should -Invoke Invoke-MgGraphRequest -Times 7 -Exactly -Scope Context -ParameterFilter { $Uri -match 'directoryAudits' -and $Uri -match 'activityDateTime' }
        }
    }

    Context 'when the tenant has no premium licence and 30 days were requested' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { New-SkuResponse -Plans 'EXCHANGE_S_STANDARD' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { @{ value = @() } } -ParameterFilter { $Uri -match 'directoryAudits' }
            $script:results = @(& $script:collectorPath -Scope Directory -LookbackDays 30)
        }

        It 'should report the 7 day window that was really visible' {
            $script:results[0].CurrentValue | Should -Match 'the last 7 days'
            $script:results[0].Limitations | Should -Match 'Requested 30 days.*only the last 7 days were visible'
        }
    }

    Context 'when retention cannot be determined' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { throw 'Forbidden' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { @{ value = @() } } -ParameterFilter { $Uri -match 'directoryAudits' }
            $script:results = @(& $script:collectorPath -Scope Directory -LookbackDays 14 3>$null)
        }

        It 'should say so in Limitations' {
            $script:results[0].Limitations | Should -Match 'retention could not be determined'
        }
    }

    Context 'when the audit log contains indicator events' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { New-SkuResponse -Plans 'AAD_PREMIUM_P2' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { @{ value = @() } } -ParameterFilter { $Uri -match 'directoryAudits' }
            Mock Invoke-MgGraphRequest {
                @{ value = @(
                        (New-TestAuditEvent -Activity 'Consent to application' -Actor 'user@contoso.com' -Target 'Mail Helper' -Modified @(
                            @{ displayName = 'ConsentAction.Permissions'; newValue = '"[] => [[Scope: Mail.ReadWrite offline_access User.Read]]"' }
                        )),
                        (New-TestAuditEvent -Activity 'Consent to application' -Target 'Calendar Viewer' -Modified @(
                            @{ displayName = 'ConsentAction.Permissions'; newValue = '"[] => [[Scope: Calendars.Read User.Read]]"' }
                        ))
                    )
                }
            } -ParameterFilter { $Uri -match [regex]::Escape([uri]::EscapeDataString("activityDisplayName eq 'Consent to application'")) }
            Mock Invoke-MgGraphRequest {
                @{ value = @(New-TestAuditEvent -Activity 'Add service principal credentials' -Target 'Legacy Sync App') }
            } -ParameterFilter { $Uri -match [regex]::Escape([uri]::EscapeDataString("activityDisplayName eq 'Add service principal credentials'")) }
            Mock Invoke-MgGraphRequest {
                @{ value = @(
                        (New-TestAuditEvent -Activity 'Add member to role' -Target 'new.admin@contoso.com' -Modified @(
                            @{ displayName = 'Role.DisplayName'; newValue = '"Global Administrator"' }
                        )),
                        (New-TestAuditEvent -Activity 'Add member to role' -Target 'reader@contoso.com' -Modified @(
                            @{ displayName = 'Role.DisplayName'; newValue = '"Message Center Reader"' }
                        )),
                        (New-TestAuditEvent -Activity 'Add member to role' -Target 'mystery@contoso.com')
                    )
                }
            } -ParameterFilter { $Uri -match [regex]::Escape([uri]::EscapeDataString("activityDisplayName eq 'Add member to role'")) }
            $script:results = @(& $script:collectorPath -Scope Directory)
        }

        It 'should warn on a high-impact consent and ignore a low-impact one' {
            $finding = Get-Finding -Results $script:results -Setting 'Consent grants for high-impact permissions'
            $evidence = "$($finding.Evidence)" | ConvertFrom-Json
            $finding.Status | Should -Be 'Warning'
            $evidence.total | Should -Be 1
            $evidence.events[0].Target | Should -Be 'Mail Helper'
            $evidence.events[0].Actor | Should -Be 'user@contoso.com'
            $evidence.events[0].Detail | Should -Match 'Mail\.ReadWrite'
            $evidence.events[0].IpAddress | Should -Be '203.0.113.7'
            # Compare the raw JSON: ConvertFrom-Json would turn the timestamp into a DateTime.
            "$($finding.Evidence)" | Should -Match '"Time":"2026-11-10T09:15:00Z"'
        }

        It 'should warn on a credential addition' {
            $finding = Get-Finding -Results $script:results -Setting 'Credentials added to applications and service principals'
            $finding.Status | Should -Be 'Warning'
            ("$($finding.Evidence)" | ConvertFrom-Json).events[0].Target | Should -Be 'Legacy Sync App'
        }

        It 'should flag privileged and unidentified role additions but not low-privilege ones' {
            $finding = Get-Finding -Results $script:results -Setting 'Members added to privileged roles'
            $evidence = "$($finding.Evidence)" | ConvertFrom-Json
            $finding.Status | Should -Be 'Warning'
            $evidence.total | Should -Be 2
            $evidence.events.Target | Should -Be @('new.admin@contoso.com', 'mystery@contoso.com')
            $evidence.events[0].Detail | Should -Match 'Global Administrator'
            $evidence.events[1].Detail | Should -Match 'could not be identified'
        }
    }

    Context 'when audit queries are refused' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { New-SkuResponse -Plans 'AAD_PREMIUM' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { throw 'Response status code does not indicate success: 403 (Forbidden).' } -ParameterFilter { $Uri -match 'directoryAudits' }
            $script:results = @(& $script:collectorPath -Scope Directory 3>$null)
        }

        It 'should report Unknown for every directory check and never Pass' {
            $script:results.Count | Should -Be 3
            @($script:results | Where-Object Status -eq 'Unknown').Count | Should -Be 3
        }

        It 'should name the failed query in Limitations' {
            $script:results[0].Limitations | Should -Match "Audit query for 'Consent to application' failed"
        }
    }

    Context 'when only one of several audit queries fails' {
        BeforeAll {
            Mock Invoke-MgGraphRequest { New-SkuResponse -Plans 'AAD_PREMIUM' } -ParameterFilter { $Uri -match 'subscribedSkus' }
            Mock Invoke-MgGraphRequest { @{ value = @() } } -ParameterFilter { $Uri -match 'directoryAudits' }
            Mock Invoke-MgGraphRequest { throw '403 (Forbidden)' } -ParameterFilter { $Uri -match [regex]::Escape([uri]::EscapeDataString("activityDisplayName eq 'Add eligible member to role'")) }
            $script:results = @(& $script:collectorPath -Scope Directory 3>$null)
        }

        It 'should report Unknown for the affected check only' {
            (Get-Finding -Results $script:results -Setting 'Members added to privileged roles').Status | Should -Be 'Unknown'
            (Get-Finding -Results $script:results -Setting 'Consent grants for high-impact permissions').Status | Should -Be 'Pass'
        }
    }
}
