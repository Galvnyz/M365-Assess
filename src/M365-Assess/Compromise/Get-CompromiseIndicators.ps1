<#
.SYNOPSIS
    Hunts a Microsoft 365 tenant for common indicators of compromise.
.DESCRIPTION
    Posture checks ask whether a tenant is configured safely. This collector
    asks a different question: are there artefacts that suggest an account or
    the tenant has already been compromised?

    Mailbox scope (Exchange Online):
      IOC-INBOXRULE-001  Inbox rules that forward or redirect mail to external domains
      IOC-INBOXRULE-002  Inbox rules that hide mail (delete or bury matching messages)
      IOC-FORWARD-001    Mailbox-level forwarding to an external address

    Directory scope (Microsoft Graph directory audit log):
      IOC-CONSENT-001    Consent or permission grants for high-impact scopes
      IOC-SPCRED-001     Credentials added to applications or service principals
      IOC-ROLEADD-001    Members added to privileged directory roles

    Every check reports through Add-IndicatorSetting, which only allows a
    clean result when the whole set was examined. A failed or partial query
    yields Unknown, never Pass. A clean result covers only what the check
    examines; it is not proof that the tenant is uncompromised.

    Requires: Exchange Online (View-Only Organization Management) for the mailbox scope;
    Graph AuditLog.Read.All and Directory.Read.All for the directory scope.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.PARAMETER Scope
    Which half to run: Mailbox, Directory or All (default).
.PARAMETER LookbackDays
    How far back to read the directory audit log. Entra ID keeps these logs for
    7 days without a premium licence and 30 days with Entra ID P1 or P2, so the
    effective window is the smaller of this value and the retention period.
.EXAMPLE
    PS> .\Compromise\Get-CompromiseIndicators.ps1 -Scope Mailbox

    Checks every mailbox for external forwarding and suspicious inbox rules.
.EXAMPLE
    PS> .\Compromise\Get-CompromiseIndicators.ps1 -Scope Directory -LookbackDays 14 -OutputPath '.\compromise.csv'

    Reviews 14 days of directory audit events and writes the findings to CSV.
.NOTES
    Author:  Daren9m
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateSet('All', 'Mailbox', 'Directory')]
    [string]$Scope = 'All',

    [Parameter()]
    [ValidateRange(1, 90)]
    [int]$LookbackDays = 30
)

# Continue on errors: each check records its own coverage, so one failed
# query must not stop the others.
$ErrorActionPreference = 'Continue'

$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\Invoke-SafeGraphRequest.ps1')
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\Get-CollectionCoverage.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings

$maxStoredErrors = 20
$cleanResultNote = 'A clean result covers only what this check examines.'

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
function Invoke-ExoWithRetry {
    <#
    .SYNOPSIS
        Runs an Exchange Online call, retrying when the service throttles.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [scriptblock]$ScriptBlock,

        [Parameter()]
        [ValidateRange(0, 6)]
        [int]$MaxRetries = 3
    )

    $attempt = 0
    while ($true) {
        try {
            return (& $ScriptBlock)
        }
        catch {
            $transient = "$($_.Exception.Message)" -match 'throttl|too many|429|server busy|temporarily|timed out|timeout'
            if (-not $transient -or $attempt -ge $MaxRetries) { throw }
            $attempt++
            Start-Sleep -Seconds ([math]::Min(60, [math]::Pow(2, $attempt)))
        }
    }
}

function Get-SmtpAddressFromRecipient {
    <#
    .SYNOPSIS
        Extracts SMTP addresses from an inbox-rule recipient string.
    .DESCRIPTION
        Rule recipients look like '"Name" [SMTP:user@example.com]' for SMTP
        targets and '"Name" [EX:/o=...]' for directory recipients. Only SMTP
        targets can leave the organisation.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Recipient
    )

    if ([string]::IsNullOrWhiteSpace($Recipient)) { return @() }
    $bracketed = [regex]::Matches($Recipient, '\[SMTP:([^\]]+)\]', 'IgnoreCase')
    if ($bracketed.Count -gt 0) {
        return @($bracketed | ForEach-Object { $_.Groups[1].Value.Trim() })
    }
    if ($Recipient -match '\[EX:') { return @() }
    $bare = [regex]::Matches($Recipient, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
    return @($bare | ForEach-Object { $_.Value })
}

function Test-ExternalAddress {
    <#
    .SYNOPSIS
        Returns $true when an address is outside the tenant's accepted domains.
    .DESCRIPTION
        An address that cannot be parsed is treated as external, so an odd
        target is surfaced for review instead of being silently trusted.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Address,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$AcceptedDomains
    )

    $clean = ($Address -replace '^smtp:', '').Trim()
    $at = $clean.LastIndexOf('@')
    if ($at -lt 1 -or $at -eq $clean.Length - 1) { return $true }
    $domain = $clean.Substring($at + 1).ToLowerInvariant()
    return ($AcceptedDomains -notcontains $domain)
}

function Get-AuditValue {
    <#
    .SYNOPSIS
        Reads a key from a Graph response item (hashtable or object).
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [AllowNull()]
        [object]$Item,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($null -eq $Item) { return $null }
    if ($Item -is [System.Collections.IDictionary]) { return $Item[$Name] }
    $property = $Item.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Get-AuditModifiedValue {
    <#
    .SYNOPSIS
        Returns the new values of modified properties on an audit event.
    .PARAMETER PropertyName
        When supplied, only properties with this display name are returned.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [object]$AuditEvent,

        [Parameter()]
        [string]$PropertyName
    )

    $values = foreach ($target in @(Get-AuditValue -Item $AuditEvent -Name 'targetResources')) {
        foreach ($modified in @(Get-AuditValue -Item $target -Name 'modifiedProperties')) {
            if ($null -eq $modified) { continue }
            if ($PropertyName -and (Get-AuditValue -Item $modified -Name 'displayName') -ne $PropertyName) { continue }
            $newValue = Get-AuditValue -Item $modified -Name 'newValue'
            if ($newValue) { "$newValue".Trim('"') }
        }
    }
    return @($values)
}

function ConvertTo-AuditIndicator {
    <#
    .SYNOPSIS
        Shapes a directory audit event into an indicator event row.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [object]$AuditEvent,

        [Parameter(Mandatory)]
        [string]$Detail
    )

    $initiatedBy = Get-AuditValue -Item $AuditEvent -Name 'initiatedBy'
    $user = Get-AuditValue -Item $initiatedBy -Name 'user'
    $app = Get-AuditValue -Item $initiatedBy -Name 'app'
    $actor = Get-AuditValue -Item $user -Name 'userPrincipalName'
    if (-not $actor) { $actor = Get-AuditValue -Item $app -Name 'displayName' }
    if (-not $actor) { $actor = 'unknown' }

    $targets = @(Get-AuditValue -Item $AuditEvent -Name 'targetResources') | Where-Object { $null -ne $_ }
    $targetNames = foreach ($target in $targets) {
        $name = Get-AuditValue -Item $target -Name 'userPrincipalName'
        if (-not $name) { $name = Get-AuditValue -Item $target -Name 'displayName' }
        if (-not $name) { $name = Get-AuditValue -Item $target -Name 'id' }
        if ($name) { "$name" }
    }

    [PSCustomObject][ordered]@{
        Time      = "$(Get-AuditValue -Item $AuditEvent -Name 'activityDateTime')"
        Actor     = "$actor"
        Target    = (@($targetNames | Select-Object -Unique) -join ', ')
        Detail    = $Detail
        IpAddress = "$(Get-AuditValue -Item $user -Name 'ipAddress')"
        Activity  = "$(Get-AuditValue -Item $AuditEvent -Name 'activityDisplayName')"
        Result    = "$(Get-AuditValue -Item $AuditEvent -Name 'result')"
    }
}

function Get-DirectoryAuditEvent {
    <#
    .SYNOPSIS
        Reads directory audit events for a list of activity names.
    .DESCRIPTION
        One filtered query per activity keeps each result set small enough to
        page completely. Returns the events together with coverage, so the
        caller can tell "no events" from "query failed".
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [string[]]$ActivityName,

        [Parameter(Mandatory)]
        [string]$Since
    )

    $events = [System.Collections.Generic.List[object]]::new()
    $errors = [System.Collections.Generic.List[string]]::new()
    $succeeded = 0
    foreach ($name in $ActivityName) {
        $filter = "activityDateTime ge $Since and activityDisplayName eq '$name'"
        $uri = '/v1.0/auditLogs/directoryAudits?$filter=' + [uri]::EscapeDataString($filter) + '&$top=500'
        try {
            # Warnings are left on the stream: the orchestrator uses them to
            # mark the collector Partial.
            $response = Invoke-SafeGraphRequest -ExpectCollection -Method GET -Uri $uri -MaxPages 200 -ErrorAction Stop
            foreach ($item in @($response['value'])) {
                if ($null -ne $item) { $events.Add($item) }
            }
            $succeeded++
        }
        catch {
            $errors.Add("Audit query for '$name' failed: $($_.Exception.Message)")
        }
    }

    [PSCustomObject]@{
        Events   = $events
        Coverage = New-CollectionCoverage -Scope 'audit queries' -Total $ActivityName.Count -Examined $succeeded -Errors $errors
    }
}

# ==================================================================
# MAILBOX SCOPE
# ==================================================================
if ($Scope -in @('All', 'Mailbox')) {
    $setupErrors = [System.Collections.Generic.List[string]]::new()
    $acceptedDomains = @()
    $mailboxes = @()

    try {
        $acceptedDomains = @(
            Invoke-ExoWithRetry -ScriptBlock { Get-AcceptedDomain -ErrorAction Stop } |
                ForEach-Object { "$($_.DomainName)".ToLowerInvariant() } |
                Where-Object { $_ }
        )
        if ($acceptedDomains.Count -eq 0) { throw 'No accepted domains were returned.' }
    }
    catch {
        $setupErrors.Add("Could not read accepted domains, so external targets cannot be identified: $($_.Exception.Message)")
    }

    if ($setupErrors.Count -eq 0) {
        try {
            $mailboxes = @(Invoke-ExoWithRetry -ScriptBlock {
                    Get-EXOMailbox -ResultSize Unlimited -Properties ForwardingSmtpAddress, ForwardingAddress, DeliverToMailboxAndForward -ErrorAction Stop
                })
        }
        catch {
            $setupErrors.Add("Could not list mailboxes: $($_.Exception.Message)")
        }
    }

    $ruleExternalHits = [System.Collections.Generic.List[object]]::new()
    $ruleHideHits = [System.Collections.Generic.List[object]]::new()
    $forwardHits = [System.Collections.Generic.List[object]]::new()
    $ruleErrors = [System.Collections.Generic.List[string]]::new()
    $forwardErrors = [System.Collections.Generic.List[string]]::new()
    $rulesExamined = 0
    $forwardExamined = 0

    # Words attackers filter on to hide replies, alerts and payment threads.
    $hideKeywordPattern = 'invoice|payment|wire|bank|remit|payroll|password|phish|hack|spam|fraud|security|suspicious|compromis|helpdesk|mfa|verification|unusual sign'
    $buryFolderPattern = 'RSS|Conversation History'
    $hideFolderPattern = 'RSS|Conversation History|Junk|Deleted Items|Archive'

    $index = 0
    foreach ($mailbox in $mailboxes) {
        $index++
        $mailboxName = "$($mailbox.UserPrincipalName)"
        if (-not $mailboxName) { $mailboxName = "$($mailbox.PrimarySmtpAddress)" }
        if (-not $mailboxName) { $mailboxName = "$($mailbox.Identity)" }

        if ($index % 25 -eq 0 -or $index -eq $mailboxes.Count) {
            Write-Progress -Activity 'Compromise indicators: mailbox rules' -Status "$index of $($mailboxes.Count) mailboxes" -PercentComplete ([math]::Floor(($index / $mailboxes.Count) * 100))
        }

        # ---- IOC-FORWARD-001: mailbox-level forwarding ----
        try {
            $forwardTargets = [System.Collections.Generic.List[string]]::new()
            if ($mailbox.ForwardingSmtpAddress) {
                $forwardTargets.Add(("$($mailbox.ForwardingSmtpAddress)" -replace '^smtp:', ''))
            }
            if ($mailbox.ForwardingAddress) {
                # A directory recipient can be a mail contact with an external address.
                $forwardingIdentity = "$($mailbox.ForwardingAddress)"
                $recipient = Invoke-ExoWithRetry -ScriptBlock { Get-Recipient -Identity $forwardingIdentity -ErrorAction Stop }
                $resolved = if ($recipient.ExternalEmailAddress) { "$($recipient.ExternalEmailAddress)" } else { "$($recipient.PrimarySmtpAddress)" }
                $forwardTargets.Add(($resolved -replace '^smtp:', ''))
            }
            foreach ($forwardTarget in $forwardTargets) {
                if (Test-ExternalAddress -Address $forwardTarget -AcceptedDomains $acceptedDomains) {
                    $keepsCopy = if ($mailbox.DeliverToMailboxAndForward) { 'keeps a copy' } else { 'no copy kept in the mailbox' }
                    $forwardHits.Add([PSCustomObject][ordered]@{
                            Time   = ''
                            Actor  = $mailboxName
                            Target = $forwardTarget
                            Detail = "Mailbox forwards all mail to an external address ($keepsCopy)"
                        })
                }
            }
            $forwardExamined++
        }
        catch {
            if ($forwardErrors.Count -lt $maxStoredErrors) { $forwardErrors.Add("${mailboxName}: $($_.Exception.Message)") }
        }

        # ---- IOC-INBOXRULE-001 / 002: inbox rules ----
        try {
            $rules = @(Invoke-ExoWithRetry -ScriptBlock { Get-InboxRule -Mailbox $mailboxName -IncludeHidden -ErrorAction Stop })
        }
        catch {
            if ($ruleErrors.Count -lt $maxStoredErrors) { $ruleErrors.Add("${mailboxName}: $($_.Exception.Message)") }
            continue
        }
        $rulesExamined++

        foreach ($rule in $rules) {
            if ($null -eq $rule) { continue }
            $ruleName = "$($rule.Name)"
            $state = if ($rule.Enabled) { 'enabled' } else { 'disabled' }

            $externalTargets = foreach ($recipientText in @($rule.ForwardTo) + @($rule.ForwardAsAttachmentTo) + @($rule.RedirectTo)) {
                foreach ($address in (Get-SmtpAddressFromRecipient -Recipient "$recipientText")) {
                    if (Test-ExternalAddress -Address $address -AcceptedDomains $acceptedDomains) { $address }
                }
            }
            $externalTargets = @($externalTargets | Select-Object -Unique)
            if ($externalTargets.Count -gt 0) {
                $ruleExternalHits.Add([PSCustomObject][ordered]@{
                        Time   = ''
                        Actor  = $mailboxName
                        Target = $ruleName
                        Detail = "Rule ($state) sends mail to external address(es): $($externalTargets -join ', ')"
                    })
            }

            $moveFolder = "$($rule.MoveToFolder)"
            $deletes = [bool]$rule.DeleteMessage
            $hidesMail = $deletes -or ($moveFolder -match $hideFolderPattern)
            if ($hidesMail) {
                $conditionText = @(
                    @($rule.SubjectContainsWords) + @($rule.BodyContainsWords) +
                    @($rule.SubjectOrBodyContainsWords) + @($rule.FromAddressContainsWords)
                ) -join ' '
                $reasons = [System.Collections.Generic.List[string]]::new()
                if ($conditionText -match $hideKeywordPattern) { $reasons.Add("matches on '$($Matches[0])'") }
                if ($ruleName -match '^[\W_]{1,3}$') { $reasons.Add('rule name is only punctuation') }
                if ($moveFolder -match $buryFolderPattern) { $reasons.Add("moves mail to '$moveFolder'") }
                if ($reasons.Count -gt 0) {
                    $action = if ($deletes) { 'deletes' } else { 'moves' }
                    $ruleHideHits.Add([PSCustomObject][ordered]@{
                            Time   = ''
                            Actor  = $mailboxName
                            Target = $ruleName
                            Detail = "Rule ($state) $action matching mail: $($reasons -join '; ')"
                        })
                }
            }
        }
    }
    if ($mailboxes.Count -gt 0) {
        Write-Progress -Activity 'Compromise indicators: mailbox rules' -Completed
    }

    $ruleCoverage = New-CollectionCoverage -Scope 'mailboxes' -Total $mailboxes.Count -Examined $rulesExamined -Errors (@($setupErrors) + @($ruleErrors))
    $forwardCoverage = New-CollectionCoverage -Scope 'mailboxes' -Total $mailboxes.Count -Examined $forwardExamined -Errors (@($setupErrors) + @($forwardErrors))
    $ruleLimitations = "Rules hidden by direct MAPI manipulation are not returned by Get-InboxRule. Rules have no creation date, so age cannot be shown. $cleanResultNote"

    $settingParams = @{
        CheckId            = 'IOC-INBOXRULE-001'
        Category           = 'Mailbox Indicators'
        Setting            = 'Inbox rules forwarding to external domains'
        Coverage           = $ruleCoverage
        Indicators         = $ruleExternalHits
        HitStatus          = 'Fail'
        Window             = 'current inbox rules'
        RecommendedValue   = 'No inbox rule forwards or redirects mail outside the organisation'
        Remediation        = 'Treat each rule as a possible account compromise until the mailbox owner confirms it. If unexpected: remove the rule (Remove-InboxRule), reset the password, revoke sessions (Revoke-MgUserSignInSession), review MFA methods and sign-in logs, and check what was sent to the external address.'
        EvidenceSource     = 'Get-InboxRule -IncludeHidden'
        PermissionRequired = 'Exchange Online: View-Only Organization Management'
        Limitations        = $ruleLimitations
    }
    Add-IndicatorSetting @settingParams

    $settingParams = @{
        CheckId            = 'IOC-INBOXRULE-002'
        Category           = 'Mailbox Indicators'
        Setting            = 'Inbox rules that hide mail'
        Coverage           = $ruleCoverage
        Indicators         = $ruleHideHits
        HitStatus          = 'Warning'
        Window             = 'current inbox rules'
        RecommendedValue   = 'No inbox rule deletes or buries security, payment or reply mail'
        Remediation        = 'Ask the mailbox owner whether they created the rule. Rules that delete or bury mail about payments, passwords or security alerts are a common way to hide a takeover from the owner. If unexpected, remove the rule and investigate the account as compromised.'
        EvidenceSource     = 'Get-InboxRule -IncludeHidden'
        PermissionRequired = 'Exchange Online: View-Only Organization Management'
        Limitations        = "Pattern based: flags rules that delete or move mail and also match finance or security keywords, use a punctuation-only name, or target RSS or Conversation History folders. Legitimate clean-up rules can match. $ruleLimitations"
    }
    Add-IndicatorSetting @settingParams

    $settingParams = @{
        CheckId            = 'IOC-FORWARD-001'
        Category           = 'Mailbox Indicators'
        Setting            = 'Mailbox forwarding to external addresses'
        Coverage           = $forwardCoverage
        Indicators         = $forwardHits
        HitStatus          = 'Warning'
        Window             = 'current mailbox settings'
        RecommendedValue   = 'No mailbox forwards all mail outside the organisation'
        Remediation        = 'Confirm each forward with the mailbox owner and their manager. If unexpected, clear it (Set-Mailbox -ForwardingSmtpAddress $null -ForwardingAddress $null) and investigate the account as compromised.'
        EvidenceSource     = 'Get-EXOMailbox (ForwardingSmtpAddress, ForwardingAddress)'
        PermissionRequired = 'Exchange Online: View-Only Organization Management'
        Limitations        = "Forwarding set up for a real business reason looks the same as forwarding set by an attacker. $cleanResultNote"
    }
    Add-IndicatorSetting @settingParams
}

# ==================================================================
# DIRECTORY SCOPE
# ==================================================================
if ($Scope -in @('All', 'Directory')) {
    $since = (Get-Date).ToUniversalTime().AddDays(-$LookbackDays).ToString('yyyy-MM-ddTHH:mm:ssZ')

    # Entra keeps directory audit logs 7 days without a premium licence and
    # 30 days with P1/P2. Say which window was really visible.
    $retentionDays = $null
    try {
        $skus = Invoke-SafeGraphRequest -ExpectCollection -Method GET -Uri '/v1.0/subscribedSkus?$select=capabilityStatus,servicePlans' -ErrorAction Stop 3>$null
        $hasPremium = $false
        foreach ($sku in @($skus['value'])) {
            if ((Get-AuditValue -Item $sku -Name 'capabilityStatus') -ne 'Enabled') { continue }
            foreach ($plan in @(Get-AuditValue -Item $sku -Name 'servicePlans')) {
                if ((Get-AuditValue -Item $plan -Name 'servicePlanName') -in @('AAD_PREMIUM', 'AAD_PREMIUM_P2')) { $hasPremium = $true }
            }
        }
        $retentionDays = if ($hasPremium) { 30 } else { 7 }
    }
    catch {
        Write-Verbose "Could not determine audit log retention: $($_.Exception.Message)"
    }

    if ($null -eq $retentionDays) {
        $effectiveDays = $LookbackDays
        $retentionNote = "Audit log retention could not be determined (7 days without Entra ID P1/P2, 30 days with). Events older than the retention period are not visible, so the real window may be shorter than $LookbackDays days."
    }
    elseif ($retentionDays -lt $LookbackDays) {
        $effectiveDays = $retentionDays
        $retentionNote = "Requested $LookbackDays days, but this tenant keeps directory audit logs for $retentionDays days, so only the last $retentionDays days were visible."
    }
    else {
        $effectiveDays = $LookbackDays
        $retentionNote = "This tenant keeps directory audit logs for $retentionDays days."
    }
    $auditWindow = "the last $effectiveDays days"
    $enDash = [char]0x2013

    # ---- IOC-CONSENT-001 ----
    $highImpactScope = 'Mail\.ReadWrite|Mail\.Read|Mail\.Send|MailboxSettings\.ReadWrite|full_access_as_app|EWS\.AccessAsUser\.All|IMAP\.AccessAsUser\.All|Files\.ReadWrite\.All|Files\.Read\.All|Sites\.FullControl\.All|Sites\.ReadWrite\.All|Sites\.Read\.All|Directory\.ReadWrite\.All|RoleManagement\.ReadWrite\.Directory|Application\.ReadWrite\.All|AppRoleAssignment\.ReadWrite\.All|User\.ReadWrite\.All|Group\.ReadWrite\.All|Policy\.ReadWrite\.ConditionalAccess|Contacts\.Read|Notes\.Read'
    $consentAudit = Get-DirectoryAuditEvent -Since $since -ActivityName @(
        'Consent to application'
        'Add delegated permission grant'
        'Add app role assignment to service principal'
    )
    $consentHits = foreach ($auditEvent in $consentAudit.Events) {
        $granted = (Get-AuditModifiedValue -AuditEvent $auditEvent) -join ' '
        $matched = @([regex]::Matches($granted, $highImpactScope) | ForEach-Object { $_.Value } | Select-Object -Unique)
        if ($matched.Count -gt 0) {
            ConvertTo-AuditIndicator -AuditEvent $auditEvent -Detail "High-impact permission(s) granted: $($matched -join ', ')"
        }
    }
    $settingParams = @{
        CheckId            = 'IOC-CONSENT-001'
        Category           = 'Directory Indicators'
        Setting            = 'Consent grants for high-impact permissions'
        Coverage           = $consentAudit.Coverage
        Indicators         = @($consentHits)
        HitStatus          = 'Warning'
        Window             = $auditWindow
        RecommendedValue   = 'Every grant of mail, file or directory-write permissions is expected and approved'
        Remediation        = 'For each grant, confirm who approved the application and why. If unexpected: remove the grant and the service principal in Entra admin center > Enterprise applications, revoke the sessions of the consenting user, and review what the application accessed.'
        EvidenceSource     = 'Graph /auditLogs/directoryAudits'
        PermissionRequired = 'AuditLog.Read.All, Directory.Read.All'
        Limitations        = "$retentionNote Grants made before the window are not shown; the Enterprise App checks in the Identity section review standing permissions. $cleanResultNote"
    }
    Add-IndicatorSetting @settingParams

    # ---- IOC-SPCRED-001 ----
    $credentialAudit = Get-DirectoryAuditEvent -Since $since -ActivityName @(
        'Add service principal credentials'
        "Update application $enDash Certificates and secrets management"
    )
    $credentialHits = foreach ($auditEvent in $credentialAudit.Events) {
        ConvertTo-AuditIndicator -AuditEvent $auditEvent -Detail 'Secret or certificate added'
    }
    $settingParams = @{
        CheckId            = 'IOC-SPCRED-001'
        Category           = 'Directory Indicators'
        Setting            = 'Credentials added to applications and service principals'
        Coverage           = $credentialAudit.Coverage
        Indicators         = @($credentialHits)
        HitStatus          = 'Warning'
        Window             = $auditWindow
        RecommendedValue   = 'Every new application secret or certificate matches a planned change'
        Remediation        = 'Match each addition to a known rotation or deployment. An attacker who adds their own secret to an existing application keeps access after the user password is reset. If unexpected: remove the credential, review the application permissions and its sign-in activity, and investigate the actor account.'
        EvidenceSource     = 'Graph /auditLogs/directoryAudits'
        PermissionRequired = 'AuditLog.Read.All, Directory.Read.All'
        Limitations        = "$retentionNote Routine rotations appear here too; each event needs a human decision. $cleanResultNote"
    }
    Add-IndicatorSetting @settingParams

    # ---- IOC-ROLEADD-001 ----
    $privilegedRolePattern = '^(Global Administrator|Company Administrator|Privileged Role Administrator|Privileged Authentication Administrator|Security Administrator|Exchange Administrator|SharePoint Administrator|User Administrator|Application Administrator|Cloud Application Administrator|Conditional Access Administrator|Authentication Administrator|Authentication Policy Administrator|Hybrid Identity Administrator|Intune Administrator|Helpdesk Administrator|Password Administrator|Partner Tier2 Support|Directory Synchronization Accounts)$'
    $roleAudit = Get-DirectoryAuditEvent -Since $since -ActivityName @(
        'Add member to role'
        'Add eligible member to role'
    )
    $roleHits = foreach ($auditEvent in $roleAudit.Events) {
        $roleNames = @(Get-AuditModifiedValue -AuditEvent $auditEvent -PropertyName 'Role.DisplayName')
        if ($roleNames.Count -eq 0) {
            # Role not identifiable: surface it instead of assuming it is harmless.
            ConvertTo-AuditIndicator -AuditEvent $auditEvent -Detail 'Member added to a role that could not be identified from the audit event'
            continue
        }
        $privileged = @($roleNames | Where-Object { $_ -match $privilegedRolePattern })
        if ($privileged.Count -gt 0) {
            ConvertTo-AuditIndicator -AuditEvent $auditEvent -Detail "Added to privileged role: $($privileged -join ', ')"
        }
    }
    $settingParams = @{
        CheckId            = 'IOC-ROLEADD-001'
        Category           = 'Directory Indicators'
        Setting            = 'Members added to privileged roles'
        Coverage           = $roleAudit.Coverage
        Indicators         = @($roleHits)
        HitStatus          = 'Warning'
        Window             = $auditWindow
        RecommendedValue   = 'Every privileged role assignment matches an approved request'
        Remediation        = 'Confirm each assignment with the person who approved it. If unexpected: remove the role assignment, reset the credentials of both the actor and the new member, revoke their sessions, and review everything either account did since the assignment.'
        EvidenceSource     = 'Graph /auditLogs/directoryAudits'
        PermissionRequired = 'AuditLog.Read.All, Directory.Read.All'
        Limitations        = "$retentionNote Covers direct and eligible assignments to a fixed list of high-privilege roles; role activations through PIM and custom roles are not listed. $cleanResultNote"
    }
    Add-IndicatorSetting @settingParams
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings @($settings) -OutputPath $OutputPath -ServiceLabel 'Compromise Indicators'
