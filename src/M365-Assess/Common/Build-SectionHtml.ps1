<#
.SYNOPSIS
    Builds section HTML content for the assessment report.
.DESCRIPTION
    Constructs the per-section data tables, dashboards (Identity, Email, Security),
    compliance overview, framework catalogs, technical issues table, and table of
    contents. Runs in the caller's scope via dot-sourcing -- all variables from
    Export-AssessmentReport.ps1 are available directly.

    Sets: $sectionHtml, $tocHtml, $complianceHtml, $catalogHtml, $issuesHtml,
    $allCisFindings (used by the template layer).
.NOTES
    Author: Daren9m
    Extracted from Export-AssessmentReport.ps1 for maintainability (#235).
#>
# Variables set here are consumed by Get-ReportTemplate.ps1 via shared scope.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

$sectionHtml = [System.Text.StringBuilder]::new()
$tenantHtml = [System.Text.StringBuilder]::new()

$sectionDescriptions = @{
    'Tenant'        = 'Organization profile, verified domains, and core tenant configuration. This baseline identifies the environment and confirms tenant-level settings.'
    'Identity'      = 'User accounts, MFA enrollment, admin roles, conditional access policies, and password policies. Identity is the primary attack surface &mdash; these controls determine who can access your environment and how they authenticate. Compromised credentials remain the leading cause of data breaches; strong identity controls (MFA, least-privilege roles, conditional access) are the single most effective defense. See <a href="https://learn.microsoft.com/en-us/entra/fundamentals/concept-secure-remote-workers" target="_blank">Microsoft Entra identity security guidance</a>.'
    'Licensing'     = 'Microsoft 365 license allocation and utilization. Understanding license distribution helps identify unused spend and ensures users have the entitlements needed for security features like Defender and Intune.'
    'Email'         = 'Mailbox infrastructure, Exchange Online security configuration, email protection policies, mail flow, and DNS-based email authentication. Email remains the #1 attack vector &mdash; over 90% of cyberattacks begin with a phishing email, and business email compromise (BEC) accounts for billions in losses annually.'
    'Intune'        = 'Device enrollment, compliance policies, and configuration profiles. Intune controls ensure corporate devices meet security baselines and that non-compliant devices are restricted from accessing company data.'
    'Security'      = 'Microsoft Secure Score, Defender for Office 365 policies, and Data Loss Prevention rules. These controls provide defense-in-depth against malware, ransomware, and accidental data leakage. Defender policies should be configured at <em>Standard</em> or <em>Strict</em> preset levels as defined in the <a href="https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365" target="_blank">Microsoft recommended security settings</a>. DLP rules prevent sensitive data (PII, financial records, health information) from leaving the organization via email, chat, or file sharing.'
    'Collaboration' = 'SharePoint, OneDrive, and Microsoft Teams configuration and access settings. Collaboration tools are where sensitive data lives &mdash; these controls govern sharing, guest access, and external communication. Misconfigured sharing settings are a common source of data exposure; anonymous sharing links and unrestricted guest access should be reviewed carefully. See <a href="https://learn.microsoft.com/en-us/microsoft-365/solutions/setup-secure-collaboration-with-teams" target="_blank">Microsoft secure collaboration guidance</a>.'
    'Hybrid'        = 'On-premises Active Directory synchronization and hybrid identity configuration. Hybrid sync health directly impacts authentication reliability and determines which identities are managed in the cloud vs. on-premises.'
    'Inventory'     = 'Per-object inventory of mailboxes, distribution lists, Microsoft 365 groups, Teams, SharePoint sites, and OneDrive accounts. Designed for M&amp;A due diligence, migration planning, and tenant-wide asset enumeration.'
    'SOC2'          = 'SOC 2 readiness assessment covering <strong>Security</strong> and <strong>Confidentiality</strong> trust principles plus a Common Criteria (CC1–CC9) organizational readiness checklist. Evaluates M365 controls against AICPA SOC 2 requirements, collects audit log evidence, and identifies non-technical governance controls required by auditors. <em>This tool assists with SOC 2 readiness &mdash; it does not constitute a SOC 2 audit or certification.</em>'
}

$sectionCallouts = @{
    'Identity'      = @(
        @{
            Type  = 'info'
            Title = 'Why MFA Matters'
            Body  = 'Multi-factor authentication blocks 99.9% of account compromise attacks. Any account without MFA is a significant risk, especially admin accounts.'
        }
        @{
            Type  = 'warning'
            Title = 'Global Admin Count'
            Body  = 'Microsoft recommends 2-4 Global Administrators. Having too many increases the attack surface; having only 1 creates a single point of failure.'
        }
        @{
            Type  = 'tip'
            Title = 'Conditional Access vs Security Defaults'
            Body  = 'Security Defaults provide a basic level of protection for all users. Conditional Access policies offer granular control and are recommended for organizations with Microsoft Entra ID P1 or P2 licenses.'
        }
    )
    'Email'         = @(
        @{
            Type  = 'tabs'
            Title = 'Email Authentication Protocols'
            Items = @(
                @{
                    Title = 'SPF (Sender Policy Framework)'
                    Body  = 'Specifies which mail servers are authorized to send email on behalf of your domain. Without SPF, attackers can send emails that appear to come from your domain with no way for recipients to detect the forgery.'
                }
                @{
                    Title = 'DKIM (DomainKeys Identified Mail)'
                    Body  = 'Adds a cryptographic signature to outgoing messages, proving they have not been tampered with in transit. DKIM protects message integrity and is essential for DMARC alignment.'
                }
                @{
                    Title = 'DMARC (Domain-based Message Authentication)'
                    Body  = 'Ties SPF and DKIM together with a policy that tells receiving servers what to do with messages that fail authentication -- monitor (<code>p=none</code>), quarantine, or reject. DMARC at <code>p=reject</code> is the gold standard and is required by <a href="https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security" target="_blank">CISA BOD 18-01</a> for federal agencies.'
                }
                @{
                    Title = 'MTA-STS &amp; TLS-RPT'
                    Body  = '<strong>MTA-STS</strong> (RFC 8461) enforces TLS encryption for inbound email transport, preventing man-in-the-middle downgrade attacks. <strong>TLS-RPT</strong> (RFC 8460) provides daily reports on TLS delivery failures so you know when encrypted delivery is failing.'
                }
            )
            Resources = @(
                @{ Label = 'Microsoft Email Authentication'; Url = 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-about' }
                @{ Label = 'Configure DMARC'; Url = 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure' }
                @{ Label = 'MTA-STS for Exchange Online'; Url = 'https://learn.microsoft.com/en-us/purview/enhancing-mail-flow-with-mta-sts' }
                @{ Label = 'NIST SP 800-177'; Url = 'https://csrc.nist.gov/pubs/sp/800/177/r1/final' }
                @{ Label = 'CISA BOD 18-01'; Url = 'https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security' }
            )
        }
        @{
            Type  = 'warning'
            Title = 'Anti-spam Allowed Domains'
            Body  = 'Allowing entire domains to bypass spam filtering is dangerous. Attackers frequently spoof allowed domains to deliver phishing emails.'
        }
        @{
            Type  = 'tip'
            Title = 'Mailbox Delegation Auditing'
            Body  = 'Mailboxes with Send-As, Send-on-Behalf, or Full Access permissions should be reviewed regularly. Excessive delegation is a common vector for internal data exfiltration.'
        }
    )
    'Security'      = @(
        @{
            Type  = 'info'
            Title = 'Preset Security Policies'
            Body  = "Microsoft's Standard and Strict preset security policies provide a baseline for anti-phishing, anti-spam, anti-malware, Safe Links, and Safe Attachments. Using presets ensures consistent protection aligned with Microsoft recommendations."
        }
        @{
            Type  = 'warning'
            Title = 'DLP Policy Coverage'
            Body  = 'Data Loss Prevention rules prevent sensitive data (PII, financial records, health information) from leaving the organization. Organizations without DLP policies have no automated protection against accidental or malicious data leakage.'
        }
    )
    'Collaboration' = @(
        @{
            Type  = 'warning'
            Title = 'External Sharing'
            Body  = "Anonymous sharing links allow anyone with the link to access content without authentication. Review all anonymous links and consider restricting to 'Existing guests' or 'Only people in your organization'."
        }
        @{
            Type  = 'info'
            Title = 'Teams Guest Access'
            Body  = 'Guest access in Teams allows external users to participate in channels, chats, and meetings. Ensure guest access policies align with your organization data classification and compliance requirements.'
        }
    )
}

# Map callout type to HTML entity icon
$calloutIcons = @{
    'info'    = '&#9432;'
    'warning' = '&#9888;'
    'tip'     = '&#128161;'
}

foreach ($sectionName in $sections) {
    $sectionCollectors = @($summary | Where-Object { $_.Section -eq $sectionName })
    $dnsSubsectionRendered = $false

    # Reorder Email collectors for natural report flow
    if ($sectionName -eq 'Email') {
        $emailOrder = @{
            '09-Mailbox-Summary.csv'           = 0
            '11b-EXO-Security-Config.csv'      = 1
            '11-EXO-Email-Policies.csv'        = 2
            '10-Mail-Flow.csv'                 = 3
            '12-DNS-Email-Authentication.csv'  = 4
            '12b-DNS-Security-Config.csv'      = 5
        }
        $sectionCollectors = @($sectionCollectors | Sort-Object -Property @{
            Expression = { if ($emailOrder.ContainsKey($_.FileName)) { $emailOrder[$_.FileName] } else { 99 } }
        })
    }

    # ------------------------------------------------------------------
    # Tenant Info — non-collapsible organization profile card
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Tenant' -and $tenantData -and @($tenantData).Count -gt 0) {
        $t = $tenantData[0]
        $props = @($t.PSObject.Properties.Name)
        $orgName = if ($props -contains 'OrgDisplayName') { $t.OrgDisplayName } else { $TenantName }
        $defaultDomain = if ($props -contains 'DefaultDomain') { $t.DefaultDomain } else { '' }
        $secDefaults = if ($props -contains 'SecurityDefaultsEnabled') { $t.SecurityDefaultsEnabled } else { '' }
        $tenantId = if ($props -contains 'TenantId') { $t.TenantId } else { '' }
        $verifiedDomains = if ($props -contains 'VerifiedDomains') { $t.VerifiedDomains } else { '' }
        $createdRaw = if ($props -contains 'CreatedDateTime') { $t.CreatedDateTime } else { '' }

        # Format created date as "Month Year"
        $createdDisplay = $createdRaw
        if ($createdRaw) {
            try {
                $createdDt = [datetime]::Parse($createdRaw)
                $createdDisplay = $createdDt.ToString('MMMM yyyy')
            }
            catch {
                Write-Verbose "Could not parse tenant creation date: $_"
            }
        }

        # Parse all verified domains — separate custom from system domains
        $allDomains = @()
        $customDomains = @()
        $systemDomains = @()
        if ($verifiedDomains) {
            $allDomains = @($verifiedDomains -split ';\s*' | Where-Object { $_ } | Sort-Object)
            $customDomains = @($allDomains | Where-Object {
                $_ -notmatch '\.onmicrosoft\.(com|us)$' -and $_ -notmatch '\.excl\.cloud$'
            })
            $systemDomains = @($allDomains | Where-Object {
                $_ -match '\.onmicrosoft\.(com|us)$' -or $_ -match '\.excl\.cloud$'
            })
        }

        # User stats from summary CSV
        $totalUsers = ''
        $licensedUsers = ''
        if ($userSummaryData) {
            $u = $userSummaryData[0]
            $uProps = @($u.PSObject.Properties.Name)
            $totalUsers = if ($uProps -contains 'TotalUsers') { $u.TotalUsers } else { '' }
            $licensedUsers = if ($uProps -contains 'Licensed') { $u.Licensed } else { '' }
        }

        $null = $tenantHtml.AppendLine("<div class='tenant-card' id='section-tenant'>")
        $null = $tenantHtml.AppendLine("<h2 class='tenant-heading'>Organization Profile</h2>")
        $null = $tenantHtml.AppendLine("<div class='tenant-org-name'>$(ConvertTo-HtmlSafe -Text $orgName)</div>")

        # Primary facts row
        $null = $tenantHtml.AppendLine("<div class='tenant-facts'>")
        if ($defaultDomain) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Primary Domain</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $defaultDomain)</span></div>")
        }
        $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Cloud</span><span class='cloud-badge cloud-$(ConvertTo-HtmlSafe -Text $cloudEnvironment)'>$(ConvertTo-HtmlSafe -Text $cloudDisplayName)</span></div>")
        if ($createdDisplay) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Established</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $createdDisplay)</span></div>")
        }
        if ($secDefaults) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Security Defaults</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $secDefaults)</span></div>")
        }
        $null = $tenantHtml.AppendLine("</div>")

        # Secondary facts row — Tenant ID + User counts
        $null = $tenantHtml.AppendLine("<div class='tenant-facts tenant-facts-secondary'>")
        if ($tenantId) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Tenant ID</span><span class='fact-value tenant-id-val'>$(ConvertTo-HtmlSafe -Text $tenantId)</span></div>")
        }
        if ($totalUsers) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Total Users</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $totalUsers)</span></div>")
        }
        if ($licensedUsers) {
            $null = $tenantHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Licensed Users</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $licensedUsers)</span></div>")
        }
        $null = $tenantHtml.AppendLine("</div>")

        # Verified Domains — show all with custom domains prominent, system domains dimmed
        if ($allDomains.Count -gt 0) {
            $null = $tenantHtml.AppendLine("<div class='tenant-domains'>")
            $null = $tenantHtml.AppendLine("<span class='fact-label'>Verified Domains ($($allDomains.Count))</span>")
            $null = $tenantHtml.AppendLine("<div class='domain-list'>")
            foreach ($d in $customDomains) {
                $null = $tenantHtml.AppendLine("<span class='domain-tag'>$(ConvertTo-HtmlSafe -Text $d)</span>")
            }
            foreach ($d in $systemDomains) {
                $null = $tenantHtml.AppendLine("<span class='domain-tag domain-system'>$(ConvertTo-HtmlSafe -Text $d)</span>")
            }
            $null = $tenantHtml.AppendLine("</div>")
            $null = $tenantHtml.AppendLine("</div>")
        }

        # Assessment metadata bar
        $null = $tenantHtml.AppendLine("<div class='tenant-meta'>")
        $null = $tenantHtml.AppendLine("<span>Assessment Date: $assessmentDate</span>")
        $null = $tenantHtml.AppendLine("<span>Scope: $($sections.Count) Sections &middot; $totalCollectors Configuration Areas</span>")
        $null = $tenantHtml.AppendLine("<span>Generated by M365 Assess</span>")
        $null = $tenantHtml.AppendLine("</div>")
        $null = $tenantHtml.AppendLine("</div>")

        continue
    }

    $sectionId = ($sectionName -replace '[^a-zA-Z0-9]', '-').ToLower()
    $null = $sectionHtml.AppendLine("<div class='report-page' data-page='section-$sectionId'>")
    $null = $sectionHtml.AppendLine("<details class='section' id='section-$sectionId' open>")
    $null = $sectionHtml.AppendLine("<summary><h2>$([System.Web.HttpUtility]::HtmlEncode($sectionName))</h2></summary>")

    # Expand/Collapse All buttons inline with section heading
    $null = $sectionHtml.AppendLine("<div class='section-toolbar'><button type='button' class='expand-all-btn section-ctrl-btn'>&#9660; Expand All</button><button type='button' class='collapse-all-btn section-ctrl-btn'>&#9650; Collapse All</button></div>")

    # Collector status — compact chip grid (directly under heading for visibility)
    $null = $sectionHtml.AppendLine("<div class='collector-grid'>")
    foreach ($c in $sectionCollectors) {
        $statusClass = switch ($c.Status) {
            'Complete' { 'chip-complete' }
            'Skipped'  { 'chip-skipped' }
            'Failed'   { 'chip-failed' }
            default    { '' }
        }
        $notes = if ($c.Error) { ConvertTo-HtmlSafe -Text $c.Error } else { '' }
        $notesHtml = if ($notes) { "<span class='chip-note' title='$notes' onclick='this.classList.toggle(""expanded"")'>$notes</span>" } else { '' }
        $null = $sectionHtml.AppendLine("<div class='collector-chip $statusClass'>")
        $null = $sectionHtml.AppendLine("<span class='chip-dot'></span>")
        $null = $sectionHtml.AppendLine("<span class='chip-name'>$(ConvertTo-HtmlSafe -Text $c.Collector)</span>")
        $null = $sectionHtml.AppendLine("<span class='chip-count'>$($c.Items)</span>")
        $null = $sectionHtml.AppendLine($notesHtml)
        $null = $sectionHtml.AppendLine("</div>")
    }
    $null = $sectionHtml.AppendLine("</div>")

    # Section description
    $sectionDesc = $sectionDescriptions[$sectionName]
    if ($sectionDesc) {
        $null = $sectionHtml.AppendLine("<p class='section-description'>$sectionDesc</p>")
    }

    # Callouts — collapsed by default to keep data tables visible
    $callouts = $sectionCallouts[$sectionName]
    if ($callouts) {
        $null = $sectionHtml.AppendLine("<details class='callout-wrapper'><summary class='callout-toggle'>Learn More</summary>")
        $null = $sectionHtml.AppendLine("<div class='callout-row'>")
        foreach ($callout in $callouts) {
            if ($callout.Type -eq 'tabs') {
                $tabGroupId = "tabs-$(($callout.Title -replace '[^a-zA-Z0-9]', '-').ToLower())"
                $null = $sectionHtml.AppendLine("<div class='callout-tabs' id='$tabGroupId'>")
                $null = $sectionHtml.AppendLine("<div class='callout-tabs-title'>$($callout.Title)</div>")
                $null = $sectionHtml.AppendLine("<div class='tab-header' role='tablist'>")
                for ($i = 0; $i -lt $callout.Items.Count; $i++) {
                    $tabItem = $callout.Items[$i]
                    $tabId = "$tabGroupId-tab-$i"
                    $panelId = "$tabGroupId-panel-$i"
                    $activeClass = if ($i -eq 0) { ' active' } else { '' }
                    $ariaSelected = if ($i -eq 0) { 'true' } else { 'false' }
                    $null = $sectionHtml.AppendLine("<button class='tab-btn$activeClass' role='tab' id='$tabId' aria-selected='$ariaSelected' aria-controls='$panelId'>$($tabItem.Title)</button>")
                }
                $null = $sectionHtml.AppendLine("</div>")
                for ($i = 0; $i -lt $callout.Items.Count; $i++) {
                    $tabItem = $callout.Items[$i]
                    $tabId = "$tabGroupId-tab-$i"
                    $panelId = "$tabGroupId-panel-$i"
                    $activeClass = if ($i -eq 0) { ' active' } else { '' }
                    $null = $sectionHtml.AppendLine("<div class='tab-panel$activeClass' id='$panelId' role='tabpanel' aria-labelledby='$tabId'>$($tabItem.Body)</div>")
                }
                if ($callout.Resources) {
                    $links = ($callout.Resources | ForEach-Object { "<a href='$($_.Url)' target='_blank'>$($_.Label)</a>" }) -join ' &middot; '
                    $null = $sectionHtml.AppendLine("<div class='tab-resources'><strong>Resources:</strong> $links</div>")
                }
                $null = $sectionHtml.AppendLine("</div>")
            }
            elseif ($callout.Type -eq 'accordion') {
                $null = $sectionHtml.AppendLine("<details class='callout-accordion'>")
                $null = $sectionHtml.AppendLine("<summary class='callout-accordion-title'>$($callout.Title)</summary>")
                foreach ($item in $callout.Items) {
                    $null = $sectionHtml.AppendLine("<details class='accordion-item'>")
                    $null = $sectionHtml.AppendLine("<summary class='accordion-item-title'>$($item.Title)</summary>")
                    $null = $sectionHtml.AppendLine("<div class='accordion-item-body'>$($item.Body)</div>")
                    $null = $sectionHtml.AppendLine("</details>")
                }
                if ($callout.Resources) {
                    $links = ($callout.Resources | ForEach-Object { "<a href='$($_.Url)' target='_blank'>$($_.Label)</a>" }) -join ' &middot; '
                    $null = $sectionHtml.AppendLine("<div class='accordion-resources'><strong>Resources:</strong> $links</div>")
                }
                $null = $sectionHtml.AppendLine("</details>")
            }
            else {
                $calloutType = $callout.Type
                $calloutTitle = $callout.Title
                $calloutBody = $callout.Body
                $icon = $calloutIcons[$calloutType]
                if (-not $icon) { $icon = '&#9432;' }
                $null = $sectionHtml.AppendLine("<div class='callout callout-$calloutType'>")
                $null = $sectionHtml.AppendLine("<div class='callout-title'><span class='callout-icon'>$icon</span> $calloutTitle</div>")
                $null = $sectionHtml.AppendLine("<div class='callout-body'>$calloutBody</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }
        }
        $null = $sectionHtml.AppendLine("</div>")
        $null = $sectionHtml.AppendLine("</details>")
    }

    # ------------------------------------------------------------------
    # Identity Dashboard — combined overview panel
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Identity') {
        $userCsvPath  = Join-Path -Path $AssessmentFolder -ChildPath '02-User-Summary.csv'
        $mfaCsvPath   = Join-Path -Path $AssessmentFolder -ChildPath '03-MFA-Report.csv'
        $entraCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '07b-Entra-Security-Config.csv'

        $userData  = if (Test-Path $userCsvPath)  { @(Import-Csv $userCsvPath)  } else { @() }
        $mfaRawData = if (Test-Path $mfaCsvPath)   { @(Import-Csv $mfaCsvPath)   } else { @() }
        $entraData = if (Test-Path $entraCsvPath) { @(Import-Csv $entraCsvPath) } else { @() }

        $hasUsers = $userData.Count -gt 0

        if ($hasUsers) {
            $users = $userData[0]
            $uProps = @($users.PSObject.Properties.Name)
            $totalUsers    = if ($uProps -contains 'TotalUsers')       { [int]$users.TotalUsers }       else { 0 }
            $licensedUsers = if ($uProps -contains 'Licensed')         { [int]$users.Licensed }         else { 0 }
            $guestUsers    = if ($uProps -contains 'GuestUsers')       { [int]$users.GuestUsers }       else { 0 }
            $disabledUsers = if ($uProps -contains 'DisabledUsers')    { [int]$users.DisabledUsers }    else { 0 }
            $syncedUsers   = if ($uProps -contains 'SyncedFromOnPrem') { [int]$users.SyncedFromOnPrem } else { 0 }
            $cloudOnly     = if ($uProps -contains 'CloudOnly')        { [int]$users.CloudOnly }        else { 0 }
            $withMfa       = if ($uProps -contains 'WithMFA')          { [int]$users.WithMFA }          else { 0 }

            # MFA / SSPR breakdown from per-user report
            $mfaTotal = $mfaRawData.Count
            $mfaRegistered = 0; $mfaNotRegistered = 0
            $ssprRegistered = 0; $ssprNotRegistered = 0
            $adminCount = 0; $adminNoMfa = 0
            $guestMfa = [Math]::Max(0, $withMfa - 0)  # will be refined below
            if ($mfaRawData.Count -gt 0) {
                $mfaRegistered    = @($mfaRawData | Where-Object { $_.IsMfaRegistered -eq 'True' }).Count
                $mfaNotRegistered = $mfaTotal - $mfaRegistered
                $ssprRegistered   = @($mfaRawData | Where-Object { $_.IsSsprRegistered -eq 'True' }).Count
                $ssprNotRegistered = $mfaTotal - $ssprRegistered
                $adminCount       = @($mfaRawData | Where-Object { $_.IsAdmin -eq 'True' }).Count
                $adminNoMfa       = @($mfaRawData | Where-Object { $_.IsAdmin -eq 'True' -and $_.IsMfaRegistered -ne 'True' }).Count
                $guestMfa         = [Math]::Max(0, $withMfa - $mfaRegistered)
            }
            $disabledClass = if ($disabledUsers -gt 0) { 'danger' } else { 'success' }
            $adminNoMfaClass = if ($adminNoMfa -gt 0) { 'danger' } else { 'success' }
            $ssprNotRegClass = if ($ssprNotRegistered -gt 0) { 'warning' } else { 'success' }

            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")

            # --- Top row: 3-column layout ---
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # Left column: User Summary
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>User Summary</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")
            $userMetrics = @(
                @{ Icon = '&#128101;'; Value = $totalUsers;    Label = 'Total Users';    Css = '' }
                @{ Icon = '&#127915;'; Value = $licensedUsers; Label = 'Licensed';       Css = '' }
                @{ Icon = '&#128587;'; Value = $guestUsers;    Label = 'Guests';         Css = '' }
                @{ Icon = '&#128119;'; Value = $adminCount;    Label = 'Admins';         Css = '' }
                @{ Icon = '&#128683;'; Value = $disabledUsers; Label = 'Disabled';       Css = $disabledClass }
                @{ Icon = '&#128260;'; Value = $syncedUsers;   Label = 'Synced On-Prem'; Css = '' }
                @{ Icon = '&#9729;';   Value = $cloudOnly;     Label = 'Cloud Only';     Css = '' }
            )
            foreach ($m in $userMetrics) {
                $cssExtra = if ($m.Css) { " id-metric-$($m.Css)" } else { '' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card$cssExtra'><div class='email-metric-icon'>$($m.Icon)</div><div class='email-metric-body'><div class='email-metric-value'>$($m.Value)</div><div class='email-metric-label'>$(ConvertTo-HtmlSafe -Text $m.Label)</div></div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # Middle column: MFA & SSPR Breakdown (metric cards, no donuts)
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Authentication</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")
            $mfaCapable = @($mfaRawData | Where-Object { $_.IsMfaCapable -eq 'True' }).Count
            $mfaNotCapable = $mfaTotal - $mfaCapable
            $mfaNotCapableClass = if ($mfaNotCapable -gt 0) { 'warning' } else { '' }
            $mfaCapableNotEnrolled = $mfaNotRegistered - $mfaNotCapable
            $mfaNotRegClass = if ($mfaCapableNotEnrolled -le 0) { 'success' } elseif ($mfaCapableNotEnrolled -le 5) { 'warning' } else { 'danger' }
            $ssprCapable = @($mfaRawData | Where-Object { $_.IsSsprCapable -eq 'True' }).Count
            $ssprNotCapable = $mfaTotal - $ssprCapable
            $guestNoMfa = [Math]::Max(0, $guestUsers - $guestMfa)
            $guestNoMfaClass = if ($guestNoMfa -gt 0) { 'warning' } else { 'success' }
            $authMetrics = @(
                @{ Icon = '&#128272;'; Value = "$mfaRegistered / $mfaCapable";   Label = 'MFA Enrolled';    Css = 'success' }
                @{ Icon = '&#128275;'; Value = "$mfaNotRegistered / $mfaNotCapable"; Label = 'Not Enrolled / Not Capable'; Css = $mfaNotRegClass }
                @{ Icon = '&#128274;'; Value = "$guestMfa / $guestUsers";        Label = 'Guests w/ MFA';   Css = '' }
                @{ Icon = '&#128119;'; Value = "$($adminCount - $adminNoMfa) / $adminCount"; Label = 'Admins w/ MFA'; Css = $adminNoMfaClass }
                @{ Icon = '&#128273;'; Value = "$ssprRegistered / $ssprCapable"; Label = 'SSPR Enrolled';   Css = 'success' }
            )
            foreach ($m in $authMetrics) {
                $cssExtra = if ($m.Css) { " id-metric-$($m.Css)" } else { '' }
                $sublabelHtml = if ($m.Sublabel) { "<div class='email-metric-sublabel'>$($m.Sublabel)</div>" } else { '' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card$cssExtra'><div class='email-metric-icon'>$($m.Icon)</div><div class='email-metric-body'><div class='email-metric-value'>$($m.Value)</div><div class='email-metric-label'>$(ConvertTo-HtmlSafe -Text $m.Label)</div>$sublabelHtml</div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # Right column: Entra Security Config donut
            if ($entraData.Count -gt 0) {
                $entraPass   = @($entraData | Where-Object { $_.Status -eq 'Pass' }).Count
                $entraFail   = @($entraData | Where-Object { $_.Status -eq 'Fail' }).Count
                $entraWarn   = @($entraData | Where-Object { $_.Status -eq 'Warning' }).Count
                $entraReview = @($entraData | Where-Object { $_.Status -eq 'Review' }).Count
                $entraInfo   = @($entraData | Where-Object { $_.Status -eq 'Info' }).Count
                $entraTotal  = $entraData.Count

                $entraSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($entraPass   / $entraTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($entraFail   / $entraTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($entraWarn   / $entraTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'review';  Pct = [math]::Round(($entraReview / $entraTotal) * 100, 1); Label = 'Review' }
                )
                if ($entraInfo -gt 0) {
                    $entraSegments += @{ Css = 'info'; Pct = [math]::Round(($entraInfo / $entraTotal) * 100, 1); Label = 'Info' }
                }
                $entraOther = $entraTotal - ($entraPass + $entraFail + $entraWarn + $entraReview + $entraInfo)
                if ($entraOther -gt 0) {
                    $entraSegments += @{ Css = 'neutral'; Pct = [math]::Round(($entraOther / $entraTotal) * 100, 1); Label = 'Other' }
                }
                $entraDonut = Get-SvgMultiDonut -Segments $entraSegments -CenterLabel "$entraTotal" -Size 130 -StrokeWidth 12

                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Entra Security Config</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
                $null = $sectionHtml.AppendLine($entraDonut)
                $null = $sectionHtml.AppendLine("<div class='score-donut-label'>Entra Controls</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
                $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-success'></span> Pass</span><span class='score-detail-value success-text'>$entraPass</span></div>")
                if ($entraFail -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-danger'></span> Fail</span><span class='score-detail-value danger-text'>$entraFail</span></div>")
                }
                if ($entraWarn -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-warning'></span> Warning</span><span class='score-detail-value warning-text'>$entraWarn</span></div>")
                }
                if ($entraReview -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-review'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-review);'>$entraReview</span></div>")
                }
                if ($entraInfo -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$entraInfo</span></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$entraTotal</span></div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top
            $null = $sectionHtml.AppendLine("</div>") # end email-dashboard
        }
    }

    # ------------------------------------------------------------------
    # Email Dashboard — combined overview panel (rendered once above all
    # expandable detail tables for a cohesive visual summary)
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Email') {
        # Pre-load email CSVs
        $mbxCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '09-Mailbox-Summary.csv'
        $exoCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '11b-EXO-Security-Config.csv'
        $polCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '11-EXO-Email-Policies.csv'

        $mbxData = if (Test-Path $mbxCsvPath) { @(Import-Csv $mbxCsvPath) } else { @() }
        $exoData = if (Test-Path $exoCsvPath) { @(Import-Csv $exoCsvPath) } else { @() }
        $polData = if (Test-Path $polCsvPath) { @(Import-Csv $polCsvPath) } else { @() }

        $hasMailbox = $mbxData.Count -gt 0
        $hasExo = $exoData.Count -gt 0
        $hasPolicies = $polData.Count -gt 0

        # Also pre-load DNS Authentication data
        $dnsCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '12-DNS-Email-Authentication.csv'
        $dnsData = if (Test-Path $dnsCsvPath) { @(Import-Csv $dnsCsvPath | Where-Object { $_.Domain -notmatch '\.onmicrosoft\.com$' }) } else { @() }
        $hasDns = $dnsData.Count -gt 0

        if ($hasMailbox -or $hasExo -or $hasPolicies -or $hasDns) {
            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")

            # --- Top row: 3-column layout ---
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # --- Left column: Mailbox metrics ---
            if ($hasMailbox) {
                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Mailbox Summary</div>")
                $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")
                $iconMap = @{
                    'TotalMailboxes'     = '&#128231;'
                    'UserMailboxes'      = '&#128100;'
                    'SharedMailboxes'    = '&#128101;'
                    'RoomMailboxes'      = '&#127970;'
                    'EquipmentMailboxes' = '&#128295;'
                }
                foreach ($row in $mbxData) {
                    if ($row.Count -eq 'N/A') { continue }
                    $metricKey = ($row.Metric -replace '\s', '')
                    $icon = if ($iconMap.ContainsKey($metricKey)) { $iconMap[$metricKey] } else { '&#128232;' }
                    $metricLabel = Format-ColumnHeader -Name $row.Metric
                    $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>$icon</div><div class='email-metric-body'><div class='email-metric-value'>$($row.Count)</div><div class='email-metric-label'>$(ConvertTo-HtmlSafe -Text $metricLabel)</div></div></div>")
                }
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            # --- Middle column: EXO Security Config donut ---
            if ($hasExo) {
                $exoPass   = @($exoData | Where-Object { $_.Status -eq 'Pass' }).Count
                $exoFail   = @($exoData | Where-Object { $_.Status -eq 'Fail' }).Count
                $exoWarn   = @($exoData | Where-Object { $_.Status -eq 'Warning' }).Count
                $exoReview = @($exoData | Where-Object { $_.Status -eq 'Review' }).Count
                $exoInfo   = @($exoData | Where-Object { $_.Status -eq 'Info' }).Count
                $exoTotal  = $exoData.Count

                if ($exoTotal -gt 0) {
                    $exoSegments = @(
                        @{ Css = 'success'; Pct = [math]::Round(($exoPass   / $exoTotal) * 100, 1); Label = 'Pass' }
                        @{ Css = 'danger';  Pct = [math]::Round(($exoFail   / $exoTotal) * 100, 1); Label = 'Fail' }
                        @{ Css = 'warning'; Pct = [math]::Round(($exoWarn   / $exoTotal) * 100, 1); Label = 'Warning' }
                        @{ Css = 'review';  Pct = [math]::Round(($exoReview / $exoTotal) * 100, 1); Label = 'Review' }
                    )
                    if ($exoInfo -gt 0) {
                        $exoSegments += @{ Css = 'info'; Pct = [math]::Round(($exoInfo / $exoTotal) * 100, 1); Label = 'Info' }
                    }
                    $exoOther = $exoTotal - ($exoPass + $exoFail + $exoWarn + $exoReview + $exoInfo)
                    if ($exoOther -gt 0) {
                        $exoSegments += @{ Css = 'neutral'; Pct = [math]::Round(($exoOther / $exoTotal) * 100, 1); Label = 'Other' }
                    }
                    $exoDonut = Get-SvgMultiDonut -Segments $exoSegments -CenterLabel "$exoTotal" -Size 130 -StrokeWidth 12

                    $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                    $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>EXO Security Config <span class='source-badge source-exo'>Exch Online</span></div>")
                    $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
                    $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
                    $null = $sectionHtml.AppendLine($exoDonut)
                    $null = $sectionHtml.AppendLine("<div class='score-donut-label'>EXO Controls</div>")
                    $null = $sectionHtml.AppendLine("</div>")
                    $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-success'></span> Pass</span><span class='score-detail-value success-text'>$exoPass</span></div>")
                    if ($exoFail -gt 0) {
                        $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-danger'></span> Fail</span><span class='score-detail-value danger-text'>$exoFail</span></div>")
                    }
                    if ($exoWarn -gt 0) {
                        $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-warning'></span> Warning</span><span class='score-detail-value warning-text'>$exoWarn</span></div>")
                    }
                    if ($exoReview -gt 0) {
                        $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-review'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-review);'>$exoReview</span></div>")
                    }
                    if ($exoInfo -gt 0) {
                        $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$exoInfo</span></div>")
                    }
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$exoTotal</span></div>")
                    $null = $sectionHtml.AppendLine("</div>")
                    $null = $sectionHtml.AppendLine("</div>")
                    $null = $sectionHtml.AppendLine("</div>")
                }
            }

            # --- Right column: DNS Authentication protocols (fixed set) ---
            if ($hasDns) {
                $totalDomains = $dnsData.Count
                $dnsColumns = @($dnsData[0].PSObject.Properties.Name)

                $spfConfigured = @($dnsData | Where-Object { $_.SPF -and $_.SPF -ne 'Not configured' -and $_.SPF -ne 'DNS lookup failed' }).Count
                $spfClass = if ($spfConfigured -eq $totalDomains) { 'success' } else { 'danger' }

                $dmarcConfigured = @($dnsData | Where-Object { $_.DMARC -and $_.DMARC -ne 'Not configured' }).Count
                $dmarcEnforced = 0
                $dmarcMonitoring = 0
                if ($dnsColumns -contains 'DMARCPolicy') {
                    $dmarcEnforced = @($dnsData | Where-Object { $_.DMARCPolicy -match '^(reject|quarantine)' }).Count
                    $dmarcMonitoring = @($dnsData | Where-Object { $_.DMARCPolicy -match '^none' }).Count
                }
                $dmarcClass = if ($dmarcEnforced -eq $totalDomains) { 'success' } elseif ($dmarcConfigured -gt 0) { 'warning' } else { 'danger' }

                $dkimKey = if ($dnsColumns -contains 'DKIMSelector1') { 'DKIMSelector1' } else { 'DKIMSelector' }
                $dkimConfigured = @($dnsData | Where-Object { $_.$dkimKey -and $_.$dkimKey -ne 'Not configured' }).Count
                $dkimClass = if ($dkimConfigured -eq $totalDomains) { 'success' } elseif ($dkimConfigured -gt 0) { 'warning' } else { 'danger' }

                $mtaStsConfigured = 0
                if ($dnsColumns -contains 'MTASTS') {
                    $mtaStsConfigured = @($dnsData | Where-Object { $_.MTASTS -and $_.MTASTS -ne 'Not configured' }).Count
                }
                $mtaStsClass = if ($mtaStsConfigured -eq $totalDomains) { 'success' } elseif ($mtaStsConfigured -gt 0) { 'warning' } else { 'danger' }

                $tlsRptConfigured = 0
                if ($dnsColumns -contains 'TLSRPT') {
                    $tlsRptConfigured = @($dnsData | Where-Object { $_.TLSRPT -and $_.TLSRPT -ne 'Not configured' }).Count
                }
                $tlsRptClass = if ($tlsRptConfigured -eq $totalDomains) { 'success' } elseif ($tlsRptConfigured -gt 0) { 'warning' } else { 'danger' }

                $publicConfirmed = 0
                if ($dnsColumns -contains 'PublicDNSConfirm') {
                    $publicConfirmed = @($dnsData | Where-Object { $_.PublicDNSConfirm -match '^Confirmed' }).Count
                }
                $publicClass = if ($publicConfirmed -eq $totalDomains) { 'success' } elseif ($publicConfirmed -gt 0) { 'warning' } else { 'danger' }

                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Email Authentication <span class='source-badge source-dns'>Live DNS Check</span></div>")

                # DNS stat cards — compact 2-column grid for column context
                $null = $sectionHtml.AppendLine("<div class='dns-stats-col'>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $spfClass'><div class='dns-stat-value'>$spfConfigured / $totalDomains</div><div class='dns-stat-label'>SPF</div></div>")
                $dmarcDetail = if ($dmarcMonitoring -gt 0) { "<div class='dns-stat-detail'>$dmarcMonitoring monitoring</div>" } else { '' }
                $null = $sectionHtml.AppendLine("<div class='dns-stat $dmarcClass'><div class='dns-stat-value'>$dmarcEnforced / $totalDomains</div><div class='dns-stat-label'>DMARC Enforced</div>$dmarcDetail</div>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $dkimClass'><div class='dns-stat-value'>$dkimConfigured / $totalDomains</div><div class='dns-stat-label'>DKIM</div></div>")
                $dkimMismatchCount = 0
                if ($dnsColumns -contains 'DKIMStatus') {
                    $dkimMismatchCount = @($dnsData | Where-Object { $_.DKIMStatus -match '^Mismatch' }).Count
                }
                if ($dkimMismatchCount -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='dns-stat danger'><div class='dns-stat-value'>$dkimMismatchCount</div><div class='dns-stat-label'>DKIM Mismatch</div></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='dns-stat $mtaStsClass'><div class='dns-stat-value'>$mtaStsConfigured / $totalDomains</div><div class='dns-stat-label'>MTA-STS</div></div>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $tlsRptClass'><div class='dns-stat-value'>$tlsRptConfigured / $totalDomains</div><div class='dns-stat-label'>TLS-RPT</div></div>")
                if ($dnsColumns -contains 'PublicDNSConfirm') {
                    $null = $sectionHtml.AppendLine("<div class='dns-stat $publicClass'><div class='dns-stat-value'>$publicConfirmed / $totalDomains</div><div class='dns-stat-label'>Public DNS</div></div>")
                }
                $null = $sectionHtml.AppendLine("</div>")

                $null = $sectionHtml.AppendLine("</div>") # end email-dash-col (DNS)
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top

            # --- Below: Email Policies as responsive grid ---
            if ($hasPolicies) {
                $null = $sectionHtml.AppendLine("<div class='email-dash-policies'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Email Policies <span class='source-badge source-exo'>Exch Online</span></div>")
                $null = $sectionHtml.AppendLine("<div class='policy-grid'>")
                foreach ($policy in $polData) {
                    $policyEnabled = ($policy.Enabled -eq 'True')
                    $policyClass = if ($policyEnabled) { 'policy-enabled' } else { 'policy-disabled' }
                    $statusIcon = if ($policyEnabled) { '&#x2713;' } else { '&#x2717;' }
                    $statusLabel = if ($policyEnabled) { 'Enabled' } else { 'Disabled' }
                    $policyLabel = ConvertTo-HtmlSafe -Text $policy.PolicyType
                    $policyDetail = ConvertTo-HtmlSafe -Text $policy.Name
                    $null = $sectionHtml.AppendLine("<div class='policy-card $policyClass'>")
                    $null = $sectionHtml.AppendLine("<div class='policy-status-badge'>$statusIcon</div>")
                    $null = $sectionHtml.AppendLine("<div class='policy-info'><div class='policy-name'>$policyLabel</div><div class='policy-detail'>$policyDetail</div></div>")
                    $null = $sectionHtml.AppendLine("<div class='policy-status-label'>$statusLabel</div>")
                    $null = $sectionHtml.AppendLine("</div>")
                }
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dashboard
        }
    }

    # ------------------------------------------------------------------
    # Hybrid Dashboard — sync status visual panel
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Hybrid') {
        $hybridCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '23-Hybrid-Sync.csv'
        $hybridData = if (Test-Path $hybridCsvPath) { @(Import-Csv $hybridCsvPath) } else { @() }

        if ($hybridData.Count -gt 0) {
            $h = $hybridData[0]
            $hProps = @($h.PSObject.Properties.Name)

            $syncEnabled   = if ($hProps -contains 'OnPremisesSyncEnabled')  { $h.OnPremisesSyncEnabled }  else { 'Unknown' }
            $dirSyncConfig = if ($hProps -contains 'DirSyncConfigured')     { $h.DirSyncConfigured }     else { 'Unknown' }
            $phsEnabled    = if ($hProps -contains 'PasswordHashSyncEnabled'){ $h.PasswordHashSyncEnabled} else { 'Unknown' }
            $syncType      = if ($hProps -contains 'SyncType')              { $h.SyncType }              else { 'Unknown' }
            $onPremDomain  = if ($hProps -contains 'OnPremDomainName')      { $h.OnPremDomainName }      else { 'N/A' }
            $onPremForest  = if ($hProps -contains 'OnPremForestName')      { $h.OnPremForestName }      else { 'N/A' }

            # Parse last sync times
            $lastDirSync = if ($hProps -contains 'LastDirSyncTime' -and $h.LastDirSyncTime) {
                try { ([datetime]$h.LastDirSyncTime).ToString('yyyy-MM-dd HH:mm') } catch { $h.LastDirSyncTime }
            } else { 'Never' }

            $lastPwdSync = if ($hProps -contains 'LastPasswordSyncTime' -and $h.LastPasswordSyncTime) {
                try { ([datetime]$h.LastPasswordSyncTime).ToString('yyyy-MM-dd HH:mm') } catch { $h.LastPasswordSyncTime }
            } else { 'Never' }

            # Determine sync health — if last sync > 6 hours ago, warning
            $syncHealthClass = 'success'
            $syncHealthLabel = 'Healthy'
            if ($hProps -contains 'LastDirSyncTime' -and $h.LastDirSyncTime) {
                try {
                    $syncAge = (Get-Date) - [datetime]$h.LastDirSyncTime
                    if ($syncAge.TotalHours -gt 6) { $syncHealthClass = 'warning'; $syncHealthLabel = 'Stale' }
                    if ($syncAge.TotalHours -gt 24) { $syncHealthClass = 'danger'; $syncHealthLabel = 'Critical' }
                } catch { $syncHealthClass = 'info'; $syncHealthLabel = 'Unknown' }
            } elseif ($syncEnabled -eq 'True') {
                $syncHealthClass = 'warning'; $syncHealthLabel = 'No Data'
            } else {
                $syncHealthClass = 'info'; $syncHealthLabel = 'Cloud Only'
            }

            $syncEnabledClass = if ($syncEnabled -eq 'True') { 'success' } else { 'info' }
            $dirSyncClass     = if ($dirSyncConfig -eq 'True') { 'success' } else { 'warning' }
            $phsClass         = if ($phsEnabled -eq 'True') { 'success' } else { 'warning' }

            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # Left column: Sync status metric cards
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Sync Configuration</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")

            $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$syncEnabledClass'><div class='email-metric-icon'>&#128260;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $syncEnabled)</div><div class='email-metric-label'>Directory Sync</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$dirSyncClass'><div class='email-metric-icon'>&#9881;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $dirSyncConfig)</div><div class='email-metric-label'>DirSync Configured</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$phsClass'><div class='email-metric-icon'>&#128272;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $phsEnabled)</div><div class='email-metric-label'>Password Hash Sync</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#128296;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $syncType)</div><div class='email-metric-label'>Sync Method</div></div></div>")

            $null = $sectionHtml.AppendLine("</div>") # end email-metrics-grid
            $null = $sectionHtml.AppendLine("</div>") # end email-dash-col

            # Middle column: Sync health donut + timing
            $healthPct = switch ($syncHealthClass) { 'success' { 100 }; 'warning' { 60 }; 'danger' { 25 }; default { 0 } }
            if ($syncHealthLabel -eq 'Cloud Only') { $syncHealthLabel = 'OFF' }
            $healthDonut = Get-SvgDonut -Percentage $healthPct -CssClass $syncHealthClass -Size 130 -StrokeWidth 12

            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Sync Health</div>")
            $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
            $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
            $null = $sectionHtml.AppendLine($healthDonut)
            $null = $sectionHtml.AppendLine("<div class='score-donut-label'>$syncHealthLabel</div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
            $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'>Last Directory Sync</span><span class='score-detail-value'>$(ConvertTo-HtmlSafe -Text $lastDirSync)</span></div>")
            $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'>Last Password Sync</span><span class='score-detail-value'>$(ConvertTo-HtmlSafe -Text $lastPwdSync)</span></div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # Right column: On-premises environment info
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>On-Premises Environment</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid hybrid-env-grid'>")

            $tenantName = if ($hProps -contains 'TenantDisplayName') { $h.TenantDisplayName } else { 'N/A' }
            $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127970;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $tenantName)</div><div class='email-metric-label'>Tenant</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127760;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $onPremDomain)</div><div class='email-metric-label'>AD Domain</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127795;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $onPremForest)</div><div class='email-metric-label'>AD Forest</div></div></div>")

            $null = $sectionHtml.AppendLine("</div>") # end email-metrics-grid
            $null = $sectionHtml.AppendLine("</div>") # end email-dash-col

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top
            $null = $sectionHtml.AppendLine("</div>") # end email-dashboard
        }
    }

    # ------------------------------------------------------------------
    # Collaboration Dashboard — combined overview panel
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Collaboration') {
        $spoCsvPath   = Join-Path -Path $AssessmentFolder -ChildPath '20-SharePoint-OneDrive.csv'
        $spoSecPath   = Join-Path -Path $AssessmentFolder -ChildPath '20b-SharePoint-Security-Config.csv'
        $teamAccPath  = Join-Path -Path $AssessmentFolder -ChildPath '21-Teams-Access.csv'
        $teamSecPath  = Join-Path -Path $AssessmentFolder -ChildPath '21b-Teams-Security-Config.csv'

        $spoData    = if (Test-Path $spoCsvPath)  { @(Import-Csv $spoCsvPath)  } else { @() }
        $spoSecData = if (Test-Path $spoSecPath)  { @(Import-Csv $spoSecPath)  } else { @() }
        $teamAccData= if (Test-Path $teamAccPath) { @(Import-Csv $teamAccPath) } else { @() }
        $teamSecData= if (Test-Path $teamSecPath) { @(Import-Csv $teamSecPath) } else { @() }

        $hasCollabData = ($spoData.Count -gt 0) -or ($teamAccData.Count -gt 0) -or ($spoSecData.Count -gt 0) -or ($teamSecData.Count -gt 0)

        if ($hasCollabData) {
            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # --- Left column: SharePoint & Teams settings as icon metric cards ---
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Collaboration Settings</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")

            if ($spoData.Count -gt 0) {
                $spo = $spoData[0]
                $spoProps = @($spo.PSObject.Properties.Name)

                # Sharing Capability
                $sharingCap = if ($spoProps -contains 'SharingCapability') { $spo.SharingCapability } else { 'Unknown' }
                $sharingDisplay = switch ($sharingCap) {
                    'Disabled'                        { 'Disabled' }
                    'ExistingExternalUserSharingOnly'  { 'Existing Guests' }
                    'ExternalUserSharingOnly'          { 'External Users' }
                    'ExternalUserAndGuestSharing'      { 'Anyone' }
                    default { $sharingCap }
                }
                $sharingClass = switch ($sharingCap) {
                    'Disabled'                        { 'success' }
                    'ExistingExternalUserSharingOnly'  { 'success' }
                    'ExternalUserSharingOnly'          { 'warning' }
                    'ExternalUserAndGuestSharing'      { 'danger' }
                    default { '' }
                }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$sharingClass'><div class='email-metric-icon'>&#128279;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $sharingDisplay)</div><div class='email-metric-label'>External Sharing</div></div></div>")

                # Domain Restriction
                $domainRestrict = if ($spoProps -contains 'SharingDomainRestrictionMode') { $spo.SharingDomainRestrictionMode } else { 'Unknown' }
                $drClass = if ($domainRestrict -eq 'None' -or $domainRestrict -eq 'none') { 'warning' } else { 'success' }
                $drDisplay = switch ($domainRestrict) {
                    'AllowList'  { 'Allow List' }
                    'BlockList'  { 'Block List' }
                    'None'       { 'None' }
                    default      { $domainRestrict }
                }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$drClass'><div class='email-metric-icon'>&#127760;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $drDisplay)</div><div class='email-metric-label'>Domain Restriction</div></div></div>")

                # Resharing
                $resharing = if ($spoProps -contains 'IsResharingByExternalUsersEnabled') { $spo.IsResharingByExternalUsersEnabled } else { 'Unknown' }
                $reshareClass = if ($resharing -eq 'False') { 'success' } else { 'danger' }
                $reshareIcon = if ($resharing -eq 'False') { '&#128683;' } else { '&#9888;' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$reshareClass'><div class='email-metric-icon'>$reshareIcon</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $resharing)</div><div class='email-metric-label'>External Resharing</div></div></div>")

                # Sync Client Restriction
                $syncRestrict = if ($spoProps -contains 'IsUnmanagedSyncClientRestricted') { $spo.IsUnmanagedSyncClientRestricted } else { 'Unknown' }
                $syncClass = if ($syncRestrict -eq 'True') { 'success' } else { 'warning' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$syncClass'><div class='email-metric-icon'>&#128260;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $syncRestrict)</div><div class='email-metric-label'>Unmanaged Sync Blocked</div></div></div>")
            }

            if ($teamAccData.Count -gt 0) {
                $team = $teamAccData[0]
                $tProps = @($team.PSObject.Properties.Name)

                # Guest Access
                $guestAccess = if ($tProps -contains 'AllowGuestAccess') { $team.AllowGuestAccess } else { 'Unknown' }
                $guestClass = if ($guestAccess -eq 'False') { 'success' } else { 'warning' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$guestClass'><div class='email-metric-icon'>&#128101;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $guestAccess)</div><div class='email-metric-label'>Teams Guest Access</div></div></div>")

                # Third Party Apps
                $thirdParty = if ($tProps -contains 'AllowThirdPartyApps') { $team.AllowThirdPartyApps } else { 'Unknown' }
                $tpClass = if ($thirdParty -eq 'False') { 'success' } else { 'warning' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$tpClass'><div class='email-metric-icon'>&#128268;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $thirdParty)</div><div class='email-metric-label'>Third-Party Apps</div></div></div>")

                # Side Loading
                $sideLoad = if ($tProps -contains 'AllowSideLoading') { $team.AllowSideLoading } else { 'Unknown' }
                $slClass = if ($sideLoad -eq 'False') { 'success' } else { 'danger' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$slClass'><div class='email-metric-icon'>&#128230;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $sideLoad)</div><div class='email-metric-label'>Side Loading</div></div></div>")

                # Resource-Specific Consent
                $rscConsent = if ($tProps -contains 'IsUserPersonalScopeResourceSpecificConsentEnabled') { $team.IsUserPersonalScopeResourceSpecificConsentEnabled } else { 'Unknown' }
                $rscClass = if ($rscConsent -eq 'False') { 'success' } else { 'warning' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$rscClass'><div class='email-metric-icon'>&#128273;</div><div class='email-metric-body'><div class='email-metric-value'>$(ConvertTo-HtmlSafe -Text $rscConsent)</div><div class='email-metric-label'>Resource Consent</div></div></div>")
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-metrics-grid
            $null = $sectionHtml.AppendLine("</div>") # end email-dash-col

            # --- Middle column: SharePoint Security Config donut ---
            if ($spoSecData.Count -gt 0) {
                $spoSecPass   = @($spoSecData | Where-Object { $_.Status -eq 'Pass' }).Count
                $spoSecFail   = @($spoSecData | Where-Object { $_.Status -eq 'Fail' }).Count
                $spoSecWarn   = @($spoSecData | Where-Object { $_.Status -eq 'Warning' }).Count
                $spoSecReview = @($spoSecData | Where-Object { $_.Status -eq 'Review' }).Count
                $spoSecInfo   = @($spoSecData | Where-Object { $_.Status -eq 'Info' }).Count
                $spoSecTotal  = $spoSecData.Count

                $spoSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($spoSecPass   / $spoSecTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($spoSecFail   / $spoSecTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($spoSecWarn   / $spoSecTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'review';  Pct = [math]::Round(($spoSecReview / $spoSecTotal) * 100, 1); Label = 'Review' }
                )
                if ($spoSecInfo -gt 0) {
                    $spoSegments += @{ Css = 'info'; Pct = [math]::Round(($spoSecInfo / $spoSecTotal) * 100, 1); Label = 'Info' }
                }
                $spoOther = $spoSecTotal - ($spoSecPass + $spoSecFail + $spoSecWarn + $spoSecReview + $spoSecInfo)
                if ($spoOther -gt 0) {
                    $spoSegments += @{ Css = 'neutral'; Pct = [math]::Round(($spoOther / $spoSecTotal) * 100, 1); Label = 'Other' }
                }
                $spoDonut = Get-SvgMultiDonut -Segments $spoSegments -CenterLabel "$spoSecTotal" -Size 130 -StrokeWidth 12

                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>SharePoint Security</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
                $null = $sectionHtml.AppendLine($spoDonut)
                $null = $sectionHtml.AppendLine("<div class='score-donut-label'>SPO Controls</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
                $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-success'></span> Pass</span><span class='score-detail-value success-text'>$spoSecPass</span></div>")
                if ($spoSecFail -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-danger'></span> Fail</span><span class='score-detail-value danger-text'>$spoSecFail</span></div>")
                }
                if ($spoSecWarn -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-warning'></span> Warning</span><span class='score-detail-value warning-text'>$spoSecWarn</span></div>")
                }
                if ($spoSecReview -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-review'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-review);'>$spoSecReview</span></div>")
                }
                if ($spoSecInfo -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$spoSecInfo</span></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$spoSecTotal</span></div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            # --- Right column: Teams Security Config donut ---
            if ($teamSecData.Count -gt 0) {
                $teamSecPass   = @($teamSecData | Where-Object { $_.Status -eq 'Pass' }).Count
                $teamSecFail   = @($teamSecData | Where-Object { $_.Status -eq 'Fail' }).Count
                $teamSecWarn   = @($teamSecData | Where-Object { $_.Status -eq 'Warning' }).Count
                $teamSecReview = @($teamSecData | Where-Object { $_.Status -eq 'Review' }).Count
                $teamSecInfo   = @($teamSecData | Where-Object { $_.Status -eq 'Info' }).Count
                $teamSecTotal  = $teamSecData.Count

                $teamSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($teamSecPass   / $teamSecTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($teamSecFail   / $teamSecTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($teamSecWarn   / $teamSecTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'review';  Pct = [math]::Round(($teamSecReview / $teamSecTotal) * 100, 1); Label = 'Review' }
                )
                if ($teamSecInfo -gt 0) {
                    $teamSegments += @{ Css = 'info'; Pct = [math]::Round(($teamSecInfo / $teamSecTotal) * 100, 1); Label = 'Info' }
                }
                $teamOther = $teamSecTotal - ($teamSecPass + $teamSecFail + $teamSecWarn + $teamSecReview + $teamSecInfo)
                if ($teamOther -gt 0) {
                    $teamSegments += @{ Css = 'neutral'; Pct = [math]::Round(($teamOther / $teamSecTotal) * 100, 1); Label = 'Other' }
                }
                $teamDonut = Get-SvgMultiDonut -Segments $teamSegments -CenterLabel "$teamSecTotal" -Size 130 -StrokeWidth 12

                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Teams Security</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
                $null = $sectionHtml.AppendLine($teamDonut)
                $null = $sectionHtml.AppendLine("<div class='score-donut-label'>Teams Controls</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
                $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-success'></span> Pass</span><span class='score-detail-value success-text'>$teamSecPass</span></div>")
                if ($teamSecFail -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-danger'></span> Fail</span><span class='score-detail-value danger-text'>$teamSecFail</span></div>")
                }
                if ($teamSecWarn -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-warning'></span> Warning</span><span class='score-detail-value warning-text'>$teamSecWarn</span></div>")
                }
                if ($teamSecReview -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-review'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-review);'>$teamSecReview</span></div>")
                }
                if ($teamSecInfo -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$teamSecInfo</span></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$teamSecTotal</span></div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top
            $null = $sectionHtml.AppendLine("</div>") # end email-dashboard
        }
    }

    # Data tables for each collector
    foreach ($c in $sectionCollectors) {
        if ($c.Status -ne 'Complete' -or [int]$c.Items -eq 0) { continue }

        $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $c.FileName
        if (-not (Test-Path -Path $csvFile)) { continue }

        $data = Import-Csv -Path $csvFile
        if (-not $data -or @($data).Count -eq 0) { continue }

        $columns = @($data[0].PSObject.Properties.Name)
        $isSecurityConfig = ($columns -contains 'CheckId') -and ($columns -contains 'Status')

        # ----------------------------------------------------------
        # Secure Score — stat cards + progress bar before table
        # ----------------------------------------------------------
        if ($c.FileName -eq '16-Secure-Score.csv') {
            $score = $data[0]
            $pctRaw = 0
            $currentPts = ''
            $maxPts = ''
            $avgCompare = $null

            if ($score.PSObject.Properties.Name -contains 'Percentage') {
                $pctRaw = [math]::Round([double]$score.Percentage, 1)
            }
            if ($score.PSObject.Properties.Name -contains 'CurrentScore') {
                $currentPts = $score.CurrentScore
            }
            if ($score.PSObject.Properties.Name -contains 'MaxScore') {
                $maxPts = $score.MaxScore
            }
            if ($score.PSObject.Properties.Name -contains 'AverageComparativeScore') {
                $rawAvg = [double]$score.AverageComparativeScore
                # Graph API returns 0 when comparative data isn't available — treat as null
                $avgCompare = if ($rawAvg -gt 0) { [math]::Round($rawAvg, 1) } else { $null }
            }

            $scoreClass = if ($pctRaw -ge 80) { 'success' } elseif ($pctRaw -ge 60) { 'warning' } else { 'danger' }
            $null = Get-SvgDonut -Percentage $pctRaw -CssClass $scoreClass -Size 160 -StrokeWidth 14  # Warm up; small variant used below

            # Load Defender Security Config for status breakdown
            $defCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '18b-Defender-Security-Config.csv'
            $defPass = 0; $defFail = 0; $defWarn = 0; $defReview = 0; $defInfo = 0; $defTotal = 0
            if (Test-Path -Path $defCsvPath) {
                $defData = @(Import-Csv -Path $defCsvPath)
                $defPass = @($defData | Where-Object { $_.Status -eq 'Pass' }).Count
                $defFail = @($defData | Where-Object { $_.Status -eq 'Fail' }).Count
                $defWarn = @($defData | Where-Object { $_.Status -eq 'Warning' }).Count
                $defReview = @($defData | Where-Object { $_.Status -eq 'Review' }).Count
                $defInfo = @($defData | Where-Object { $_.Status -eq 'Info' }).Count
                $defTotal = $defData.Count
            }

            # Load Defender Policies and DLP Policies for metric cards
            $defPolCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '18-Defender-Policies.csv'
            $defPolTotal = 0; $defPolEnabled = 0
            if (Test-Path -Path $defPolCsvPath) {
                $defPolData = @(Import-Csv -Path $defPolCsvPath)
                $defPolTotal = $defPolData.Count
                $defPolEnabled = @($defPolData | Where-Object { $_.Enabled -eq 'True' }).Count
            }

            $dlpCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '19-DLP-Policies.csv'
            $dlpTotal = 0; $dlpEnabled = 0
            if (Test-Path -Path $dlpCsvPath) {
                $dlpData = @(Import-Csv -Path $dlpCsvPath)
                $dlpPolicies = @($dlpData | Where-Object { $_.ItemType -eq 'DlpPolicy' })
                $dlpTotal = $dlpPolicies.Count
                $dlpEnabled = @($dlpPolicies | Where-Object { $_.Enabled -eq 'True' }).Count
            }

            # Build 3-column dashboard matching other sections
            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # --- Left column: Security metrics as icon cards ---
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Security Overview</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")

            $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$scoreClass'><div class='email-metric-icon'>&#128170;</div><div class='email-metric-body'><div class='email-metric-value $scoreClass-text'>$pctRaw%</div><div class='email-metric-label'>Secure Score</div></div></div>")
            $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127919;</div><div class='email-metric-body'><div class='email-metric-value'>$currentPts <span class='score-detail-max'>/ $maxPts</span></div><div class='email-metric-label'>Points Earned</div></div></div>")
            if ($null -ne $avgCompare) {
                $compClass = if ($pctRaw -ge $avgCompare) { 'success' } else { 'warning' }
                $delta = [math]::Round([math]::Abs($pctRaw - $avgCompare), 1)
                $aboveBelow = if ($pctRaw -ge $avgCompare) { 'above' } else { 'below' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127760;</div><div class='email-metric-body'><div class='email-metric-value'>$avgCompare%</div><div class='email-metric-label'>M365 Average</div></div></div>")
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$compClass'><div class='email-metric-icon'>&#128200;</div><div class='email-metric-body'><div class='email-metric-value $compClass-text'>$delta pts $aboveBelow</div><div class='email-metric-label'>vs Average</div></div></div>")
            } else {
                $null = $sectionHtml.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#127760;</div><div class='email-metric-body'><div class='email-metric-value' style='color: var(--m365a-medium-gray);'>N/A</div><div class='email-metric-label'>M365 Average</div></div></div>")
            }
            if ($defPolTotal -gt 0) {
                $defPolClass = if ($defPolEnabled -eq $defPolTotal) { 'success' } elseif ($defPolEnabled -gt 0) { 'warning' } else { 'danger' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$defPolClass'><div class='email-metric-icon'>&#128737;</div><div class='email-metric-body'><div class='email-metric-value'>$defPolEnabled / $defPolTotal</div><div class='email-metric-label'>Defender Policies</div></div></div>")
            }
            if ($dlpTotal -gt 0) {
                $dlpClass = if ($dlpEnabled -eq $dlpTotal) { 'success' } elseif ($dlpEnabled -gt 0) { 'warning' } else { 'danger' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card id-metric-$dlpClass'><div class='email-metric-icon'>&#128220;</div><div class='email-metric-body'><div class='email-metric-value'>$dlpEnabled / $dlpTotal</div><div class='email-metric-label'>DLP Policies</div></div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>") # end email-metrics-grid
            $null = $sectionHtml.AppendLine("</div>") # end email-dash-col

            # --- Middle column: Secure Score donut ---
            $scoreDonutSmall = Get-SvgDonut -Percentage $pctRaw -CssClass $scoreClass -Size 130 -StrokeWidth 12
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Secure Score</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-stack'>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-item'>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-chart'>$scoreDonutSmall</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-info'><div class='id-donut-title'>Score: $pctRaw%</div><div class='id-donut-detail'>$currentPts / $maxPts points</div></div>")
            $null = $sectionHtml.AppendLine("</div>")
            if ($null -ne $avgCompare) {
                $null = $sectionHtml.AppendLine("<div class='id-donut-item'>")
                $null = $sectionHtml.AppendLine("<div class='id-donut-info' style='padding: 6px 0;'><div class='id-donut-title'>M365 Average: $avgCompare%</div><div class='id-donut-detail $compClass-text'>$delta pts $aboveBelow average</div></div>")
                $null = $sectionHtml.AppendLine("</div>")
            }
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # --- Right column: Defender Config donut ---
            if ($defTotal -gt 0) {
                $defPassPct = [math]::Round(($defPass / $defTotal) * 100, 1)
                $defFailPct = [math]::Round(($defFail / $defTotal) * 100, 1)
                $defWarnPct = [math]::Round(($defWarn / $defTotal) * 100, 1)
                $defReviewPct = [math]::Round(($defReview / $defTotal) * 100, 1)
                $defSegments = @(
                    @{ Css = 'success'; Pct = $defPassPct; Label = 'Pass' }
                    @{ Css = 'danger'; Pct = $defFailPct; Label = 'Fail' }
                    @{ Css = 'warning'; Pct = $defWarnPct; Label = 'Warning' }
                    @{ Css = 'review'; Pct = $defReviewPct; Label = 'Review' }
                )
                if ($defInfo -gt 0) {
                    $defInfoPct = [math]::Round(($defInfo / $defTotal) * 100, 1)
                    $defSegments += @{ Css = 'info'; Pct = $defInfoPct; Label = 'Info' }
                }
                $defOther = $defTotal - ($defPass + $defFail + $defWarn + $defReview + $defInfo)
                if ($defOther -gt 0) {
                    $defSegments += @{ Css = 'neutral'; Pct = [math]::Round(($defOther / $defTotal) * 100, 1); Label = 'Other' }
                }
                $defMultiDonut = Get-SvgMultiDonut -Segments $defSegments -CenterLabel "$defTotal" -Size 130 -StrokeWidth 12

                $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Defender Config</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel'>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-donut'>")
                $null = $sectionHtml.AppendLine($defMultiDonut)
                $null = $sectionHtml.AppendLine("<div class='score-donut-label'>Defender Controls</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("<div class='dash-panel-details'>")
                $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-success'></span> Pass</span><span class='score-detail-value success-text'>$defPass</span></div>")
                if ($defFail -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-danger'></span> Fail</span><span class='score-detail-value danger-text'>$defFail</span></div>")
                }
                if ($defWarn -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-warning'></span> Warning</span><span class='score-detail-value warning-text'>$defWarn</span></div>")
                }
                if ($defReview -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-review'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-review);'>$defReview</span></div>")
                }
                if ($defInfo -gt 0) {
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$defInfo</span></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$defTotal</span></div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top
            $null = $sectionHtml.AppendLine("</div>") # end email-dashboard
        }

        # User Summary — rendered in combined identity dashboard above
        if ($c.FileName -eq '02-User-Summary.csv') {
            continue
        }

        # ----------------------------------------------------------
        # Mailbox Summary — rendered in combined email dashboard above
        # ----------------------------------------------------------
        if ($c.FileName -eq '09-Mailbox-Summary.csv') {
            continue
        }

        # EXO Security Config — visuals rendered in combined email dashboard above

        # Email Policies — visuals rendered in combined email dashboard above

        # DNS Authentication — visuals rendered in combined email dashboard above

        # ----------------------------------------------------------
        # Standard data table rendering
        # ----------------------------------------------------------
        $rowCount = @($data).Count
        $collectorDisplay = if ($c.FileName -eq '11-EXO-Email-Policies.csv') { 'EXO Email Policies' } else { $c.Collector }

        # Insert DNS subsection divider before the first DNS table
        $isDnsTable = $c.FileName -match '^12[b]?-DNS-'
        if ($isDnsTable -and -not $dnsSubsectionRendered) {
            $null = $sectionHtml.AppendLine("<div class='dns-subsection-divider'>")
            $null = $sectionHtml.AppendLine("<h3>DNS Authentication</h3>")
            $null = $sectionHtml.AppendLine("<p class='source-note'>The following data was retrieved via public DNS queries against each verified domain.</p>")
            $null = $sectionHtml.AppendLine("</div>")
            $dnsSubsectionRendered = $true
        }

        $null = $sectionHtml.AppendLine("<details class='collector-detail' open>")
        $null = $sectionHtml.AppendLine("<summary><h3>$(ConvertTo-HtmlSafe -Text $collectorDisplay) <span class='row-count'>($rowCount rows)</span></h3></summary>")

        # Status filter bar for security config tables
        if ($isSecurityConfig) {
            $tblPass   = @($data | Where-Object { $_.Status -eq 'Pass' }).Count
            $tblFail   = @($data | Where-Object { $_.Status -eq 'Fail' }).Count
            $tblWarn   = @($data | Where-Object { $_.Status -eq 'Warning' }).Count
            $tblReview = @($data | Where-Object { $_.Status -eq 'Review' }).Count
            $tblInfo   = @($data | Where-Object { $_.Status -eq 'Info' }).Count
            $null = $sectionHtml.AppendLine("<div class='status-filter table-status-filter'>")
            $null = $sectionHtml.AppendLine("<span class='status-filter-label'>Status:</span>")
            if ($tblFail -gt 0) {
                $null = $sectionHtml.AppendLine("<label class='status-checkbox status-fail'><input type='checkbox' value='fail' checked> Fail ($tblFail)</label>")
            }
            if ($tblWarn -gt 0) {
                $null = $sectionHtml.AppendLine("<label class='status-checkbox status-warning'><input type='checkbox' value='warning' checked> Warning ($tblWarn)</label>")
            }
            if ($tblReview -gt 0) {
                $null = $sectionHtml.AppendLine("<label class='status-checkbox status-review'><input type='checkbox' value='review' checked> Review ($tblReview)</label>")
            }
            if ($tblPass -gt 0) {
                $null = $sectionHtml.AppendLine("<label class='status-checkbox status-pass'><input type='checkbox' value='pass' checked> Pass ($tblPass)</label>")
            }
            if ($tblInfo -gt 0) {
                $null = $sectionHtml.AppendLine("<label class='status-checkbox status-info'><input type='checkbox' value='info' checked> Info ($tblInfo)</label>")
            }
            $null = $sectionHtml.AppendLine("<span class='fw-selector-actions'><button type='button' class='fw-action-btn tbl-status-all'>All</button><button type='button' class='fw-action-btn tbl-status-none'>None</button></span>")
            $null = $sectionHtml.AppendLine("</div>")
        }

        # Column visibility picker (security config tables only)
        $hiddenByDefault = @('CheckId', 'Category', 'RecommendedValue')
        if ($isSecurityConfig) {
            $null = $sectionHtml.AppendLine("<div class='col-picker-bar'>")
            $null = $sectionHtml.AppendLine("<button type='button' class='col-picker-toggle'>Columns &#9662;</button>")
            $null = $sectionHtml.AppendLine("<div class='col-picker-panel' hidden>")
            foreach ($col in $columns) {
                $displayCol    = Format-ColumnHeader -Name $col
                $isColHidden   = $hiddenByDefault -contains $col
                $defaultAttr   = if ($isColHidden) { " data-col-default='hidden'" } else { '' }
                $checkedAttr   = if ($isColHidden) { '' } else { ' checked' }
                $null = $sectionHtml.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='$col'$defaultAttr$checkedAttr> $(ConvertTo-HtmlSafe -Text $displayCol)</label>")
            }
            $null = $sectionHtml.AppendLine("</div></div>")
        }

        $null = $sectionHtml.AppendLine("<div class='table-wrapper'>")
        $null = $sectionHtml.AppendLine("<table class='data-table'>")
        $null = $sectionHtml.AppendLine("<caption class='sr-only'>$($collector.Label) assessment results</caption>")
        $null = $sectionHtml.AppendLine("<thead><tr>")
        foreach ($col in $columns) {
            $displayCol = Format-ColumnHeader -Name $col
            $initStyle  = if ($isSecurityConfig -and ($hiddenByDefault -contains $col)) { " style='display:none'" } else { '' }
            $null = $sectionHtml.AppendLine("<th scope='col' data-col-key='$col'$initStyle>$(ConvertTo-HtmlSafe -Text $displayCol)</th>")
        }
        $null = $sectionHtml.AppendLine("</tr></thead>")
        $null = $sectionHtml.AppendLine("<tbody>")

        # Smart-sort: prioritize actionable items at the top
        $data = @(Get-SmartSortedData -Data $data -CollectorName $c.Collector)

        # Limit rows for very large datasets (keep it readable)
        $maxRows = 100
        $displayData = @($data)
        $truncated = $false
        if ($displayData.Count -gt $maxRows) {
            $displayData = $displayData | Select-Object -First $maxRows
            $truncated = $true
        }

        foreach ($row in $displayData) {
            # Security config tables — row-level status coloring
            if ($isSecurityConfig -and $row.Status) {
                $rowClass = switch ($row.Status) {
                    'Pass'    { " class='cis-row-pass'" }
                    'Fail'    { " class='cis-row-fail'" }
                    'Warning' { " class='cis-row-warning'" }
                    'Review'  { " class='cis-row-review'" }
                    'Info'    { " class='cis-row-info'" }
                    'Unknown' { " class='cis-row-unknown'" }
                    default   { '' }
                }
                $null = $sectionHtml.AppendLine("<tr$rowClass>")
            }
            else {
                $null = $sectionHtml.AppendLine("<tr>")
            }

            foreach ($col in $columns) {
                $val = ConvertTo-HtmlSafe -Text "$($row.$col)"
                # Truncate very long cell values
                if ($val.Length -gt 200) {
                    $val = $val.Substring(0, 197) + '...'
                }
                # Column-key attribute and initial hidden state for column picker
                $colKeyAttr = " data-col-key='$col'"
                $initStyle  = if ($isSecurityConfig -and ($hiddenByDefault -contains $col)) { " style='display:none'" } else { '' }
                # Security config Status column — add badge styling
                if ($isSecurityConfig -and $col -eq 'Status') {
                    $badgeClass = switch ($val) {
                        'Pass'    { 'badge-complete' }
                        'Fail'    { 'badge-failed' }
                        'Warning' { 'badge-warning' }
                        'Review'  { 'badge-info' }
                        'Info'    { 'badge-neutral' }
                        'Unknown' { 'badge-skipped' }
                        default   { '' }
                    }
                    if ($badgeClass) {
                        $val = "<span class='badge $badgeClass'>$val</span>"
                    }
                }
                # Special rendering for DKIMStatus column
                if ($col -eq 'DKIMStatus') {
                    $cellCss = ''
                    if ($val -match '^Mismatch') {
                        $cellCss = " class='dkim-mismatch'"
                    }
                    elseif ($val -match 'EXO Confirmed') {
                        $cellCss = " class='dkim-exo-confirmed'"
                    }
                    $null = $sectionHtml.AppendLine("<td$cellCss$colKeyAttr$initStyle>$val</td>")
                    continue
                }
                # Remediation column — add copy-to-clipboard button for PowerShell commands
                if ($col -eq 'Remediation' -and $row.Remediation -match '^(Set|Get|New|Remove|Update|Enable|Disable|Add|Connect|Grant|Revoke|Install|Uninstall|Import|Export)-') {
                    $rawRemediation = ConvertTo-HtmlSafe -Text "$($row.Remediation)"
                    if ($rawRemediation.Length -gt 200) { $rawRemediation = $rawRemediation.Substring(0, 197) + '...' }
                    $null = $sectionHtml.AppendLine("<td class='remediation-cell'$colKeyAttr$initStyle><span class='remediation-text'>$rawRemediation</span><button type='button' class='copy-btn' title='Copy command' aria-label='Copy remediation command' onclick='copyRemediation(this)'>&#128203;</button></td>")
                    continue
                }
                $null = $sectionHtml.AppendLine("<td$colKeyAttr$initStyle>$val</td>")
            }
            $null = $sectionHtml.AppendLine("</tr>")
        }

        $null = $sectionHtml.AppendLine("</tbody></table>")

        if ($truncated) {
            $null = $sectionHtml.AppendLine("<p class='truncated'>Showing first $maxRows of $(@($data).Count) rows. See CSV for full data.</p>")
        }

        $null = $sectionHtml.AppendLine("</div>")
        $null = $sectionHtml.AppendLine("</details>")
    }

    $null = $sectionHtml.AppendLine("</details>")
    $null = $sectionHtml.AppendLine("</div>") # close report-page wrapper
}

# ------------------------------------------------------------------
# Build Table of Contents
# ------------------------------------------------------------------
$tocHtml = [System.Text.StringBuilder]::new()
$null = $tocHtml.AppendLine("<nav class='report-toc'>")
$null = $tocHtml.AppendLine("<h2 class='toc-heading'>Table of Contents</h2>")
$null = $tocHtml.AppendLine("<ol class='toc-list'>")

foreach ($tocSection in $sections) {
    if ($tocSection -eq 'Tenant') {
        $null = $tocHtml.AppendLine("<li><a href='#section-tenant'>Organization Profile</a></li>")
    }
    else {
        $tocId = ($tocSection -replace '[^a-zA-Z0-9]', '-').ToLower()
        $tocLabel = [System.Web.HttpUtility]::HtmlEncode($tocSection)
        $null = $tocHtml.AppendLine("<li><a href='#section-$tocId'>$tocLabel</a></li>")
    }
}

# TOC will be closed after CIS/Issues sections are built

# ------------------------------------------------------------------
# Build unified Compliance Overview section
# ------------------------------------------------------------------
$complianceHtml = ''
$allCisFindings = [System.Collections.Generic.List[PSCustomObject]]::new()

# Scan all completed collector CSVs for CheckId-mapped findings
foreach ($c in $summary) {
    if ($c.Status -ne 'Complete' -or [int]$c.Items -eq 0) { continue }
    $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $c.FileName
    if (-not (Test-Path -Path $csvFile)) { continue }

    $data = Import-Csv -Path $csvFile
    if (-not $data -or @($data).Count -eq 0) { continue }

    $columns = @($data[0].PSObject.Properties.Name)
    if ($columns -notcontains 'CheckId') { continue }

    foreach ($row in $data) {
        if (-not $row.CheckId -or $row.CheckId -eq '') { continue }
        # Strip sub-number suffix (e.g., DEFENDER-ANTIPHISH-001.3 -> DEFENDER-ANTIPHISH-001) for registry lookup
        $baseCheckId = $row.CheckId -replace '\.\d+$', ''
        $entry = if ($controlRegistry.ContainsKey($baseCheckId)) { $controlRegistry[$baseCheckId] } else { $null }
        $fw = if ($entry) { $entry.frameworks } else { @{} }
        # Build dynamic Frameworks hashtable from all loaded framework definitions
        $fwHash = @{}
        foreach ($fwDef in $allFrameworks) {
            $fwData = $fw.($fwDef.frameworkId)
            if ($fwData) {
                $fwHash[$fwDef.frameworkId] = @{ controlId = $fwData.controlId }
                if ($fwData.profiles) { $fwHash[$fwDef.frameworkId].profiles = @($fwData.profiles) }
            }
        }
        $cisData = $fwHash[$CisFrameworkId]
        $cisId = if ($cisData) { $cisData.controlId } else { '' }

        $allCisFindings.Add([PSCustomObject]@{
            CheckId      = $row.CheckId
            CisControl   = $cisId
            Category     = $row.Category
            Setting      = $row.Setting
            CurrentValue = $row.CurrentValue
            Recommended  = $row.RecommendedValue
            Status       = $row.Status
            Remediation  = $row.Remediation
            Section      = $c.Section
            Source       = $c.Collector
            RiskSeverity = if ($entry) { $entry.riskSeverity } else { 'Medium' }
            Frameworks   = $fwHash
        })
    }
}

# ------------------------------------------------------------------
# Compute per-section status counts for the service-area breakdown chart
# ------------------------------------------------------------------
$sectionStatusCounts = @{}
if ($allCisFindings.Count -gt 0) {
    $grouped = $allCisFindings | Group-Object -Property Section
    foreach ($group in $grouped) {
        $passCount = @($group.Group | Where-Object { $_.Status -eq 'Pass' }).Count
        $failCount = @($group.Group | Where-Object { $_.Status -eq 'Fail' }).Count
        $warnCount = @($group.Group | Where-Object { $_.Status -eq 'Warning' }).Count
        $reviewCount = @($group.Group | Where-Object { $_.Status -eq 'Review' }).Count
        $totalCount = $passCount + $failCount + $warnCount + $reviewCount
        if ($totalCount -gt 0) {
            $sectionStatusCounts[$group.Name] = @{
                Pass    = $passCount
                Fail    = $failCount
                Warning = $warnCount
                Review  = $reviewCount
                Total   = $totalCount
            }
        }
    }
}

if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0 -and -not $SkipComplianceOverview) {
    . (Join-Path -Path $PSScriptRoot -ChildPath 'Export-ComplianceOverview.ps1')
    $complianceHtml = Export-ComplianceOverview -Findings @($allCisFindings) -ControlRegistry $controlRegistry -Frameworks $allFrameworks -FrameworkFilter $FrameworkFilter -Sections @($summary | Select-Object -ExpandProperty Section -ErrorAction SilentlyContinue | Where-Object { $_ } | Sort-Object -Unique)
}

# ------------------------------------------------------------------
# Build framework catalog HTML fragments for per-framework posture pages
# ------------------------------------------------------------------
$catalogHtml = ''
if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) {
    . (Join-Path -Path $PSScriptRoot -ChildPath 'Export-FrameworkCatalog.ps1')
    $catalogFrameworks = $allFrameworks
    if ($FrameworkFilter -and $FrameworkFilter.Count -gt 0) {
        $catalogFrameworks = @($allFrameworks | Where-Object { $_.filterFamily -in $FrameworkFilter })
    }
    foreach ($fw in $catalogFrameworks) {
        $fwCatalog = Export-FrameworkCatalog -Findings @($allCisFindings) -Framework $fw `
            -ControlRegistry $controlRegistry -Mode Inline
        if ($fwCatalog) { $catalogHtml += $fwCatalog }
    }
}

# ------------------------------------------------------------------
# Framework Catalog standalone exports (optional)
# ------------------------------------------------------------------
if ($FrameworkExport -and $allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) {
    if (-not (Get-Command -Name Export-FrameworkCatalog -ErrorAction SilentlyContinue)) {
        . (Join-Path -Path $PSScriptRoot -ChildPath 'Export-FrameworkCatalog.ps1')
    }
    $exportFrameworks = $allFrameworks
    if ('All' -notin $FrameworkExport) {
        $exportFrameworks = @($allFrameworks | Where-Object { $_.filterFamily -in $FrameworkExport })
    }
    $catalogTenantName = if ($reportDomainPrefix) { $reportDomainPrefix } elseif ($TenantName) { $TenantName } else { 'Unknown' }
    $catalogSuffix = if ($reportDomainPrefix) { "_$reportDomainPrefix" } else { '' }
    foreach ($fw in $exportFrameworks) {
        $fwFileName = "_$($fw.label -replace '[^a-zA-Z0-9]','-')-Catalog${catalogSuffix}.html"
        $fwPath = Join-Path -Path $AssessmentFolder -ChildPath $fwFileName
        Export-FrameworkCatalog -Findings @($allCisFindings) -Framework $fw `
            -ControlRegistry $controlRegistry -Mode Standalone `
            -OutputPath $fwPath -TenantName $catalogTenantName
        Write-Verbose "Framework catalog exported: $fwFileName"
    }
}

# ------------------------------------------------------------------
# Export Compliance Matrix XLSX (optional — requires ImportExcel module)
# ------------------------------------------------------------------
try {
    $xlsxScript = Join-Path -Path $PSScriptRoot -ChildPath 'Export-ComplianceMatrix.ps1'
    if (Test-Path -Path $xlsxScript) {
        & $xlsxScript -AssessmentFolder $AssessmentFolder -TenantName $reportDomainPrefix
    }
} catch {
    Write-Warning "XLSX compliance matrix export failed: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# Build issues HTML
# ------------------------------------------------------------------
$issuesHtml = [System.Text.StringBuilder]::new()
if ($issues.Count -gt 0) {
    $null = $issuesHtml.AppendLine("<details class='section' open>")
    $null = $issuesHtml.AppendLine("<summary><h2>Technical Issues</h2></summary>")
    $null = $issuesHtml.AppendLine("<table class='data-table'>")
    $null = $issuesHtml.AppendLine("<caption class='sr-only'>Technical issues found during assessment</caption>")
    $null = $issuesHtml.AppendLine("<thead><tr><th scope='col'>Severity</th><th scope='col'>Section</th><th scope='col'>Collector</th><th scope='col'>Description</th><th scope='col'>Recommended Action</th></tr></thead>")
    $null = $issuesHtml.AppendLine("<tbody>")

    $severityOrder = @{ 'ERROR' = 0; 'WARNING' = 1 }
    $sortedIssues = @($issues | Sort-Object -Property { if ($severityOrder.ContainsKey($_.Severity)) { $severityOrder[$_.Severity] } else { 99 } })
    foreach ($issue in $sortedIssues) {
        $badge = Get-SeverityBadge -Severity $issue.Severity
        $null = $issuesHtml.AppendLine("<tr>")
        $null = $issuesHtml.AppendLine("<td>$badge</td>")
        $null = $issuesHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $issue.Section)</td>")
        $null = $issuesHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $issue.Collector)</td>")
        $null = $issuesHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $issue.Description)</td>")
        $null = $issuesHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $issue.Action)</td>")
        $null = $issuesHtml.AppendLine("</tr>")
    }

    $null = $issuesHtml.AppendLine("</tbody></table>")
    $null = $issuesHtml.AppendLine("</details>")
}

# ------------------------------------------------------------------
# Build Checks-Run Appendix
# ------------------------------------------------------------------
$checksRunHtml = [System.Text.StringBuilder]::new()
if ($allCisFindings.Count -gt 0) {
    $sortedChecks = @($allCisFindings | Sort-Object -Property CheckId)
    $sectionNames = @($sortedChecks | Select-Object -ExpandProperty Section -Unique)
    $null = $checksRunHtml.AppendLine("<div class='appendix-section' id='appendix-checks-run'>")
    $null = $checksRunHtml.AppendLine("<h2>Appendix: Checks Run</h2>")
    $null = $checksRunHtml.AppendLine("<p class='appendix-desc'>Complete list of all security configuration checks executed during this assessment.</p>")
    $null = $checksRunHtml.AppendLine("<div class='table-wrapper'>")
    $null = $checksRunHtml.AppendLine("<table class='data-table'>")
    $null = $checksRunHtml.AppendLine("<caption class='sr-only'>Complete list of checks run during this assessment</caption>")
    $null = $checksRunHtml.AppendLine("<thead><tr><th scope='col'>CheckId</th><th scope='col'>Setting</th><th scope='col'>Category</th><th scope='col'>Status</th><th scope='col'>Section</th></tr></thead>")
    $null = $checksRunHtml.AppendLine("<tbody>")
    foreach ($check in $sortedChecks) {
        $statusBadgeClass = switch ($check.Status) {
            'Pass'    { 'badge-complete' }
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-info' }
            'Info'    { 'badge-neutral' }
            'Unknown' { 'badge-skipped' }
            default   { '' }
        }
        $statusCell = if ($statusBadgeClass) {
            "<span class='badge $statusBadgeClass'>$(ConvertTo-HtmlSafe -Text $check.Status)</span>"
        }
        else {
            ConvertTo-HtmlSafe -Text $check.Status
        }
        $null = $checksRunHtml.AppendLine("<tr>")
        $null = $checksRunHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $check.CheckId)</td>")
        $null = $checksRunHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $check.Setting)</td>")
        $null = $checksRunHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $check.Category)</td>")
        $null = $checksRunHtml.AppendLine("<td>$statusCell</td>")
        $null = $checksRunHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $check.Section)</td>")
        $null = $checksRunHtml.AppendLine("</tr>")
    }
    $null = $checksRunHtml.AppendLine("</tbody></table>")
    $null = $checksRunHtml.AppendLine("</div>")
    $null = $checksRunHtml.AppendLine("<p class='appendix-count'>Total: $($sortedChecks.Count) checks across $($sectionNames.Count) sections</p>")
    $null = $checksRunHtml.AppendLine("</div>")
}

# Append conditional entries to TOC now that compliance/issues counts are known
if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0 -and -not $SkipComplianceOverview) {
    $null = $tocHtml.AppendLine("<li><a href='#compliance-overview'>Compliance Overview</a></li>")
}
if ($issues.Count -gt 0) {
    $null = $tocHtml.AppendLine("<li><a href='#issues'>Technical Issues</a></li>")
}
if ($allCisFindings.Count -gt 0) {
    $null = $tocHtml.AppendLine("<li><a href='#appendix-checks-run'>Appendix: Checks Run</a></li>")
}
$null = $tocHtml.AppendLine("</ol>")
$null = $tocHtml.AppendLine("</nav>")

function Build-RemediationPlanHtml {
    <#
    .SYNOPSIS
        Builds the Remediation Action Plan HTML page for the assessment report.
    .DESCRIPTION
        Filters all CIS findings to Fail and Warning status, sorts by risk severity
        (Critical -> High -> Medium -> Low), and renders a collapsible prioritized
        action table with chip filters, dynamic cross-dimension counts, and a
        compact-by-default scrollable viewport with expand/collapse control.
    .PARAMETER Findings
        All CIS findings from the assessment ($allCisFindings).
    .PARAMETER IsQuickScan
        Unused -- reserved for future use; no note is rendered in the page.
    .EXAMPLE
        $remediationPlanHtml = Build-RemediationPlanHtml -Findings $allCisFindings -IsQuickScan:$QuickScan
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [PSCustomObject[]]$Findings = @(),

        [Parameter()]
        [bool]$IsQuickScan = $false
    )

    $actionable = @($Findings | Where-Object { $_.Status -in @('Fail', 'Warning') })

    if ($actionable.Count -eq 0) {
        return @"
<details class='section' id='remediation-plan-section' open>
<summary><h2>Remediation Action Plan</h2></summary>
<div class='remediation-empty'><p>No actionable findings &mdash; all checks passed or were not applicable.</p></div>
</details>
"@
    }

    # Sort: severity priority order, then Section, then CheckId
    $severityOrder = @{ 'Critical' = 0; 'High' = 1; 'Medium' = 2; 'Low' = 3; 'Info' = 4 }
    $sorted = $actionable | Sort-Object -Property @(
        @{ Expression = { if ($severityOrder.ContainsKey($_.RiskSeverity)) { $severityOrder[$_.RiskSeverity] } else { 99 } } }
        @{ Expression = { $_.Section } }
        @{ Expression = { $_.CheckId } }
    )

    $critCount = @($sorted | Where-Object { $_.RiskSeverity -eq 'Critical' }).Count
    $highCount  = @($sorted | Where-Object { $_.RiskSeverity -eq 'High' }).Count
    $medCount   = @($sorted | Where-Object { $_.RiskSeverity -eq 'Medium' }).Count
    $lowCount   = @($sorted | Where-Object { $_.RiskSeverity -eq 'Low' }).Count
    $totalCount = $sorted.Count

    $uniqueSections = @($sorted | Select-Object -ExpandProperty Section -ErrorAction SilentlyContinue | Where-Object { $_ } | Sort-Object -Unique)

    $html = [System.Text.StringBuilder]::new()

    # Outer collapsible section -- matches existing details.section pattern
    $null = $html.AppendLine("<details class='section' id='remediation-plan-section' open>")
    $null = $html.AppendLine("<summary><h2>Remediation Action Plan</h2></summary>")

    # Stat tiles
    $null = $html.AppendLine("<div class='remediation-stats'>")
    foreach ($sevEntry in @( @('Critical',$critCount,'critical'), @('High',$highCount,'high'), @('Medium',$medCount,'medium'), @('Low',$lowCount,'low') )) {
        if ($sevEntry[1] -gt 0) {
            $null = $html.AppendLine("<div class='remediation-stat remediation-stat-$($sevEntry[2])'><span class='stat-num'>$($sevEntry[1])</span><span class='stat-label'>$($sevEntry[0])</span></div>")
        }
    }
    $null = $html.AppendLine("</div>")

    # ---- Severity chip filter row ----
    $null = $html.AppendLine("<div class='remediation-chip-bar'>")
    $null = $html.AppendLine("<div class='rem-chip-section' id='remSeveritySection'>")
    $null = $html.AppendLine("<span class='rem-filter-label'>Severity:</span>")
    $null = $html.AppendLine("<div class='rem-chip-group' id='remSeverityChips'>")
    foreach ($sevEntry in @( @('Critical',$critCount), @('High',$highCount), @('Medium',$medCount), @('Low',$lowCount) )) {
        $sevName = $sevEntry[0]; $sevCnt = $sevEntry[1]
        if ($sevCnt -gt 0) {
            $null = $html.AppendLine("<label class='fw-checkbox active rem-sev-chip' data-severity='$sevName' onclick='toggleRemChip(this); return false;'><input type='checkbox' checked hidden>$sevName <span class='rem-chip-count'>$sevCnt</span></label>")
        }
    }
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' class='fw-action-btn rem-chips-all' onclick='setAllRemChips(this)'>All</button><button type='button' class='fw-action-btn rem-chips-none' onclick='setAllRemChips(this)'>None</button></span>")
    $null = $html.AppendLine("</div>")

    # ---- Section chip filter row ----
    if ($uniqueSections.Count -gt 0) {
        $null = $html.AppendLine("<div class='rem-chip-section' id='remSectionSection'>")
        $null = $html.AppendLine("<span class='rem-filter-label'>Section:</span>")
        $null = $html.AppendLine("<div class='rem-chip-group' id='remSectionChips'>")
        foreach ($sec in $uniqueSections) {
            $secEncoded = ConvertTo-HtmlSafe -Text $sec
            $secCnt = @($sorted | Where-Object { $_.Section -eq $sec }).Count
            $null = $html.AppendLine("<label class='fw-checkbox active rem-sec-chip' data-section='$secEncoded' onclick='toggleRemChip(this); return false;'><input type='checkbox' checked hidden>$secEncoded <span class='rem-chip-count'>$secCnt</span></label>")
        }
        $null = $html.AppendLine("</div>")
        $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' class='fw-action-btn rem-chips-all' onclick='setAllRemChips(this)'>All</button><button type='button' class='fw-action-btn rem-chips-none' onclick='setAllRemChips(this)'>None</button></span>")
        $null = $html.AppendLine("</div>")
    }
    $null = $html.AppendLine("</div>") # remediation-chip-bar

    # ---- Collapsible table via collector-detail pattern ----
    $findingWord = if ($totalCount -eq 1) { 'finding' } else { 'findings' }
    $null = $html.AppendLine("<details class='collector-detail' id='remTableDetail' open>")
    $null = $html.AppendLine("<summary><h3>Action Items</h3><span class='row-count' id='remMatchCount'>($totalCount $findingWord)</span></summary>")

    # Column picker for remediation table
    $null = $html.AppendLine("<div class='col-picker-bar'>")
    $null = $html.AppendLine("<button type='button' class='col-picker-toggle'>Columns &#9662;</button>")
    $null = $html.AppendLine("<div class='col-picker-panel' hidden>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='Severity' checked> Severity</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='Section' checked> Section</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='Check' checked> Check</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='CheckId' data-col-default='hidden'> Check ID</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='CurrentState' checked> Current State</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='Remediation' checked> Remediation</label>")
    $null = $html.AppendLine("</div></div>")

    # Table wrapper — compact by default; initPageTableExpand injects ▼ Expand button when needed
    $null = $html.AppendLine("<div class='table-wrapper remediation-table-wrapper'>")
    $null = $html.AppendLine("<table class='data-table remediation-table' id='remediationTable'>")
    $null = $html.AppendLine("<thead><tr>")
    $null = $html.AppendLine("<th scope='col' data-col-key='Severity'>Severity</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='Section'>Section</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='Check'>Check</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='CheckId' style='display:none'>Check ID</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='CurrentState'>Current State</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='Remediation'>Remediation</th>")
    $null = $html.AppendLine("</tr></thead><tbody>")

    foreach ($finding in $sorted) {
        $sev = if ($finding.RiskSeverity) { $finding.RiskSeverity } else { 'Low' }
        $sevClass = switch ($sev) {
            'Critical' { 'remediation-row-critical' }
            'High'     { 'remediation-row-high' }
            'Medium'   { 'remediation-row-medium' }
            default    { 'remediation-row-low' }
        }
        $badgeClass = switch ($sev) {
            'Critical' { 'badge-fail' }
            'High'     { 'badge-warning' }
            'Medium'   { 'badge-review' }
            default    { 'badge-neutral' }
        }
        $sectionEncoded  = ConvertTo-HtmlSafe -Text $finding.Section
        $checkEncoded    = ConvertTo-HtmlSafe -Text $finding.Setting
        $checkIdEncoded  = ConvertTo-HtmlSafe -Text $(if ($finding.CheckId) { $finding.CheckId } else { '' })
        $currentEncoded  = ConvertTo-HtmlSafe -Text $finding.CurrentValue
        $remEncoded      = ConvertTo-HtmlSafe -Text $(if ($finding.Remediation) { $finding.Remediation } else { '' })

        $null = $html.AppendLine("<tr class='$sevClass' data-severity='$sev' data-section='$sectionEncoded'>")
        $null = $html.AppendLine("<td data-col-key='Severity'><span class='badge $badgeClass'>$(ConvertTo-HtmlSafe -Text $sev)</span></td>")
        $null = $html.AppendLine("<td data-col-key='Section'>$sectionEncoded</td>")
        $null = $html.AppendLine("<td data-col-key='Check'>$checkEncoded</td>")
        $null = $html.AppendLine("<td data-col-key='CheckId' style='display:none'>$checkIdEncoded</td>")
        $null = $html.AppendLine("<td data-col-key='CurrentState'>$currentEncoded</td>")
        $null = $html.AppendLine("<td data-col-key='Remediation'><span class='rem-text'>$remEncoded</span><button class='copy-btn' onclick='copyRemediation(this)' title='Copy to clipboard'>&#128203;</button></td>")
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table>")
    $null = $html.AppendLine("</div>") # table-wrapper
    $null = $html.AppendLine("<p id='remNoResults' class='no-results' style='display:none'>No findings match the current filter selection.</p>")

    $null = $html.AppendLine("</details>") # collector-detail
    $null = $html.AppendLine("</details>") # section

    return $html.ToString()
}
