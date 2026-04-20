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

# Stop on errors: API failures should halt this collector rather than produce partial results.
$ErrorActionPreference = 'Stop'

# Load shared security-config helpers
$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue,
        [ValidateSet('Pass', 'Fail', 'Warning', 'Review', 'Info', 'Skipped', 'Unknown')]
        [string]$Status,
        [string]$CheckId = '', [string]$Remediation = '',
        [PSCustomObject]$Evidence = $null
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
        Evidence         = $Evidence
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# 1. Organization Config (modern auth, audit, customer lockbox)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking organization config..."
    $orgConfig = Get-OrganizationConfig -ErrorAction Stop

    # Modern Authentication
    $modernAuth = $orgConfig.OAuth2ClientProfileEnabled
    $settingParams = @{
        Category         = 'Authentication'
        Setting          = 'Modern Authentication Enabled'
        CurrentValue     = "$modernAuth"
        RecommendedValue = 'True'
        Status           = if ($modernAuth) { 'Pass' } else { 'Fail' }
        CheckId          = 'EXO-AUTH-001'
        Remediation      = 'Exchange admin center > Settings > Modern authentication > Enable. Run: Set-OrganizationConfig -OAuth2ClientProfileEnabled $true'
        Evidence         = [PSCustomObject]@{
            OAuth2ClientProfileEnabled = [bool]$modernAuth
        }
    }
    Add-Setting @settingParams

    # Audit Enabled
    $auditEnabled = $orgConfig.AuditDisabled
    $settingParams = @{
        Category         = 'Auditing'
        Setting          = 'Exchange Org Audit Config'
        CurrentValue     = "$(if ($auditEnabled) { 'Disabled' } else { 'Enabled' })"
        RecommendedValue = 'Enabled'
        Status           = if (-not $auditEnabled) { 'Pass' } else { 'Fail' }
        CheckId          = 'EXO-AUDIT-001'
        Remediation      = 'Run: Set-OrganizationConfig -AuditDisabled $false. Note: this is the Exchange org-level audit flag and is a pre-condition for UAL, but does not guarantee UAL ingestion is active. Verify UAL separately (COMPLIANCE-AUDIT-001).'
    }
    Add-Setting @settingParams

    # Customer Lockbox -- Fail when E5 licensed (lockbox is available), Review when not
    $lockbox = $orgConfig.CustomerLockBoxEnabled
    $lockboxStatus = 'Review'
    if ($lockbox) {
        $lockboxStatus = 'Pass'
    }
    else {
        # Check if tenant has E5 or E5 Compliance license (lockbox is included)
        $hasLockboxLicense = $false
        try {
            $lockboxSkus = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/subscribedSkus' -ErrorAction Stop
            $lockboxSkuList = if ($lockboxSkus -and $lockboxSkus['value']) { @($lockboxSkus['value']) } else { @() }
            $e5SkuIds = @(
                '06ebc4ee-1bb5-47dd-8120-11324bc54e06'  # SPE_E5 (M365 E5)
                'cd2925a3-5076-4233-8931-638a8c94f773'  # SPE_E5_NOPSTNCONF
                'd17b27af-3f49-4822-99f9-56a661538792'  # M365_E5_COMPLIANCE
            )
            foreach ($sku in $lockboxSkuList) {
                if ($sku['skuId'] -in $e5SkuIds -and $sku['capabilityStatus'] -eq 'Enabled') {
                    $hasLockboxLicense = $true
                    break
                }
            }
        }
        catch {
            Write-Verbose "Could not check license SKUs for lockbox: $_"
        }
        $lockboxStatus = if ($hasLockboxLicense) { 'Fail' } else { 'Review' }
    }
    $settingParams = @{
        Category         = 'Security'
        Setting          = 'Customer Lockbox Enabled'
        CurrentValue     = "$lockbox"
        RecommendedValue = 'True (E5 license)'
        Status           = $lockboxStatus
        CheckId          = 'EXO-LOCKBOX-001'
        Remediation      = 'M365 admin center > Settings > Org settings > Security & privacy > Customer Lockbox > Require approval. Requires E5 or equivalent.'
    }
    Add-Setting @settingParams

    # Mail Tips
    $mailTipsEnabled = $orgConfig.MailTipsAllTipsEnabled
    $settingParams = @{
        Category         = 'Mail Tips'
        Setting          = 'All MailTips Enabled'
        CurrentValue     = "$mailTipsEnabled"
        RecommendedValue = 'True'
        Status           = if ($mailTipsEnabled) { 'Pass' } else { 'Warning' }
        CheckId          = 'EXO-MAILTIPS-001'
        Remediation      = 'Run: Set-OrganizationConfig -MailTipsAllTipsEnabled $true'
    }
    Add-Setting @settingParams

    $externalTips = $orgConfig.MailTipsExternalRecipientsTipsEnabled
    $settingParams = @{
        Category         = 'Mail Tips'
        Setting          = 'External Recipients Tips Enabled'
        CurrentValue     = "$externalTips"
        RecommendedValue = 'True'
        Status           = if ($externalTips) { 'Pass' } else { 'Warning' }
        CheckId          = 'EXO-MAILTIPS-001'
        Remediation      = 'Run: Set-OrganizationConfig -MailTipsExternalRecipientsTipsEnabled $true'
    }
    Add-Setting @settingParams

    $groupMetrics = $orgConfig.MailTipsGroupMetricsEnabled
    $settingParams = @{
        Category         = 'Mail Tips'
        Setting          = 'Group Metrics Enabled'
        CurrentValue     = "$groupMetrics"
        RecommendedValue = 'True'
        Status           = if ($groupMetrics) { 'Pass' } else { 'Review' }
        CheckId          = 'EXO-MAILTIPS-001'
        Remediation      = 'Run: Set-OrganizationConfig -MailTipsGroupMetricsEnabled $true'
    }
    Add-Setting @settingParams

    $largeAudience = $orgConfig.MailTipsLargeAudienceThreshold
    $settingParams = @{
        Category         = 'Mail Tips'
        Setting          = 'Large Audience Threshold'
        CurrentValue     = "$largeAudience"
        RecommendedValue = '25 or less'
        Status           = if ($largeAudience -le 25) { 'Pass' } else { 'Review' }
        CheckId          = 'EXO-MAILTIPS-001'
        Remediation      = 'Run: Set-OrganizationConfig -MailTipsLargeAudienceThreshold 25'
    }
    Add-Setting @settingParams
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

    $settingParams = @{
        Category         = 'Email Security'
        Setting          = 'External Sender Tagging'
        CurrentValue     = "$externalTagEnabled"
        RecommendedValue = 'True'
        Status           = if ($externalTagEnabled) { 'Pass' } else { 'Warning' }
        CheckId          = 'EXO-EXTTAG-001'
        Remediation      = 'Run: Set-ExternalInOutlook -Enabled $true. Tags external emails with a visual indicator in Outlook.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.ToString() -match 'server side error|try again after some time') {
        # Transient EXO REST API error — emit Review so the check appears in the report
        $settingParams = @{
            Category         = 'Email Security'
            Setting          = 'External Sender Tagging'
            CurrentValue     = 'Could not verify — transient API error'
            RecommendedValue = 'True'
            Status           = 'Review'
            CheckId          = 'EXO-EXTTAG-001'
            Remediation      = 'Verify manually: Get-ExternalInOutlook. Enable with: Set-ExternalInOutlook -Enabled $true.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check external sender tagging: $_"
    }
}

# ------------------------------------------------------------------
# 3. Auto-Forwarding to External (Remote Domains)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking remote domain auto-forwarding..."
    $defaultDomain = Get-RemoteDomain -Identity Default -ErrorAction Stop
    $autoForward = $defaultDomain.AutoForwardEnabled

    $settingParams = @{
        Category         = 'Email Security'
        Setting          = 'Auto-Forward to External (Default Domain)'
        CurrentValue     = "$autoForward"
        RecommendedValue = 'False'
        Status           = if (-not $autoForward) { 'Pass' } else { 'Fail' }
        CheckId          = 'EXO-FORWARD-001'
        Remediation      = 'Run: Set-RemoteDomain -Identity Default -AutoForwardEnabled $false. Also consider transport rules to block client-side forwarding.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check remote domain forwarding: $_"
}

# ------------------------------------------------------------------
# 4. OWA Policies (additional storage providers)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking OWA mailbox policies..."
    $owaPolicies = Get-OwaMailboxPolicy -ErrorAction Stop -WarningAction SilentlyContinue
    foreach ($policy in $owaPolicies) {
        $additionalStorage = $policy.AdditionalStorageProvidersAvailable
        $settingParams = @{
            Category         = 'OWA Policy'
            Setting          = "OWA Additional Storage ($($policy.Name))"
            CurrentValue     = "$additionalStorage"
            RecommendedValue = 'False'
            Status           = if (-not $additionalStorage) { 'Pass' } else { 'Warning' }
            CheckId          = 'EXO-OWA-001'
            Remediation      = 'Run: Set-OwaMailboxPolicy -Identity OwaMailboxPolicy-Default -AdditionalStorageProvidersAvailable $false'
        }
        Add-Setting @settingParams
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

        $settingParams = @{
            Category         = 'Sharing'
            Setting          = 'Default Calendar External Sharing'
            CurrentValue     = $(if ($hasExternalSharing) { "Enabled ($domains)" } else { 'Restricted' })
            RecommendedValue = 'Restricted'
            Status           = if (-not $hasExternalSharing) { 'Pass' } else { 'Review' }
            CheckId          = 'EXO-SHARING-001'
            Remediation      = 'Exchange admin center > Organization > Sharing > Default sharing policy. Remove wildcard (*) domains or restrict to CalendarSharingFreeBusySimple.'
        }
        Add-Setting @settingParams
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
    $bypassedMailboxes = Get-MailboxAuditBypassAssociation -ResultSize Unlimited -ErrorAction Stop -WarningAction SilentlyContinue |
        Where-Object { $_.AuditBypassEnabled -eq $true }
    $bypassCount = @($bypassedMailboxes).Count

    $settingParams = @{
        Category         = 'Auditing'
        Setting          = 'Mailboxes with Audit Bypass'
        CurrentValue     = "$bypassCount"
        RecommendedValue = '0'
        Status           = if ($bypassCount -eq 0) { 'Pass' } else { 'Fail' }
        CheckId          = 'EXO-AUDIT-002'
        Remediation      = 'Run: Set-MailboxAuditBypassAssociation -Identity <user> -AuditBypassEnabled $false for each bypassed mailbox.'
    }
    Add-Setting @settingParams
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

    $settingParams = @{
        Category         = 'Authentication'
        Setting          = 'SMTP AUTH Disabled (Org-Wide)'
        CurrentValue     = "$smtpAuthDisabled"
        RecommendedValue = 'True'
        Status           = if ($smtpAuthDisabled) { 'Pass' } else { 'Fail' }
        CheckId          = 'EXO-AUTH-002'
        Remediation      = 'Run: Set-TransportConfig -SmtpClientAuthenticationDisabled $true. Disable SMTP AUTH org-wide and enable per-mailbox only where required.'
    }
    Add-Setting @settingParams
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

        $settingParams = @{
            Category         = 'Applications'
            Setting          = "Outlook Add-ins Allowed ($($policy.Name))"
            CurrentValue     = $(if ($hasMyApps) { 'User add-ins allowed' } else { 'Restricted' })
            RecommendedValue = 'Restricted'
            Status           = if (-not $hasMyApps) { 'Pass' } else { 'Review' }
            CheckId          = 'EXO-ADDINS-001'
            Remediation      = 'Exchange admin center > Roles > User roles > Default Role Assignment Policy. Remove MyMarketplaceApps, MyCustomApps, MyReadWriteMailboxApps roles.'
        }
        Add-Setting @settingParams
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

        # CIS 2.1.12 -- IP Allow List should be empty
        $ipAllowList = @($policy.IPAllowList)
        $ipAllowCount = $ipAllowList.Count
        $settingParams = @{
            Category         = 'Connection Filter'
            Setting          = "IP Allow List ($policyLabel)"
            CurrentValue     = $(if ($ipAllowCount -eq 0) { 'Empty' } else { "$ipAllowCount IPs: $($ipAllowList -join ', ')" })
            RecommendedValue = 'Empty (0 IPs)'
            Status           = if ($ipAllowCount -eq 0) { 'Pass' } else { 'Fail' }
            CheckId          = 'EXO-CONNFILTER-001'
            Remediation      = 'Run: Set-HostedConnectionFilterPolicy -Identity <Policy> -IPAllowList @{}. Exchange admin center > Protection > Connection filter > Edit the policy and remove all IP allow list entries.'
        }
        Add-Setting @settingParams

        # CIS 2.1.13 -- Safe List should be off
        $safeList = $policy.EnableSafeList
        $settingParams = @{
            Category         = 'Connection Filter'
            Setting          = "Enable Safe List ($policyLabel)"
            CurrentValue     = "$safeList"
            RecommendedValue = 'False'
            Status           = if (-not $safeList) { 'Pass' } else { 'Fail' }
            CheckId          = 'EXO-CONNFILTER-002'
            Remediation      = 'Run: Set-HostedConnectionFilterPolicy -Identity <Policy> -EnableSafeList $false. Exchange admin center > Protection > Connection filter > Edit the policy and uncheck "Turn on safe list".'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check connection filter policies: $_"
}

# ------------------------------------------------------------------
# 10. Transport Rules -- Domain Whitelisting (CIS 6.2.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking transport rules for domain whitelisting..."
    $transportRules = Get-TransportRule -ErrorAction Stop

    $whitelistRules = @($transportRules | Where-Object {
        $_.SetSCL -eq -1 -and $_.SenderDomainIs
    })

    if ($whitelistRules.Count -eq 0) {
        $settingParams = @{
            Category         = 'Transport Rules'
            Setting          = 'Domain whitelist transport rules'
            CurrentValue     = 'None found'
            RecommendedValue = 'No rules whitelisting domains'
            Status           = 'Pass'
            CheckId          = 'EXO-TRANSPORT-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $ruleNames = ($whitelistRules | ForEach-Object { $_.Name }) -join '; '
        $settingParams = @{
            Category         = 'Transport Rules'
            Setting          = 'Domain whitelist transport rules'
            CurrentValue     = "$($whitelistRules.Count) rules: $ruleNames"
            RecommendedValue = 'No rules whitelisting domains'
            Status           = 'Fail'
            CheckId          = 'EXO-TRANSPORT-001'
            Remediation      = 'Exchange admin center > Mail flow > Rules. Remove or disable any transport rules that set SCL to -1 for specific sender domains, as this bypasses spam filtering.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check transport rules: $_"
}

# ------------------------------------------------------------------
# 11. Mailbox Auditing Enabled -- Sample (CIS 6.1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking mailbox auditing (sampling 50 mailboxes)..."
    $mailboxes = Get-Mailbox -ResultSize 50 -RecipientTypeDetails UserMailbox -ErrorAction Stop -WarningAction SilentlyContinue

    if (@($mailboxes).Count -eq 0) {
        $settingParams = @{
            Category         = 'Audit'
            Setting          = 'Mailbox Auditing (sample)'
            CurrentValue     = 'No user mailboxes found'
            RecommendedValue = 'AuditEnabled = True'
            Status           = 'Review'
            CheckId          = 'EXO-AUDIT-003'
            Remediation      = 'No user mailboxes found to sample.'
        }
        Add-Setting @settingParams
    }
    else {
        $sampleSize = @($mailboxes).Count
        $disabledAudit = @($mailboxes | Where-Object { -not $_.AuditEnabled })

        if ($disabledAudit.Count -eq 0) {
            $settingParams = @{
                Category         = 'Audit'
                Setting          = "Mailbox Auditing (sample of $sampleSize)"
                CurrentValue     = "All $sampleSize sampled mailboxes have auditing enabled"
                RecommendedValue = 'AuditEnabled = True'
                Status           = 'Pass'
                CheckId          = 'EXO-AUDIT-003'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $disabledNames = ($disabledAudit | Select-Object -First 5 | ForEach-Object { $_.UserPrincipalName }) -join '; '
            $suffix = if ($disabledAudit.Count -gt 5) { " (and $($disabledAudit.Count - 5) more)" } else { '' }
            $settingParams = @{
                Category         = 'Audit'
                Setting          = "Mailbox Auditing (sample of $sampleSize)"
                CurrentValue     = "$($disabledAudit.Count)/$sampleSize disabled: $disabledNames$suffix"
                RecommendedValue = 'AuditEnabled = True'
                Status           = 'Fail'
                CheckId          = 'EXO-AUDIT-003'
                Remediation      = 'Run: Set-Mailbox -Identity <UPN> -AuditEnabled $true. Or org-wide: Set-OrganizationConfig -AuditDisabled $false. Exchange admin center > Compliance management > Auditing.'
            }
            Add-Setting @settingParams
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
    $sharedMailboxes = Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize 100 -ErrorAction Stop -WarningAction SilentlyContinue

    if ($sharedMailboxes.Count -eq 0) {
        $settingParams = @{
            Category         = 'Mailbox Security'
            Setting          = 'Shared Mailbox Sign-In Blocked'
            CurrentValue     = 'No shared mailboxes found'
            RecommendedValue = 'All shared mailbox accounts disabled'
            Status           = 'Pass'
            CheckId          = 'EXO-SHAREDMBX-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $enabledAccounts = @()
        foreach ($mbx in $sharedMailboxes) {
            try {
                $graphParams = @{
                    Method      = 'GET'
                    Uri         = "/v1.0/users/$($mbx.UserPrincipalName)?`$select=accountEnabled"
                    ErrorAction = 'SilentlyContinue'
                }
                $mgUser = Invoke-MgGraphRequest @graphParams
                if ($mgUser -and $mgUser['accountEnabled'] -eq $true) {
                    $enabledAccounts += $mbx.UserPrincipalName
                }
            }
            catch {
                Write-Verbose "Could not resolve user $($mbx.UserPrincipalName): $_"
            }
        }

        if ($enabledAccounts.Count -eq 0) {
            $settingParams = @{
                Category         = 'Mailbox Security'
                Setting          = 'Shared Mailbox Sign-In Blocked'
                CurrentValue     = "All $($sharedMailboxes.Count) shared mailbox accounts disabled"
                RecommendedValue = 'All shared mailbox accounts disabled'
                Status           = 'Pass'
                CheckId          = 'EXO-SHAREDMBX-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $upnList = ($enabledAccounts | Select-Object -First 5) -join ', '
            $suffix = if ($enabledAccounts.Count -gt 5) { " (+$($enabledAccounts.Count - 5) more)" } else { '' }
            $settingParams = @{
                Category         = 'Mailbox Security'
                Setting          = 'Shared Mailbox Sign-In Blocked'
                CurrentValue     = "$($enabledAccounts.Count)/$($sharedMailboxes.Count) enabled: $upnList$suffix"
                RecommendedValue = 'All shared mailbox accounts disabled'
                Status           = 'Fail'
                CheckId          = 'EXO-SHAREDMBX-001'
                Remediation      = 'Block sign-in for shared mailbox accounts: Set-AzureADUser -ObjectId <UPN> -AccountEnabled $false. Entra admin center > Users > select shared mailbox user > Properties > Account enabled > No.'
            }
            Add-Setting @settingParams
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
            $settingParams = @{
                Category         = 'Mail Flow'
                Setting          = 'Inbound Connectors - Unauthenticated Relay'
                CurrentValue     = 'No unauthenticated relay connectors found'
                RecommendedValue = 'No open relay connectors'
                Status           = 'Pass'
                CheckId          = 'EXO-DIRECTSEND-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $connectorNames = ($relayConnectors | ForEach-Object { $_.Name }) -join ', '
            $settingParams = @{
                Category         = 'Mail Flow'
                Setting          = 'Inbound Connectors - Unauthenticated Relay'
                CurrentValue     = "$($relayConnectors.Count) connectors without TLS/domain restriction: $connectorNames"
                RecommendedValue = 'No open relay connectors'
                Status           = 'Fail'
                CheckId          = 'EXO-DIRECTSEND-001'
                Remediation      = "Review inbound connectors: $connectorNames. Require TLS and restrict to specific sender domains/IPs. Exchange admin center > Mail flow > Connectors."
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Mail Flow'
            Setting          = 'Inbound Connectors - Unauthenticated Relay'
            CurrentValue     = 'Get-InboundConnector not available'
            RecommendedValue = 'No open relay connectors'
            Status           = 'Review'
            CheckId          = 'EXO-DIRECTSEND-001'
            Remediation      = 'Connect to Exchange Online PowerShell to check inbound connector configuration.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check inbound connectors: $_"
}

# ------------------------------------------------------------------
# 14. Hidden User Mailboxes (potential compromise indicator)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for hidden user mailboxes..."
    $hiddenMailboxes = @(Get-EXOMailbox -RecipientTypeDetails UserMailbox -ResultSize Unlimited -Filter 'HiddenFromAddressListsEnabled -eq $True' -Properties DisplayName, PrimarySmtpAddress -ErrorAction Stop -WarningAction SilentlyContinue)

    if ($hiddenMailboxes.Count -eq 0) {
        $settingParams = @{
            Category         = 'Mailbox Security'
            Setting          = 'Hidden User Mailboxes'
            CurrentValue     = 'No user mailboxes hidden from GAL'
            RecommendedValue = 'No user mailboxes hidden from address lists'
            Status           = 'Pass'
            CheckId          = 'EXO-HIDDEN-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $upnList = ($hiddenMailboxes | Select-Object -First 5 | ForEach-Object { $_.PrimarySmtpAddress }) -join ', '
        $suffix = if ($hiddenMailboxes.Count -gt 5) { " (+$($hiddenMailboxes.Count - 5) more)" } else { '' }
        $settingParams = @{
            Category         = 'Mailbox Security'
            Setting          = 'Hidden User Mailboxes'
            CurrentValue     = "$($hiddenMailboxes.Count) user mailboxes hidden from GAL: $upnList$suffix"
            RecommendedValue = 'No user mailboxes hidden from address lists'
            Status           = 'Review'
            CheckId          = 'EXO-HIDDEN-001'
            Remediation      = 'Investigate hidden user mailboxes. Mailboxes hidden from the Global Address List may indicate a compromised account. Review: Get-Mailbox -Filter "HiddenFromAddressListsEnabled -eq $true -and RecipientTypeDetails -eq UserMailbox"'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check hidden mailboxes: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Exchange Online'
