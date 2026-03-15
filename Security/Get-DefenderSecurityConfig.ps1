<#
.SYNOPSIS
    Collects Microsoft Defender for Office 365 security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Exchange Online Protection and Defender for Office 365 policies to evaluate
    security configuration including anti-phishing (impersonation protection, DMARC
    enforcement), anti-spam (threshold levels, bulk filtering), anti-malware (common
    attachment filter, ZAP), Safe Links, and Safe Attachments. Returns a structured
    inventory of settings with current values and CIS benchmark recommendations.

    Handles tenants without Defender for Office 365 licensing gracefully by checking
    cmdlet availability before querying.

    Requires an active Exchange Online connection (Connect-ExchangeOnline).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Security\Get-DefenderSecurityConfig.ps1

    Displays Defender for Office 365 security configuration settings.
.EXAMPLE
    PS> .\Security\Get-DefenderSecurityConfig.ps1 -OutputPath '.\defender-security-config.csv'

    Exports the security configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
    Some checks require Defender for Office 365 Plan 1 or Plan 2 licensing.
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
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# 1. Anti-Phishing Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking anti-phishing policies..."
    $antiPhishPolicies = Get-AntiPhishPolicy -ErrorAction Stop

    foreach ($policy in @($antiPhishPolicies)) {
        $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }

        # Phishing threshold
        $threshold = $policy.PhishThresholdLevel
        Add-Setting -Category 'Anti-Phishing' `
            -Setting "Phishing Threshold ($policyLabel)" `
            -CurrentValue "$threshold" -RecommendedValue '2+ (Aggressive)' `
            -Status $(if ([int]$threshold -ge 2) { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-ANTIPHISH-001' `
            -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -PhishThresholdLevel 2. Security admin center > Anti-phishing > Edit policy > Set threshold to 2 (Aggressive) or higher.'

        # Impersonation protection (Defender P1+ only)
        if ($null -ne $policy.EnableMailboxIntelligenceProtection) {
            $mailboxIntel = $policy.EnableMailboxIntelligenceProtection
            Add-Setting -Category 'Anti-Phishing' `
                -Setting "Mailbox Intelligence Protection ($policyLabel)" `
                -CurrentValue "$mailboxIntel" -RecommendedValue 'True' `
                -Status $(if ($mailboxIntel) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-ANTIPHISH-001' `
                -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableMailboxIntelligenceProtection $true. Security admin center > Anti-phishing > Impersonation > Enable Mailbox intelligence protection.'
        }

        if ($null -ne $policy.EnableTargetedUserProtection) {
            $targetedUser = $policy.EnableTargetedUserProtection
            Add-Setting -Category 'Anti-Phishing' `
                -Setting "Targeted User Protection ($policyLabel)" `
                -CurrentValue "$targetedUser" -RecommendedValue 'True' `
                -Status $(if ($targetedUser) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-ANTIPHISH-001' `
                -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableTargetedUserProtection $true -TargetedUsersToProtect @{Add="user@domain.com"}. Security admin center > Anti-phishing > Impersonation > Add users to protect.'
        }

        if ($null -ne $policy.EnableTargetedDomainsProtection) {
            $targetedDomain = $policy.EnableTargetedDomainsProtection
            Add-Setting -Category 'Anti-Phishing' `
                -Setting "Targeted Domain Protection ($policyLabel)" `
                -CurrentValue "$targetedDomain" -RecommendedValue 'True' `
                -Status $(if ($targetedDomain) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-ANTIPHISH-001' `
                -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableTargetedDomainsProtection $true. Security admin center > Anti-phishing > Impersonation > Add domains to protect.'
        }

        # Honor DMARC policy
        if ($null -ne $policy.HonorDmarcPolicy) {
            $honorDmarc = $policy.HonorDmarcPolicy
            Add-Setting -Category 'Anti-Phishing' `
                -Setting "Honor DMARC Policy ($policyLabel)" `
                -CurrentValue "$honorDmarc" -RecommendedValue 'True' `
                -Status $(if ($honorDmarc) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ANTIPHISH-001' `
                -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -HonorDmarcPolicy $true. Security admin center > Anti-phishing > Enable Honor DMARC record policy.'
        }

        # Spoof intelligence
        $spoofIntel = $policy.EnableSpoofIntelligence
        Add-Setting -Category 'Anti-Phishing' `
            -Setting "Spoof Intelligence ($policyLabel)" `
            -CurrentValue "$spoofIntel" -RecommendedValue 'True' `
            -Status $(if ($spoofIntel) { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-ANTIPHISH-001' `
            -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableSpoofIntelligence $true. Security admin center > Anti-phishing > Spoof > Enable spoof intelligence.'

        # Safety tips
        if ($null -ne $policy.EnableFirstContactSafetyTips) {
            $firstContact = $policy.EnableFirstContactSafetyTips
            Add-Setting -Category 'Anti-Phishing' `
                -Setting "First Contact Safety Tips ($policyLabel)" `
                -CurrentValue "$firstContact" -RecommendedValue 'True' `
                -Status $(if ($firstContact) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-ANTIPHISH-001' `
                -Remediation 'Run: Set-AntiPhishPolicy -Identity <PolicyName> -EnableFirstContactSafetyTips $true. Security admin center > Anti-phishing > Safety tips > Enable first contact safety tips.'
        }

        # Only assess default policy in detail to avoid duplicate noise
        if (-not $policy.IsDefault) { continue }
    }
}
catch {
    Write-Warning "Could not retrieve anti-phishing policies: $_"
}

# ------------------------------------------------------------------
# 2. Anti-Spam Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking anti-spam policies..."
    $antiSpamPolicies = Get-HostedContentFilterPolicy -ErrorAction Stop

    foreach ($policy in @($antiSpamPolicies)) {
        $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }

        # Bulk complaint level threshold
        $bcl = $policy.BulkThreshold
        Add-Setting -Category 'Anti-Spam' `
            -Setting "Bulk Complaint Level Threshold ($policyLabel)" `
            -CurrentValue "$bcl" -RecommendedValue '6 or lower' `
            -Status $(if ([int]$bcl -le 6) { 'Pass' } else { 'Warning' }) `
            -CheckId 'DEFENDER-ANTISPAM-001' `
            -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -BulkThreshold 6. Security admin center > Anti-spam > Inbound policy > Bulk email threshold > Set to 6 or lower.'

        # Spam action
        $spamAction = $policy.SpamAction
        Add-Setting -Category 'Anti-Spam' `
            -Setting "Spam Action ($policyLabel)" `
            -CurrentValue "$spamAction" -RecommendedValue 'MoveToJmf or Quarantine' `
            -Status $(if ($spamAction -eq 'MoveToJmf' -or $spamAction -eq 'Quarantine') { 'Pass' } else { 'Warning' }) `
            -CheckId 'DEFENDER-ANTISPAM-001' `
            -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -SpamAction MoveToJmf. Security admin center > Anti-spam > Inbound policy > Spam action > Move to Junk Email folder.'

        # High confidence spam action
        $hcSpamAction = $policy.HighConfidenceSpamAction
        Add-Setting -Category 'Anti-Spam' `
            -Setting "High Confidence Spam Action ($policyLabel)" `
            -CurrentValue "$hcSpamAction" -RecommendedValue 'Quarantine' `
            -Status $(if ($hcSpamAction -eq 'Quarantine') { 'Pass' } else { 'Warning' }) `
            -CheckId 'DEFENDER-ANTISPAM-001' `
            -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -HighConfidenceSpamAction Quarantine. Security admin center > Anti-spam > Inbound policy > High confidence spam action > Quarantine.'

        # High confidence phishing action
        $hcPhishAction = $policy.HighConfidencePhishAction
        Add-Setting -Category 'Anti-Spam' `
            -Setting "High Confidence Phish Action ($policyLabel)" `
            -CurrentValue "$hcPhishAction" -RecommendedValue 'Quarantine' `
            -Status $(if ($hcPhishAction -eq 'Quarantine') { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-ANTISPAM-001' `
            -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -HighConfidencePhishAction Quarantine. Security admin center > Anti-spam > Inbound policy > High confidence phishing action > Quarantine.'

        # Phishing action
        $phishAction = $policy.PhishSpamAction
        Add-Setting -Category 'Anti-Spam' `
            -Setting "Phishing Action ($policyLabel)" `
            -CurrentValue "$phishAction" -RecommendedValue 'Quarantine' `
            -Status $(if ($phishAction -eq 'Quarantine') { 'Pass' } else { 'Warning' }) `
            -CheckId 'DEFENDER-ANTISPAM-001' `
            -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -PhishSpamAction Quarantine. Security admin center > Anti-spam > Inbound policy > Phishing action > Quarantine.'

        # Zero-hour Auto Purge (ZAP)
        if ($null -ne $policy.ZapEnabled) {
            $zapEnabled = $policy.ZapEnabled
            Add-Setting -Category 'Anti-Spam' `
                -Setting "Zero-Hour Auto Purge ($policyLabel)" `
                -CurrentValue "$zapEnabled" -RecommendedValue 'True' `
                -Status $(if ($zapEnabled) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ANTISPAM-001' `
                -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -ZapEnabled $true. Security admin center > Anti-spam > Inbound policy > Zero-hour auto purge > Enabled.'
        }

        # Spam ZAP
        if ($null -ne $policy.SpamZapEnabled) {
            $spamZap = $policy.SpamZapEnabled
            Add-Setting -Category 'Anti-Spam' `
                -Setting "Spam ZAP ($policyLabel)" `
                -CurrentValue "$spamZap" -RecommendedValue 'True' `
                -Status $(if ($spamZap) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ANTISPAM-001' `
                -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -SpamZapEnabled $true. Security admin center > Anti-spam > Inbound policy > Zero-hour auto purge for spam > Enabled.'
        }

        # Phish ZAP
        if ($null -ne $policy.PhishZapEnabled) {
            $phishZap = $policy.PhishZapEnabled
            Add-Setting -Category 'Anti-Spam' `
                -Setting "Phishing ZAP ($policyLabel)" `
                -CurrentValue "$phishZap" -RecommendedValue 'True' `
                -Status $(if ($phishZap) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ANTISPAM-001' `
                -Remediation 'Run: Set-HostedContentFilterPolicy -Identity <PolicyName> -PhishZapEnabled $true. Security admin center > Anti-spam > Inbound policy > Zero-hour auto purge for phishing > Enabled.'
        }

        # Only assess default policy in detail
        if (-not $policy.IsDefault) { continue }
    }
}
catch {
    Write-Warning "Could not retrieve anti-spam policies: $_"
}

# ------------------------------------------------------------------
# 3. Anti-Malware Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking anti-malware policies..."
    $malwarePolicies = Get-MalwareFilterPolicy -ErrorAction Stop

    foreach ($policy in @($malwarePolicies)) {
        $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }

        # Common attachment type filter
        $commonFilter = $policy.EnableFileFilter
        Add-Setting -Category 'Anti-Malware' `
            -Setting "Common Attachment Filter ($policyLabel)" `
            -CurrentValue "$commonFilter" -RecommendedValue 'True' `
            -Status $(if ($commonFilter) { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-ANTIMALWARE-001' `
            -Remediation 'Run: Set-MalwareFilterPolicy -Identity <PolicyName> -EnableFileFilter $true. Security admin center > Anti-malware > Default policy > Common attachments filter > Enable.'

        # ZAP for malware
        if ($null -ne $policy.ZapEnabled) {
            $malwareZap = $policy.ZapEnabled
            Add-Setting -Category 'Anti-Malware' `
                -Setting "Malware ZAP ($policyLabel)" `
                -CurrentValue "$malwareZap" -RecommendedValue 'True' `
                -Status $(if ($malwareZap) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ANTIMALWARE-001' `
                -Remediation 'Run: Set-MalwareFilterPolicy -Identity <PolicyName> -ZapEnabled $true. Security admin center > Anti-malware > Default policy > Zero-hour auto purge for malware > Enabled.'
        }

        # Admin notification
        $adminNotify = $policy.EnableInternalSenderAdminNotifications
        Add-Setting -Category 'Anti-Malware' `
            -Setting "Internal Sender Admin Notifications ($policyLabel)" `
            -CurrentValue "$adminNotify" -RecommendedValue 'True' `
            -Status $(if ($adminNotify) { 'Pass' } else { 'Warning' }) `
            -CheckId 'DEFENDER-ANTIMALWARE-002' `
            -Remediation 'Run: Set-MalwareFilterPolicy -Identity <PolicyName> -EnableInternalSenderAdminNotifications $true -InternalSenderAdminAddress admin@domain.com. Security admin center > Anti-malware > Default policy > Admin notifications > Notify admin about undelivered messages from internal senders.'

        # Only assess default policy in detail
        if (-not $policy.IsDefault) { continue }
    }
}
catch {
    Write-Warning "Could not retrieve anti-malware policies: $_"
}

# ------------------------------------------------------------------
# 4. Safe Links Policies (Defender P1+)
# ------------------------------------------------------------------
try {
    $slAvailable = Get-Command -Name Get-SafeLinksPolicy -ErrorAction SilentlyContinue
    if ($slAvailable) {
        Write-Verbose "Checking Safe Links policies..."
        $safeLinks = Get-SafeLinksPolicy -ErrorAction Stop

        if (@($safeLinks).Count -eq 0) {
            Add-Setting -Category 'Safe Links' -Setting 'Safe Links Policies' `
                -CurrentValue 'None configured' -RecommendedValue 'At least 1 policy' `
                -Status 'Warning' `
                -CheckId 'DEFENDER-SAFELINKS-001' `
                -Remediation 'Run: New-SafeLinksPolicy -Name "Safe Links" -IsEnabled $true; New-SafeLinksRule -Name "Safe Links" -SafeLinksPolicy "Safe Links" -RecipientDomainIs (Get-AcceptedDomain).Name. Security admin center > Safe Links > Create a policy covering all users.'
        }
        else {
            foreach ($policy in @($safeLinks)) {
                $policyLabel = $policy.Name

                # URL scanning
                $scanUrls = $policy.ScanUrls
                Add-Setting -Category 'Safe Links' `
                    -Setting "Real-time URL Scanning ($policyLabel)" `
                    -CurrentValue "$scanUrls" -RecommendedValue 'True' `
                    -Status $(if ($scanUrls) { 'Pass' } else { 'Warning' }) `
                    -CheckId 'DEFENDER-SAFELINKS-001' `
                    -Remediation 'Run: Set-SafeLinksPolicy -Identity <PolicyName> -ScanUrls $true. Security admin center > Safe Links policy > URL & click protection > Enable real-time URL scanning.'

                # Click tracking
                $trackClicks = -not $policy.DoNotTrackUserClicks
                Add-Setting -Category 'Safe Links' `
                    -Setting "Track User Clicks ($policyLabel)" `
                    -CurrentValue "$trackClicks" -RecommendedValue 'True' `
                    -Status $(if ($trackClicks) { 'Pass' } else { 'Warning' }) `
                    -CheckId 'DEFENDER-SAFELINKS-001' `
                    -Remediation 'Run: Set-SafeLinksPolicy -Identity <PolicyName> -DoNotTrackUserClicks $false. Security admin center > Safe Links policy > Ensure "Do not track when users click protected links" is disabled.'

                # Internal senders
                if ($null -ne $policy.EnableForInternalSenders) {
                    $internalSenders = $policy.EnableForInternalSenders
                    Add-Setting -Category 'Safe Links' `
                        -Setting "Enable for Internal Senders ($policyLabel)" `
                        -CurrentValue "$internalSenders" -RecommendedValue 'True' `
                        -Status $(if ($internalSenders) { 'Pass' } else { 'Warning' }) `
                        -CheckId 'DEFENDER-SAFELINKS-001' `
                        -Remediation 'Run: Set-SafeLinksPolicy -Identity <PolicyName> -EnableForInternalSenders $true. Security admin center > Safe Links policy > Enable for messages sent within the organization.'
                }

                # Wait for URL scanning
                if ($null -ne $policy.DeliverMessageAfterScan) {
                    $waitScan = $policy.DeliverMessageAfterScan
                    Add-Setting -Category 'Safe Links' `
                        -Setting "Wait for URL Scan ($policyLabel)" `
                        -CurrentValue "$waitScan" -RecommendedValue 'True' `
                        -Status $(if ($waitScan) { 'Pass' } else { 'Warning' }) `
                        -CheckId 'DEFENDER-SAFELINKS-001' `
                        -Remediation 'Run: Set-SafeLinksPolicy -Identity <PolicyName> -DeliverMessageAfterScan $true. Security admin center > Safe Links policy > Wait for URL scanning to complete before delivering the message.'
                }
            }
        }
    }
    else {
        Add-Setting -Category 'Safe Links' -Setting 'Safe Links Availability' `
            -CurrentValue 'Not licensed' -RecommendedValue 'Defender for Office 365 P1+' `
            -Status 'Review' `
            -CheckId 'DEFENDER-SAFELINKS-001' `
            -Remediation 'Safe Links requires Defender for Office 365 Plan 1 or higher.'
    }
}
catch {
    Write-Warning "Could not retrieve Safe Links policies: $_"
}

# ------------------------------------------------------------------
# 5. Safe Attachments Policies (Defender P1+)
# ------------------------------------------------------------------
try {
    $saAvailable = Get-Command -Name Get-SafeAttachmentPolicy -ErrorAction SilentlyContinue
    if ($saAvailable) {
        Write-Verbose "Checking Safe Attachments policies..."
        $safeAttachments = Get-SafeAttachmentPolicy -ErrorAction Stop

        if (@($safeAttachments).Count -eq 0) {
            Add-Setting -Category 'Safe Attachments' -Setting 'Safe Attachments Policies' `
                -CurrentValue 'None configured' -RecommendedValue 'At least 1 policy' `
                -Status 'Warning' `
                -CheckId 'DEFENDER-SAFEATTACH-001' `
                -Remediation 'Run: New-SafeAttachmentPolicy -Name "Safe Attachments" -Enable $true -Action Block; New-SafeAttachmentRule -Name "Safe Attachments" -SafeAttachmentPolicy "Safe Attachments" -RecipientDomainIs (Get-AcceptedDomain).Name. Security admin center > Safe Attachments > Create a policy covering all users.'
        }
        else {
            foreach ($policy in @($safeAttachments)) {
                $policyLabel = $policy.Name

                # Enabled
                $enabled = $policy.Enable
                Add-Setting -Category 'Safe Attachments' `
                    -Setting "Policy Enabled ($policyLabel)" `
                    -CurrentValue "$enabled" -RecommendedValue 'True' `
                    -Status $(if ($enabled) { 'Pass' } else { 'Warning' }) `
                    -CheckId 'DEFENDER-SAFEATTACH-001' `
                    -Remediation 'Run: Set-SafeAttachmentPolicy -Identity <PolicyName> -Enable $true. Security admin center > Safe Attachments policy > Enable the policy.'

                # Action type
                $action = $policy.Action
                $actionDisplay = switch ($action) {
                    'Allow'            { 'Allow (no scanning)' }
                    'Block'            { 'Block' }
                    'Replace'          { 'Replace attachment' }
                    'DynamicDelivery'  { 'Dynamic Delivery' }
                    default { $action }
                }

                $actionStatus = switch ($action) {
                    'Allow'           { 'Fail' }
                    'Block'           { 'Pass' }
                    'Replace'         { 'Pass' }
                    'DynamicDelivery' { 'Pass' }
                    default { 'Review' }
                }

                Add-Setting -Category 'Safe Attachments' `
                    -Setting "Action ($policyLabel)" `
                    -CurrentValue $actionDisplay `
                    -RecommendedValue 'Block or Dynamic Delivery' `
                    -Status $actionStatus `
                    -CheckId 'DEFENDER-SAFEATTACH-001' `
                    -Remediation 'Run: Set-SafeAttachmentPolicy -Identity <PolicyName> -Action Block. Security admin center > Safe Attachments policy > Action > Block (or DynamicDelivery for user experience).'

                # Redirect
                $redirect = $policy.Redirect
                Add-Setting -Category 'Safe Attachments' `
                    -Setting "Redirect to Admin ($policyLabel)" `
                    -CurrentValue "$redirect" -RecommendedValue 'True' `
                    -Status $(if ($redirect) { 'Pass' } else { 'Warning' }) `
                    -CheckId 'DEFENDER-SAFEATTACH-001' `
                    -Remediation 'Run: Set-SafeAttachmentPolicy -Identity <PolicyName> -Redirect $true -RedirectAddress admin@domain.com. Security admin center > Safe Attachments policy > Enable redirect and specify an admin email.'
            }
        }
    }
    else {
        Add-Setting -Category 'Safe Attachments' -Setting 'Safe Attachments Availability' `
            -CurrentValue 'Not licensed' -RecommendedValue 'Defender for Office 365 P1+' `
            -Status 'Review' `
            -CheckId 'DEFENDER-SAFEATTACH-001' `
            -Remediation 'Safe Attachments requires Defender for Office 365 Plan 1 or higher.'
    }
}
catch {
    Write-Warning "Could not retrieve Safe Attachments policies: $_"
}

# ------------------------------------------------------------------
# 5b. Safe Attachments for SPO/OneDrive/Teams (CIS 2.1.5)
# ------------------------------------------------------------------
try {
    $atpO365Available = Get-Command -Name Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
    if ($atpO365Available) {
        Write-Verbose "Checking Safe Attachments for SPO/OneDrive/Teams..."
        $atpPolicy = Get-AtpPolicyForO365 -ErrorAction Stop

        $atpEnabled = $atpPolicy.EnableATPForSPOTeamsODB
        Add-Setting -Category 'Safe Attachments' `
            -Setting 'Safe Attachments for SPO/OneDrive/Teams' `
            -CurrentValue "$atpEnabled" -RecommendedValue 'True' `
            -Status $(if ($atpEnabled) { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-SAFEATTACH-002' `
            -Remediation 'Run: Set-AtpPolicyForO365 -EnableATPForSPOTeamsODB $true. Security admin center > Safe Attachments > Global settings > Turn on Defender for Office 365 for SharePoint, OneDrive, and Microsoft Teams.'
    }
    else {
        Add-Setting -Category 'Safe Attachments' `
            -Setting 'Safe Attachments for SPO/OneDrive/Teams' `
            -CurrentValue 'Not licensed' -RecommendedValue 'Defender for Office 365 P1+' `
            -Status 'Review' `
            -CheckId 'DEFENDER-SAFEATTACH-002' `
            -Remediation 'Safe Attachments for SPO/OneDrive/Teams requires Defender for Office 365 Plan 1 or higher.'
    }
}
catch {
    Write-Warning "Could not check Safe Attachments for SPO/OneDrive/Teams: $_"
}

# ------------------------------------------------------------------
# 6. Outbound Spam Policy
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking outbound spam policies..."
    $outboundPolicies = Get-HostedOutboundSpamFilterPolicy -ErrorAction Stop

    foreach ($policy in @($outboundPolicies)) {
        $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }

        # Auto-forwarding mode
        $autoForward = $policy.AutoForwardingMode
        Add-Setting -Category 'Outbound Spam' `
            -Setting "Auto-Forwarding Mode ($policyLabel)" `
            -CurrentValue "$autoForward" -RecommendedValue 'Off' `
            -Status $(if ($autoForward -eq 'Off') { 'Pass' } else { 'Warning' }) `
            -CheckId 'EXO-FORWARD-001' `
            -Remediation 'Run: Set-HostedOutboundSpamFilterPolicy -Identity <PolicyName> -AutoForwardingMode Off. Security admin center > Anti-spam > Outbound policy > Auto-forwarding rules > Off.'

        # Notification
        if ($null -ne $policy.BccSuspiciousOutboundMail) {
            $bccNotify = $policy.BccSuspiciousOutboundMail
            Add-Setting -Category 'Outbound Spam' `
                -Setting "BCC on Suspicious Outbound ($policyLabel)" `
                -CurrentValue "$bccNotify" -RecommendedValue 'True' `
                -Status $(if ($bccNotify) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-OUTBOUND-001' `
                -Remediation 'Run: Set-HostedOutboundSpamFilterPolicy -Identity <PolicyName> -BccSuspiciousOutboundMail $true -BccSuspiciousOutboundAdditionalRecipients admin@domain.com. Security admin center > Anti-spam > Outbound policy > Notifications > BCC suspicious outbound messages.'
        }

        if ($null -ne $policy.NotifyOutboundSpam) {
            $notifySpam = $policy.NotifyOutboundSpam
            Add-Setting -Category 'Outbound Spam' `
                -Setting "Notify Admins of Outbound Spam ($policyLabel)" `
                -CurrentValue "$notifySpam" -RecommendedValue 'True' `
                -Status $(if ($notifySpam) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-OUTBOUND-001' `
                -Remediation 'Run: Set-HostedOutboundSpamFilterPolicy -Identity <PolicyName> -NotifyOutboundSpam $true -NotifyOutboundSpamRecipients admin@domain.com. Security admin center > Anti-spam > Outbound policy > Notifications > Notify admin of outbound spam.'
        }

        # Only assess default policy in detail
        if (-not $policy.IsDefault) { continue }
    }
}
catch {
    Write-Warning "Could not retrieve outbound spam policies: $_"
}

# ------------------------------------------------------------------
# 7. Comprehensive Attachment Filter (CIS 2.1.11)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking comprehensive attachment filter file types..."
    # Reuse $malwarePolicies from section 3 if available
    if ($malwarePolicies) {
        $defaultMalware = $malwarePolicies | Where-Object { $_.IsDefault }
        if ($defaultMalware) {
            $fileTypes = @($defaultMalware.FileTypes)
            # CIS 2.1.11 L2 requires comprehensive coverage of dangerous extensions
            $requiredTypes = @('ace','ani','apk','app','cab','cmd','com','deb','dmg','exe',
                'hta','img','iso','jar','js','jse','lnk','msi','pif','ps1','reg','rgs',
                'scr','sct','vb','vbe','vbs','vhd','vxd','wsc','wsf','wsh')
            $missing = @($requiredTypes | Where-Object { $fileTypes -notcontains $_ })

            if ($fileTypes.Count -ge 30 -and $missing.Count -eq 0) {
                Add-Setting -Category 'Anti-Malware' `
                    -Setting 'Comprehensive Attachment Filter (Default)' `
                    -CurrentValue "$($fileTypes.Count) file types blocked" `
                    -RecommendedValue '30+ dangerous types blocked' `
                    -Status 'Pass' `
                    -CheckId 'DEFENDER-MALWARE-002' `
                    -Remediation 'No action needed.'
            }
            else {
                $missingStr = if ($missing.Count -gt 0) { " Missing: $($missing -join ', ')" } else { '' }
                Add-Setting -Category 'Anti-Malware' `
                    -Setting 'Comprehensive Attachment Filter (Default)' `
                    -CurrentValue "$($fileTypes.Count) types blocked.$missingStr" `
                    -RecommendedValue '30+ dangerous types blocked' `
                    -Status 'Fail' `
                    -CheckId 'DEFENDER-MALWARE-002' `
                    -Remediation "Add missing file types via: Set-MalwareFilterPolicy -Identity Default -FileTypes @{Add='ext1','ext2'}. Security admin center > Anti-malware > Default policy > Common attachments filter > Customize file types."
            }
        }
    }
}
catch {
    Write-Warning "Could not check comprehensive attachment filter: $_"
}

# ------------------------------------------------------------------
# 8. Anti-Spam Allowed Domains (CIS 2.1.14)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking anti-spam allowed sender domains..."
    # Reuse $antiSpamPolicies from section 2 if available
    if ($antiSpamPolicies) {
        foreach ($policy in @($antiSpamPolicies)) {
            $policyLabel = if ($policy.IsDefault) { 'Default' } else { $policy.Name }
            $allowedDomains = @($policy.AllowedSenderDomains)

            if ($allowedDomains.Count -eq 0) {
                Add-Setting -Category 'Anti-Spam' `
                    -Setting "Allowed Sender Domains ($policyLabel)" `
                    -CurrentValue '0 allowed domains' `
                    -RecommendedValue 'No allowed domains' `
                    -Status 'Pass' `
                    -CheckId 'DEFENDER-ANTISPAM-002' `
                    -Remediation 'No action needed.'
            }
            else {
                $domainList = ($allowedDomains | Select-Object -First 10) -join ', '
                $suffix = if ($allowedDomains.Count -gt 10) { " (+$($allowedDomains.Count - 10) more)" } else { '' }
                Add-Setting -Category 'Anti-Spam' `
                    -Setting "Allowed Sender Domains ($policyLabel)" `
                    -CurrentValue "$($allowedDomains.Count) domains: $domainList$suffix" `
                    -RecommendedValue 'No allowed domains' `
                    -Status 'Fail' `
                    -CheckId 'DEFENDER-ANTISPAM-002' `
                    -Remediation "Remove allowed sender domains: Set-HostedContentFilterPolicy -Identity '$policyLabel' -AllowedSenderDomains @{}. Security admin center > Anti-spam > Inbound policy > Allowed senders and domains > Remove all entries."
            }

            if (-not $policy.IsDefault) { continue }
        }
    }
}
catch {
    Write-Warning "Could not check anti-spam allowed domains: $_"
}

# ------------------------------------------------------------------
# 9. Priority Account Protection (CIS 2.4.1, 2.4.2)
# ------------------------------------------------------------------
try {
    $eopRuleAvailable = Get-Command -Name Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue
    if ($eopRuleAvailable) {
        Write-Verbose "Checking priority account protection..."
        $eopRules = Get-EOPProtectionPolicyRule -ErrorAction Stop

        # CIS 2.4.1 - Priority account protection is configured
        $strictRule = $eopRules | Where-Object { $_.Identity -match 'Strict' }
        $standardRule = $eopRules | Where-Object { $_.Identity -match 'Standard' }
        $hasPreset = ($null -ne $strictRule) -or ($null -ne $standardRule)

        Add-Setting -Category 'Priority Accounts' `
            -Setting 'Preset Security Policies Configured' `
            -CurrentValue $(if ($hasPreset) { 'Preset policies found' } else { 'No preset policies' }) `
            -RecommendedValue 'Strict or Standard preset policy configured' `
            -Status $(if ($hasPreset) { 'Pass' } else { 'Fail' }) `
            -CheckId 'DEFENDER-PRIORITY-001' `
            -Remediation 'Configure preset security policies in Security admin center > Preset security policies > Strict or Standard protection > Assign users/groups.'

        # CIS 2.4.2 - Strict preset applies to priority-tagged users
        if ($strictRule) {
            $hasSentTo = ($strictRule.SentTo.Count -gt 0) -or
                         ($strictRule.SentToMemberOf.Count -gt 0) -or
                         ($strictRule.RecipientDomainIs.Count -gt 0)
            Add-Setting -Category 'Priority Accounts' `
                -Setting 'Strict Preset Covers Priority Users' `
                -CurrentValue $(if ($hasSentTo) { 'Strict policy has targeted users/groups' } else { 'Strict policy has no targeted recipients' }) `
                -RecommendedValue 'Strict preset targets priority accounts' `
                -Status $(if ($hasSentTo) { 'Pass' } else { 'Warning' }) `
                -CheckId 'DEFENDER-PRIORITY-002' `
                -Remediation 'Assign priority account users to the Strict preset policy. Security admin center > Preset security policies > Strict protection > Manage protection settings > Add users or groups.'
        }
        else {
            Add-Setting -Category 'Priority Accounts' `
                -Setting 'Strict Preset Covers Priority Users' `
                -CurrentValue 'No strict preset policy found' `
                -RecommendedValue 'Strict preset targets priority accounts' `
                -Status 'Fail' `
                -CheckId 'DEFENDER-PRIORITY-002' `
                -Remediation 'Enable the Strict preset security policy and assign priority accounts. Security admin center > Preset security policies > Strict protection.'
        }
    }
    else {
        Add-Setting -Category 'Priority Accounts' `
            -Setting 'Preset Security Policies Configured' `
            -CurrentValue 'Get-EOPProtectionPolicyRule not available' `
            -RecommendedValue 'Strict or Standard preset policy' `
            -Status 'Review' `
            -CheckId 'DEFENDER-PRIORITY-001' `
            -Remediation 'Connect to Exchange Online PowerShell to check preset security policy rules.'
        Add-Setting -Category 'Priority Accounts' `
            -Setting 'Strict Preset Covers Priority Users' `
            -CurrentValue 'Get-EOPProtectionPolicyRule not available' `
            -RecommendedValue 'Strict preset targets priority accounts' `
            -Status 'Review' `
            -CheckId 'DEFENDER-PRIORITY-002' `
            -Remediation 'Connect to Exchange Online PowerShell to check preset security policy rules.'
    }
}
catch {
    Write-Warning "Could not check priority account protection: $_"
}

# ------------------------------------------------------------------
# 10. ZAP for Teams (CIS 2.4.4)
# ------------------------------------------------------------------
try {
    # ZAP for Teams is a newer capability; check via Get-AtpPolicyForO365
    $atpO365AvailableZap = Get-Command -Name Get-AtpPolicyForO365 -ErrorAction SilentlyContinue
    if ($atpO365AvailableZap) {
        $atpPolicyZap = Get-AtpPolicyForO365 -ErrorAction Stop
        if ($null -ne $atpPolicyZap.ZapEnabled) {
            Add-Setting -Category 'Zero-Hour Auto Purge' `
                -Setting 'ZAP for Teams' `
                -CurrentValue "$($atpPolicyZap.ZapEnabled)" `
                -RecommendedValue 'True' `
                -Status $(if ($atpPolicyZap.ZapEnabled) { 'Pass' } else { 'Fail' }) `
                -CheckId 'DEFENDER-ZAP-001' `
                -Remediation 'Enable ZAP for Teams in Security admin center > Settings > Zero-hour auto purge > Teams.'
        }
        else {
            Add-Setting -Category 'Zero-Hour Auto Purge' `
                -Setting 'ZAP for Teams' `
                -CurrentValue 'Property not available on current license' `
                -RecommendedValue 'Defender for Office 365 with Teams ZAP' `
                -Status 'Review' `
                -CheckId 'DEFENDER-ZAP-001' `
                -Remediation 'ZAP for Teams requires Defender for Office 365 Plan 2. Verify license and check Security admin center > Settings > Zero-hour auto purge.'
        }
    }
    else {
        Add-Setting -Category 'Zero-Hour Auto Purge' `
            -Setting 'ZAP for Teams' `
            -CurrentValue 'Not licensed (Defender for Office 365 required)' `
            -RecommendedValue 'Defender for Office 365 with Teams ZAP' `
            -Status 'Review' `
            -CheckId 'DEFENDER-ZAP-001' `
            -Remediation 'ZAP for Teams requires Defender for Office 365. Upgrade license to enable this capability.'
    }
}
catch {
    Write-Warning "Could not check ZAP for Teams: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Defender security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Defender security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
