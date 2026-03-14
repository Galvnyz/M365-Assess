<#
.SYNOPSIS
    Collects Exchange Online security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Exchange Online for security-relevant configuration settings including
    modern authentication, audit status, external sender identification, mail
    forwarding controls, OWA policies, and MailTips. Returns a structured inventory
    of settings with current values and CIS benchmark recommendations.

    Requires an active Exchange Online connection (Connect-ExchangeOnline).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Exchange-Online\Get-ExoSecurityConfig.ps1

    Displays Exchange Online security configuration settings.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$settings = [System.Collections.Generic.List[PSCustomObject]]::new()
$checkIdCounter = @{}

function Add-Setting {
    param(
        [string]$Category,
        [string]$Setting,
        [string]$CurrentValue,
        [string]$RecommendedValue,
        [string]$Status,
        [string]$CheckId = '',
        [string]$Remediation = ''
    )
    # Auto-generate sub-numbered CheckId for individual setting traceability
    $subCheckId = $CheckId
    if ($CheckId) {
        if (-not $checkIdCounter.ContainsKey($CheckId)) { $checkIdCounter[$CheckId] = 0 }
        $checkIdCounter[$CheckId]++
        $subCheckId = "$CheckId.$($checkIdCounter[$CheckId])"
    }
    $settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $subCheckId
        Remediation      = $Remediation
    })
    if ($CheckId -and (Get-Command -Name Update-CheckProgress -ErrorAction SilentlyContinue)) {
        Update-CheckProgress -CheckId $CheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# 1. Organization Config (modern auth, audit, customer lockbox)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking organization config..."
    $orgConfig = Get-OrganizationConfig -ErrorAction Stop

    # Modern Authentication
    $modernAuth = $orgConfig.OAuth2ClientProfileEnabled
    Add-Setting -Category 'Authentication' -Setting 'Modern Authentication Enabled' `
        -CurrentValue "$modernAuth" -RecommendedValue 'True' `
        -Status $(if ($modernAuth) { 'Pass' } else { 'Fail' }) `
        -CheckId 'EXO-AUTH-001' `
        -Remediation 'Exchange admin center > Settings > Modern authentication > Enable. Run: Set-OrganizationConfig -OAuth2ClientProfileEnabled $true'

    # Audit Enabled
    $auditEnabled = $orgConfig.AuditDisabled
    Add-Setting -Category 'Auditing' -Setting 'Org-Level Audit Enabled' `
        -CurrentValue "$(if ($auditEnabled) { 'Disabled' } else { 'Enabled' })" `
        -RecommendedValue 'Enabled' `
        -Status $(if (-not $auditEnabled) { 'Pass' } else { 'Fail' }) `
        -CheckId 'EXO-AUDIT-001' `
        -Remediation 'Run: Set-OrganizationConfig -AuditDisabled $false. Ensure unified audit log is enabled in Microsoft Purview.'

    # Customer Lockbox
    $lockbox = $orgConfig.CustomerLockBoxEnabled
    Add-Setting -Category 'Security' -Setting 'Customer Lockbox Enabled' `
        -CurrentValue "$lockbox" -RecommendedValue 'True (E5 license)' `
        -Status $(if ($lockbox) { 'Pass' } else { 'Review' }) `
        -CheckId 'EXO-LOCKBOX-001' `
        -Remediation 'M365 admin center > Settings > Org settings > Security & privacy > Customer Lockbox > Require approval. Requires E5 or equivalent.'

    # Mail Tips
    $mailTipsEnabled = $orgConfig.MailTipsAllTipsEnabled
    Add-Setting -Category 'Mail Tips' -Setting 'All MailTips Enabled' `
        -CurrentValue "$mailTipsEnabled" -RecommendedValue 'True' `
        -Status $(if ($mailTipsEnabled) { 'Pass' } else { 'Warning' }) `
        -CheckId 'EXO-MAILTIPS-001' `
        -Remediation 'Run: Set-OrganizationConfig -MailTipsAllTipsEnabled $true'

    $externalTips = $orgConfig.MailTipsExternalRecipientsTipsEnabled
    Add-Setting -Category 'Mail Tips' -Setting 'External Recipients Tips Enabled' `
        -CurrentValue "$externalTips" -RecommendedValue 'True' `
        -Status $(if ($externalTips) { 'Pass' } else { 'Warning' }) `
        -CheckId 'EXO-MAILTIPS-001' `
        -Remediation 'Run: Set-OrganizationConfig -MailTipsExternalRecipientsTipsEnabled $true'

    $groupMetrics = $orgConfig.MailTipsGroupMetricsEnabled
    Add-Setting -Category 'Mail Tips' -Setting 'Group Metrics Enabled' `
        -CurrentValue "$groupMetrics" -RecommendedValue 'True' `
        -Status $(if ($groupMetrics) { 'Pass' } else { 'Review' }) `
        -CheckId 'EXO-MAILTIPS-001' `
        -Remediation 'Run: Set-OrganizationConfig -MailTipsGroupMetricsEnabled $true'

    $largeAudience = $orgConfig.MailTipsLargeAudienceThreshold
    Add-Setting -Category 'Mail Tips' -Setting 'Large Audience Threshold' `
        -CurrentValue "$largeAudience" -RecommendedValue '25 or less' `
        -Status $(if ($largeAudience -le 25) { 'Pass' } else { 'Review' }) `
        -CheckId 'EXO-MAILTIPS-001' `
        -Remediation 'Run: Set-OrganizationConfig -MailTipsLargeAudienceThreshold 25'
}
catch {
    Write-Warning "Could not retrieve organization config: $_"
}

# ------------------------------------------------------------------
# 2. External Sender Identification
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking external sender tagging..."
    $externalInOutlook = Get-ExternalInOutlook -ErrorAction Stop
    $externalTagEnabled = $externalInOutlook.Enabled

    Add-Setting -Category 'Email Security' -Setting 'External Sender Tagging' `
        -CurrentValue "$externalTagEnabled" -RecommendedValue 'True' `
        -Status $(if ($externalTagEnabled) { 'Pass' } else { 'Warning' }) `
        -CheckId 'EXO-EXTTAG-001' `
        -Remediation 'Run: Set-ExternalInOutlook -Enabled $true. Tags external emails with a visual indicator in Outlook.'
}
catch {
    Write-Warning "Could not check external sender tagging: $_"
}

# ------------------------------------------------------------------
# 3. Auto-Forwarding to External (Remote Domains)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking remote domain auto-forwarding..."
    $defaultDomain = Get-RemoteDomain -Identity Default -ErrorAction Stop
    $autoForward = $defaultDomain.AutoForwardEnabled

    Add-Setting -Category 'Email Security' -Setting 'Auto-Forward to External (Default Domain)' `
        -CurrentValue "$autoForward" -RecommendedValue 'False' `
        -Status $(if (-not $autoForward) { 'Pass' } else { 'Fail' }) `
        -CheckId 'EXO-FORWARD-001' `
        -Remediation 'Run: Set-RemoteDomain -Identity Default -AutoForwardEnabled $false. Also consider transport rules to block client-side forwarding.'
}
catch {
    Write-Warning "Could not check remote domain forwarding: $_"
}

# ------------------------------------------------------------------
# 4. OWA Policies (additional storage providers)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking OWA mailbox policies..."
    $owaPolicies = Get-OwaMailboxPolicy -ErrorAction Stop
    foreach ($policy in $owaPolicies) {
        $additionalStorage = $policy.AdditionalStorageProvidersAvailable
        Add-Setting -Category 'OWA Policy' -Setting "OWA Additional Storage ($($policy.Name))" `
            -CurrentValue "$additionalStorage" -RecommendedValue 'False' `
            -Status $(if (-not $additionalStorage) { 'Pass' } else { 'Warning' }) `
            -CheckId 'EXO-OWA-001' `
            -Remediation 'Run: Set-OwaMailboxPolicy -Identity OwaMailboxPolicy-Default -AdditionalStorageProvidersAvailable $false'
    }
}
catch {
    Write-Warning "Could not check OWA policies: $_"
}

# ------------------------------------------------------------------
# 5. Sharing Policies (Calendar External Sharing)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking sharing policies..."
    $sharingPolicies = Get-SharingPolicy -ErrorAction Stop
    foreach ($policy in $sharingPolicies) {
        $isDefault = $policy.Default
        if (-not $isDefault) { continue }

        $domains = $policy.Domains -join '; '
        $hasExternalSharing = $domains -match '\*'

        Add-Setting -Category 'Sharing' -Setting 'Default Calendar External Sharing' `
            -CurrentValue $(if ($hasExternalSharing) { "Enabled ($domains)" } else { 'Restricted' }) `
            -RecommendedValue 'Restricted' `
            -Status $(if (-not $hasExternalSharing) { 'Pass' } else { 'Review' }) `
            -CheckId 'EXO-SHARING-001' `
            -Remediation 'Exchange admin center > Organization > Sharing > Default sharing policy. Remove wildcard (*) domains or restrict to CalendarSharingFreeBusySimple.'
    }
}
catch {
    Write-Warning "Could not check sharing policies: $_"
}

# ------------------------------------------------------------------
# 6. Mailbox Audit Bypass Check
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking mailbox audit bypass..."
    $bypassedMailboxes = Get-MailboxAuditBypassAssociation -ResultSize Unlimited -ErrorAction Stop |
        Where-Object { $_.AuditBypassEnabled -eq $true }
    $bypassCount = @($bypassedMailboxes).Count

    Add-Setting -Category 'Auditing' -Setting 'Mailboxes with Audit Bypass' `
        -CurrentValue "$bypassCount" -RecommendedValue '0' `
        -Status $(if ($bypassCount -eq 0) { 'Pass' } else { 'Fail' }) `
        -CheckId 'EXO-AUDIT-002' `
        -Remediation 'Run: Set-MailboxAuditBypassAssociation -Identity <user> -AuditBypassEnabled $false for each bypassed mailbox.'
}
catch {
    Write-Warning "Could not check audit bypass: $_"
}

# ------------------------------------------------------------------
# 7. SMTP AUTH Disabled (CIS 6.5.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking SMTP AUTH configuration..."
    $transportConfig = Get-TransportConfig -ErrorAction Stop
    $smtpAuthDisabled = $transportConfig.SmtpClientAuthenticationDisabled

    Add-Setting -Category 'Authentication' -Setting 'SMTP AUTH Disabled (Org-Wide)' `
        -CurrentValue "$smtpAuthDisabled" -RecommendedValue 'True' `
        -Status $(if ($smtpAuthDisabled) { 'Pass' } else { 'Fail' }) `
        -CheckId 'EXO-AUTH-002' `
        -Remediation 'Run: Set-TransportConfig -SmtpClientAuthenticationDisabled $true. Disable SMTP AUTH org-wide and enable per-mailbox only where required.'
}
catch {
    Write-Warning "Could not check SMTP AUTH configuration: $_"
}

# ------------------------------------------------------------------
# 8. Role Assignment Policies (Outlook Add-ins)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking role assignment policies..."
    $roleAssignments = Get-RoleAssignmentPolicy -ErrorAction Stop
    foreach ($policy in $roleAssignments) {
        if (-not $policy.IsDefault) { continue }

        $assignedRoles = $policy.AssignedRoles -join '; '
        $hasMyApps = $assignedRoles -match 'MyBaseOptions|My Marketplace Apps|My Custom Apps|My ReadWriteMailbox Apps'

        Add-Setting -Category 'Applications' -Setting "Outlook Add-ins Allowed ($($policy.Name))" `
            -CurrentValue $(if ($hasMyApps) { 'User add-ins allowed' } else { 'Restricted' }) `
            -RecommendedValue 'Restricted' `
            -Status $(if (-not $hasMyApps) { 'Pass' } else { 'Review' }) `
            -CheckId 'EXO-ADDINS-001' `
            -Remediation 'Exchange admin center > Roles > User roles > Default Role Assignment Policy. Remove MyMarketplaceApps, MyCustomApps, MyReadWriteMailboxApps roles.'
    }
}
catch {
    Write-Warning "Could not check role assignment policies: $_"
}

# ------------------------------------------------------------------
# 9. Connection Filter Policy (CIS 2.1.12, 2.1.13)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking connection filter policies..."
    $connFilter = Get-HostedConnectionFilterPolicy -ErrorAction Stop

    foreach ($policy in @($connFilter)) {
        $policyLabel = if ($policy.Name -eq 'Default') { 'Default' } else { $policy.Name }

        # CIS 2.1.12 — IP Allow List should be empty
        $ipAllowList = @($policy.IPAllowList)
        $ipAllowCount = $ipAllowList.Count
        Add-Setting -Category 'Connection Filter' `
            -Setting "IP Allow List ($policyLabel)" `
            -CurrentValue $(if ($ipAllowCount -eq 0) { 'Empty' } else { "$ipAllowCount IPs: $($ipAllowList -join ', ')" }) `
            -RecommendedValue 'Empty (0 IPs)' `
            -Status $(if ($ipAllowCount -eq 0) { 'Pass' } else { 'Fail' }) `
            -CheckId 'EXO-CONNFILTER-001' `
            -Remediation 'Run: Set-HostedConnectionFilterPolicy -Identity <Policy> -IPAllowList @{}. Exchange admin center > Protection > Connection filter > Edit the policy and remove all IP allow list entries.'

        # CIS 2.1.13 — Safe List should be off
        $safeList = $policy.EnableSafeList
        Add-Setting -Category 'Connection Filter' `
            -Setting "Enable Safe List ($policyLabel)" `
            -CurrentValue "$safeList" -RecommendedValue 'False' `
            -Status $(if (-not $safeList) { 'Pass' } else { 'Fail' }) `
            -CheckId 'EXO-CONNFILTER-002' `
            -Remediation 'Run: Set-HostedConnectionFilterPolicy -Identity <Policy> -EnableSafeList $false. Exchange admin center > Protection > Connection filter > Edit the policy and uncheck "Turn on safe list".'
    }
}
catch {
    Write-Warning "Could not check connection filter policies: $_"
}

# ------------------------------------------------------------------
# 10. Transport Rules — Domain Whitelisting (CIS 6.2.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking transport rules for domain whitelisting..."
    $transportRules = Get-TransportRule -ErrorAction Stop

    $whitelistRules = @($transportRules | Where-Object {
        $_.SetSCL -eq -1 -and $_.SenderDomainIs
    })

    if ($whitelistRules.Count -eq 0) {
        Add-Setting -Category 'Transport Rules' `
            -Setting 'Domain whitelist transport rules' `
            -CurrentValue 'None found' -RecommendedValue 'No rules whitelisting domains' `
            -Status 'Pass' `
            -CheckId 'EXO-TRANSPORT-001' `
            -Remediation 'No action needed.'
    }
    else {
        $ruleNames = ($whitelistRules | ForEach-Object { $_.Name }) -join '; '
        Add-Setting -Category 'Transport Rules' `
            -Setting 'Domain whitelist transport rules' `
            -CurrentValue "$($whitelistRules.Count) rules: $ruleNames" `
            -RecommendedValue 'No rules whitelisting domains' `
            -Status 'Fail' `
            -CheckId 'EXO-TRANSPORT-001' `
            -Remediation 'Exchange admin center > Mail flow > Rules. Remove or disable any transport rules that set SCL to -1 for specific sender domains, as this bypasses spam filtering.'
    }
}
catch {
    Write-Warning "Could not check transport rules: $_"
}

# ------------------------------------------------------------------
# 11. Mailbox Auditing Enabled — Sample (CIS 6.1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking mailbox auditing (sampling 50 mailboxes)..."
    $mailboxes = Get-Mailbox -ResultSize 50 -RecipientTypeDetails UserMailbox -ErrorAction Stop

    if (@($mailboxes).Count -eq 0) {
        Add-Setting -Category 'Audit' `
            -Setting 'Mailbox Auditing (sample)' `
            -CurrentValue 'No user mailboxes found' -RecommendedValue 'AuditEnabled = True' `
            -Status 'Review' `
            -CheckId 'EXO-AUDIT-003' `
            -Remediation 'No user mailboxes found to sample.'
    }
    else {
        $sampleSize = @($mailboxes).Count
        $disabledAudit = @($mailboxes | Where-Object { -not $_.AuditEnabled })

        if ($disabledAudit.Count -eq 0) {
            Add-Setting -Category 'Audit' `
                -Setting "Mailbox Auditing (sample of $sampleSize)" `
                -CurrentValue "All $sampleSize sampled mailboxes have auditing enabled" `
                -RecommendedValue 'AuditEnabled = True' `
                -Status 'Pass' `
                -CheckId 'EXO-AUDIT-003' `
                -Remediation 'No action needed.'
        }
        else {
            $disabledNames = ($disabledAudit | Select-Object -First 5 | ForEach-Object { $_.UserPrincipalName }) -join '; '
            $suffix = if ($disabledAudit.Count -gt 5) { " (and $($disabledAudit.Count - 5) more)" } else { '' }
            Add-Setting -Category 'Audit' `
                -Setting "Mailbox Auditing (sample of $sampleSize)" `
                -CurrentValue "$($disabledAudit.Count)/$sampleSize disabled: $disabledNames$suffix" `
                -RecommendedValue 'AuditEnabled = True' `
                -Status 'Fail' `
                -CheckId 'EXO-AUDIT-003' `
                -Remediation 'Run: Set-Mailbox -Identity <UPN> -AuditEnabled $true. Or org-wide: Set-OrganizationConfig -AuditDisabled $false. Exchange admin center > Compliance management > Auditing.'
        }
    }
}
catch {
    Write-Warning "Could not check mailbox auditing: $_"
}

# ------------------------------------------------------------------
# 12. Shared Mailbox Sign-In Blocked (CIS 1.2.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking shared mailbox sign-in status..."
    $sharedMailboxes = Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize 100 -ErrorAction Stop

    if ($sharedMailboxes.Count -eq 0) {
        Add-Setting -Category 'Mailbox Security' `
            -Setting 'Shared Mailbox Sign-In Blocked' `
            -CurrentValue 'No shared mailboxes found' `
            -RecommendedValue 'All shared mailbox accounts disabled' `
            -Status 'Pass' `
            -CheckId 'EXO-SHAREDMBX-001' `
            -Remediation 'No action needed.'
    }
    else {
        $enabledAccounts = @()
        foreach ($mbx in $sharedMailboxes) {
            try {
                $mgUser = Invoke-MgGraphRequest -Method GET `
                    -Uri "/v1.0/users/$($mbx.UserPrincipalName)?`$select=accountEnabled" `
                    -ErrorAction SilentlyContinue
                if ($mgUser -and $mgUser['accountEnabled'] -eq $true) {
                    $enabledAccounts += $mbx.UserPrincipalName
                }
            }
            catch {
                Write-Verbose "Could not resolve user $($mbx.UserPrincipalName): $_"
            }
        }

        if ($enabledAccounts.Count -eq 0) {
            Add-Setting -Category 'Mailbox Security' `
                -Setting 'Shared Mailbox Sign-In Blocked' `
                -CurrentValue "All $($sharedMailboxes.Count) shared mailbox accounts disabled" `
                -RecommendedValue 'All shared mailbox accounts disabled' `
                -Status 'Pass' `
                -CheckId 'EXO-SHAREDMBX-001' `
                -Remediation 'No action needed.'
        }
        else {
            $upnList = ($enabledAccounts | Select-Object -First 5) -join ', '
            $suffix = if ($enabledAccounts.Count -gt 5) { " (+$($enabledAccounts.Count - 5) more)" } else { '' }
            Add-Setting -Category 'Mailbox Security' `
                -Setting 'Shared Mailbox Sign-In Blocked' `
                -CurrentValue "$($enabledAccounts.Count)/$($sharedMailboxes.Count) enabled: $upnList$suffix" `
                -RecommendedValue 'All shared mailbox accounts disabled' `
                -Status 'Fail' `
                -CheckId 'EXO-SHAREDMBX-001' `
                -Remediation 'Block sign-in for shared mailbox accounts: Set-AzureADUser -ObjectId <UPN> -AccountEnabled $false. Entra admin center > Users > select shared mailbox user > Properties > Account enabled > No.'
        }
    }
}
catch {
    Write-Warning "Could not check shared mailbox sign-in: $_"
}

# ------------------------------------------------------------------
# 13. Direct Send / Unauthenticated Relay (CIS 6.5.5)
# ------------------------------------------------------------------
try {
    $connectorAvailable = Get-Command -Name Get-InboundConnector -ErrorAction SilentlyContinue
    if ($connectorAvailable) {
        Write-Verbose "Checking inbound connectors for unauthenticated relay..."
        $inboundConnectors = Get-InboundConnector -ErrorAction Stop
        $relayConnectors = @($inboundConnectors | Where-Object {
            $_.Enabled -eq $true -and
            $_.RequireTls -eq $false -and
            $_.RestrictDomainsToIPAddresses -eq $false
        })

        if ($relayConnectors.Count -eq 0) {
            Add-Setting -Category 'Mail Flow' `
                -Setting 'Inbound Connectors - Unauthenticated Relay' `
                -CurrentValue 'No unauthenticated relay connectors found' `
                -RecommendedValue 'No open relay connectors' `
                -Status 'Pass' `
                -CheckId 'EXO-DIRECTSEND-001' `
                -Remediation 'No action needed.'
        }
        else {
            $connectorNames = ($relayConnectors | ForEach-Object { $_.Name }) -join ', '
            Add-Setting -Category 'Mail Flow' `
                -Setting 'Inbound Connectors - Unauthenticated Relay' `
                -CurrentValue "$($relayConnectors.Count) connectors without TLS/domain restriction: $connectorNames" `
                -RecommendedValue 'No open relay connectors' `
                -Status 'Fail' `
                -CheckId 'EXO-DIRECTSEND-001' `
                -Remediation "Review inbound connectors: $connectorNames. Require TLS and restrict to specific sender domains/IPs. Exchange admin center > Mail flow > Connectors."
        }
    }
    else {
        Add-Setting -Category 'Mail Flow' `
            -Setting 'Inbound Connectors - Unauthenticated Relay' `
            -CurrentValue 'Get-InboundConnector not available' `
            -RecommendedValue 'No open relay connectors' `
            -Status 'Review' `
            -CheckId 'EXO-DIRECTSEND-001' `
            -Remediation 'Connect to Exchange Online PowerShell to check inbound connector configuration.'
    }
}
catch {
    Write-Warning "Could not check inbound connectors: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Exchange Online security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported EXO security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
