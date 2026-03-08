#Requires -Version 7.0
<#
.SYNOPSIS
    Generates branded HTML and PDF assessment reports from M365 assessment output.
.DESCRIPTION
    Reads CSV data and metadata from an M365 assessment output folder and produces
    a self-contained HTML report with M365 Assess branding. The HTML
    includes embedded CSS, base64-encoded logos, and print-friendly styling that
    produces clean PDF output when printed from a browser.

    The report includes:
    - Branded cover page with tenant name and assessment date
    - Executive summary with section counts and issue overview
    - Section-by-section data tables for all collected CSV data
    - Issue report with severity levels and recommended actions
    - Footer with version and generation timestamp
.PARAMETER AssessmentFolder
    Path to the assessment output folder (e.g., .\M365-Assessment\Assessment_20260306_195618).
    Must contain _Assessment-Summary.csv and optionally _Assessment-Issues.log.
.PARAMETER OutputPath
    Path for the generated HTML report. Defaults to _Assessment-Report.html in the
    assessment folder.
.PARAMETER TenantName
    Tenant display name for the cover page. If not specified, attempts to read from
    the Tenant Information CSV.
.PARAMETER SkipPdf
    Skip PDF generation even if wkhtmltopdf is available on the system.
.EXAMPLE
    PS> .\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_20260306_195618'

    Generates an HTML report in the assessment folder.
.EXAMPLE
    PS> .\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_20260306_195618' -TenantName 'Contoso Ltd'

    Generates a report with the specified tenant name on the cover page.
.NOTES
    Version: 0.3.0
    Author:  Daren9m
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$AssessmentFolder,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [string]$TenantName,

    [Parameter()]
    [switch]$SkipPdf
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ------------------------------------------------------------------
# Validate input
# ------------------------------------------------------------------
if (-not (Test-Path -Path $AssessmentFolder -PathType Container)) {
    Write-Error "Assessment folder not found: $AssessmentFolder"
    return
}

$summaryPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Summary.csv'
if (-not (Test-Path -Path $summaryPath)) {
    Write-Error "Summary CSV not found: $summaryPath"
    return
}

if (-not $OutputPath) {
    $OutputPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Report.html'
}

# ------------------------------------------------------------------
# Load assessment data
# ------------------------------------------------------------------
$summary = Import-Csv -Path $summaryPath
$issueReportPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Issues.log'
$issueContent = if (Test-Path -Path $issueReportPath) { Get-Content -Path $issueReportPath -Raw } else { '' }

# Load Tenant Info CSV for organization profile card and cover page
$tenantCsv = Join-Path -Path $AssessmentFolder -ChildPath '01-Tenant-Info.csv'
$tenantData = $null
if (Test-Path -Path $tenantCsv) {
    $tenantData = Import-Csv -Path $tenantCsv
}

# Load User Summary for enriched organization profile
$userSummaryCsv = Join-Path -Path $AssessmentFolder -ChildPath '02-User-Summary.csv'
$userSummaryData = $null
if (Test-Path -Path $userSummaryCsv) {
    $userSummaryData = Import-Csv -Path $userSummaryCsv
}

if (-not $TenantName) {
    if ($tenantData -and $tenantData[0].PSObject.Properties.Name -contains 'OrgDisplayName') {
        $TenantName = $tenantData[0].OrgDisplayName
    }
    elseif ($tenantData -and $tenantData[0].PSObject.Properties.Name -contains 'DefaultDomain') {
        $TenantName = $tenantData[0].DefaultDomain
    }
    else {
        $TenantName = 'M365 Tenant'
    }
}

# Read assessment version from log if available
$assessmentVersion = '0.3.0'
$logPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Log.txt'
if (Test-Path -Path $logPath) {
    $logHead = Get-Content -Path $logPath -TotalCount 10
    $versionLine = $logHead | Where-Object { $_ -match 'Version:\s+v(.+)' }
    if ($versionLine) {
        $assessmentVersion = $Matches[1]
    }
}

# Get assessment date from folder name
$folderName = Split-Path -Leaf $AssessmentFolder
$assessmentDate = Get-Date -Format 'MMMM d, yyyy'
if ($folderName -match 'Assessment_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})') {
    $assessmentDate = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Format 'MMMM d, yyyy'
}

# ------------------------------------------------------------------
# Load and base64-encode logo
# ------------------------------------------------------------------
$logoBase64 = ''
$logoPath = Join-Path -Path $projectRoot -ChildPath 'Common\assets\m365-assess-logo.png'
if (Test-Path -Path $logoPath) {
    $logoBytes = [System.IO.File]::ReadAllBytes($logoPath)
    $logoBase64 = [Convert]::ToBase64String($logoBytes)
}

$waveBase64 = ''
$wavePath = Join-Path -Path $projectRoot -ChildPath 'Common\assets\m365-assess-bg.png'
if (Test-Path -Path $wavePath) {
    $waveBytes = [System.IO.File]::ReadAllBytes($wavePath)
    $waveBase64 = [Convert]::ToBase64String($waveBytes)
}

# ------------------------------------------------------------------
# Compute summary statistics
# ------------------------------------------------------------------
$completeCount = @($summary | Where-Object { $_.Status -eq 'Complete' }).Count
$skippedCount = @($summary | Where-Object { $_.Status -eq 'Skipped' }).Count
$failedCount = @($summary | Where-Object { $_.Status -eq 'Failed' }).Count
$totalCollectors = $summary.Count
$sections = @($summary | Select-Object -ExpandProperty Section -Unique)

# Parse issues from the log file
$issues = [System.Collections.Generic.List[PSCustomObject]]::new()
if ($issueContent) {
    $issueBlocks = $issueContent -split '---\s+Issue\s+\d+\s*/\s*\d+\s+-+'
    foreach ($block in $issueBlocks) {
        if ($block -match 'Severity:\s+(.+)') {
            $severity = $Matches[1].Trim()
            $section = if ($block -match 'Section:\s+(.+)') { $Matches[1].Trim() } else { '' }
            $collector = if ($block -match 'Collector:\s+(.+)') { $Matches[1].Trim() } else { '' }
            $description = if ($block -match 'Description:\s+(.+)') { $Matches[1].Trim() } else { '' }
            $errorMsg = if ($block -match 'Error:\s+(.+)') { $Matches[1].Trim() } else { '' }
            $action = if ($block -match 'Action:\s+(.+)') { $Matches[1].Trim() } else { '' }
            $issues.Add([PSCustomObject]@{
                Severity    = $severity
                Section     = $section
                Collector   = $collector
                Description = $description
                Error       = $errorMsg
                Action      = $action
            })
        }
    }
}

$errorCount = @($issues | Where-Object { $_.Severity -eq 'ERROR' }).Count
$warningCount = @($issues | Where-Object { $_.Severity -eq 'WARNING' }).Count

# ------------------------------------------------------------------
# HTML helper functions
# ------------------------------------------------------------------
function ConvertTo-HtmlSafe {
    param([string]$Text)
    if (-not $Text) { return '' }
    return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

function Get-StatusBadge {
    param([string]$Status)
    switch ($Status) {
        'Complete' { '<span class="badge badge-complete">Complete</span>' }
        'Skipped'  { '<span class="badge badge-skipped">Skipped</span>' }
        'Failed'   { '<span class="badge badge-failed">Failed</span>' }
        default    { "<span class='badge'>$Status</span>" }
    }
}

function Format-ColumnHeader {
    param([string]$Name)
    if (-not $Name) { return $Name }
    # Insert space between lowercase/digit and uppercase: "createdDate" → "created Date"
    # CRITICAL: Use -creplace (case-sensitive) — default -replace is case-insensitive
    $spaced = $Name -creplace '([a-z\d])([A-Z])', '$1 $2'
    # Insert space between consecutive uppercase and uppercase+lowercase: "MFAStatus" → "MFA Status"
    $spaced = $spaced -creplace '([A-Z]+)([A-Z][a-z])', '$1 $2'
    return $spaced
}

function Get-SeverityBadge {
    param([string]$Severity)
    switch ($Severity) {
        'ERROR'   { '<span class="badge badge-failed">ERROR</span>' }
        'WARNING' { '<span class="badge badge-warning">WARNING</span>' }
        'INFO'    { '<span class="badge badge-info">INFO</span>' }
        default   { "<span class='badge'>$Severity</span>" }
    }
}

# ------------------------------------------------------------------
# Smart sorting helper — prioritize actionable rows
# ------------------------------------------------------------------
function Get-SmartSortedData {
    param(
        [array]$Data,
        [string]$CollectorName
    )

    if (-not $Data -or $Data.Count -le 1) { return $Data }

    $columns = @($Data[0].PSObject.Properties.Name)

    # Security Config collectors: sort non-passing items first
    if ($columns -contains 'Status' -and $columns -contains 'CisControl') {
        $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Unknown' = 3; 'Pass' = 4 }
        return @($Data | Sort-Object -Property @{
            Expression = { if ($null -ne $statusPriority[$_.Status]) { $statusPriority[$_.Status] } else { 5 } }
        }, 'Category', 'Setting')
    }

    # MFA Report: show users without MFA enforcement first, admins first
    if ($CollectorName -match 'MFA') {
        $mfaStatusCol = $columns | Where-Object { $_ -match 'MFAStatus|MfaStatus|StrongAuth' }
        $adminCol = $columns | Where-Object { $_ -match 'Admin|Role|IsAdmin' }
        if ($mfaStatusCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$mfaStatusCol -match 'Enforced|Enabled') { 1 } else { 0 } }
            }, @{
                Expression = { if ($adminCol -and $_.$adminCol -and $_.$adminCol -ne 'None' -and $_.$adminCol -ne '' -and $_.$adminCol -ne 'False') { 0 } else { 1 } }
            })
        }
    }

    # Device Summary: non-compliant and non-enrolled devices first
    if ($CollectorName -match 'Device') {
        $complianceCol = $columns | Where-Object { $_ -match 'Complian' }
        $enrollCol = $columns | Where-Object { $_ -match 'Enroll|Managed|MDM' }
        if ($complianceCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$complianceCol -match 'Compliant|compliant') { 1 } else { 0 } }
            })
        }
        if ($enrollCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$enrollCol -match 'True|Yes|Enrolled') { 1 } else { 0 } }
            })
        }
    }

    # User Summary: disabled and inactive accounts first
    if ($CollectorName -match 'User Summary') {
        $enabledCol = $columns | Where-Object { $_ -match 'AccountEnabled|Enabled' }
        if ($enabledCol) {
            $signInCol = $columns | Where-Object { $_ -match 'LastSignIn|LastLogin' }
            if ($signInCol) {
                return @($Data | Sort-Object -Property @{
                    Expression = { if ($_.$enabledCol -match 'True|Yes') { 1 } else { 0 } }
                }, $signInCol)
            }
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$enabledCol -match 'True|Yes') { 1 } else { 0 } }
            })
        }
    }

    # Security Config collectors without CIS (Status column present)
    if ($columns -contains 'Status' -and $columns -contains 'RecommendedValue') {
        $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Unknown' = 3; 'Pass' = 4 }
        return @($Data | Sort-Object -Property @{
            Expression = { if ($null -ne $statusPriority[$_.Status]) { $statusPriority[$_.Status] } else { 5 } }
        })
    }

    return $Data
}

# ------------------------------------------------------------------
# Build section data tables
# ------------------------------------------------------------------
$sectionHtml = [System.Text.StringBuilder]::new()

$sectionDescriptions = @{
    'Tenant'        = 'Organization profile, verified domains, and core tenant configuration. This baseline identifies the environment and confirms tenant-level settings.'
    'Identity'      = 'User accounts, MFA enrollment, admin roles, conditional access policies, and password policies. Identity is the primary attack surface &mdash; these controls determine who can access your environment and how they authenticate.'
    'Licensing'     = 'Microsoft 365 license allocation and utilization. Understanding license distribution helps identify unused spend and ensures users have the entitlements needed for security features like Defender and Intune.'
    'Email'         = 'Mailbox configuration, mail flow rules, email authentication (SPF/DKIM/DMARC), and Exchange Online security settings. Email remains the #1 attack vector &mdash; these controls protect against phishing, spoofing, and data exfiltration.'
    'Intune'        = 'Device enrollment, compliance policies, and configuration profiles. Intune controls ensure corporate devices meet security baselines and that non-compliant devices are restricted from accessing company data.'
    'Security'      = 'Microsoft Secure Score, Defender for Office 365 policies, and Data Loss Prevention rules. These controls provide defense-in-depth against malware, ransomware, and accidental data leakage.'
    'Collaboration' = 'SharePoint, OneDrive, and Microsoft Teams configuration and access settings. Collaboration tools are where sensitive data lives &mdash; these controls govern sharing, guest access, and external communication.'
    'Hybrid'        = 'On-premises Active Directory synchronization and hybrid identity configuration. Hybrid sync health directly impacts authentication reliability and determines which identities are managed in the cloud vs. on-premises.'
    'Inventory'     = 'Per-object inventory of mailboxes, distribution lists, Microsoft 365 groups, Teams, SharePoint sites, and OneDrive accounts. Designed for M&amp;A due diligence, migration planning, and tenant-wide asset enumeration.'
}

foreach ($sectionName in $sections) {
    $sectionCollectors = @($summary | Where-Object { $_.Section -eq $sectionName })

    # ------------------------------------------------------------------
    # Tenant Info — non-collapsible organization profile card
    # ------------------------------------------------------------------
    if ($sectionName -eq 'Tenant' -and $tenantData) {
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
                # Keep raw value if parsing fails
            }
        }

        # Parse all verified domains — separate custom from system domains
        $allDomains = @()
        $customDomains = @()
        $systemDomains = @()
        if ($verifiedDomains) {
            $allDomains = @($verifiedDomains -split ';\s*' | Where-Object { $_ } | Sort-Object)
            $customDomains = @($allDomains | Where-Object {
                $_ -notmatch '\.onmicrosoft\.com$' -and $_ -notmatch '\.excl\.cloud$'
            })
            $systemDomains = @($allDomains | Where-Object {
                $_ -match '\.onmicrosoft\.com$' -or $_ -match '\.excl\.cloud$'
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

        $null = $sectionHtml.AppendLine("<div class='tenant-card' id='section-tenant'>")
        $null = $sectionHtml.AppendLine("<h2 class='tenant-heading'>Organization Profile</h2>")
        $null = $sectionHtml.AppendLine("<div class='tenant-org-name'>$(ConvertTo-HtmlSafe -Text $orgName)</div>")

        # Primary facts row
        $null = $sectionHtml.AppendLine("<div class='tenant-facts'>")
        if ($defaultDomain) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Primary Domain</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $defaultDomain)</span></div>")
        }
        if ($createdDisplay) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Established</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $createdDisplay)</span></div>")
        }
        if ($secDefaults) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Security Defaults</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $secDefaults)</span></div>")
        }
        $null = $sectionHtml.AppendLine("</div>")

        # Secondary facts row — Tenant ID + User counts
        $null = $sectionHtml.AppendLine("<div class='tenant-facts tenant-facts-secondary'>")
        if ($tenantId) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Tenant ID</span><span class='fact-value tenant-id-val'>$(ConvertTo-HtmlSafe -Text $tenantId)</span></div>")
        }
        if ($totalUsers) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Total Users</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $totalUsers)</span></div>")
        }
        if ($licensedUsers) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Licensed Users</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $licensedUsers)</span></div>")
        }
        $null = $sectionHtml.AppendLine("</div>")

        # Verified Domains — show all with custom domains prominent, system domains dimmed
        if ($allDomains.Count -gt 0) {
            $null = $sectionHtml.AppendLine("<div class='tenant-domains'>")
            $null = $sectionHtml.AppendLine("<span class='fact-label'>Verified Domains ($($allDomains.Count))</span>")
            $null = $sectionHtml.AppendLine("<div class='domain-list'>")
            foreach ($d in $customDomains) {
                $null = $sectionHtml.AppendLine("<span class='domain-tag'>$(ConvertTo-HtmlSafe -Text $d)</span>")
            }
            foreach ($d in $systemDomains) {
                $null = $sectionHtml.AppendLine("<span class='domain-tag domain-system'>$(ConvertTo-HtmlSafe -Text $d)</span>")
            }
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")
        }

        # Assessment metadata bar
        $null = $sectionHtml.AppendLine("<div class='tenant-meta'>")
        $null = $sectionHtml.AppendLine("<span>Assessment Date: $assessmentDate</span>")
        $null = $sectionHtml.AppendLine("<span>Scope: $($sections.Count) Sections &middot; $totalCollectors Configuration Areas</span>")
        $null = $sectionHtml.AppendLine("<span>Generated by M365 Assess</span>")
        $null = $sectionHtml.AppendLine("</div>")
        $null = $sectionHtml.AppendLine("</div>")

        continue
    }

    $sectionId = ($sectionName -replace '[^a-zA-Z0-9]', '-').ToLower()
    $null = $sectionHtml.AppendLine("<details class='section' id='section-$sectionId' open>")
    $null = $sectionHtml.AppendLine("<summary><h2>$([System.Web.HttpUtility]::HtmlEncode($sectionName))</h2></summary>")

    $sectionDesc = $sectionDescriptions[$sectionName]
    if ($sectionDesc) {
        $null = $sectionHtml.AppendLine("<p class='section-description'>$sectionDesc</p>")
    }

    # Summary table for this section
    $null = $sectionHtml.AppendLine("<table class='summary-table'>")
    $null = $sectionHtml.AppendLine("<thead><tr><th>Collector</th><th>Status</th><th>Items</th><th>Duration</th><th>Notes</th></tr></thead>")
    $null = $sectionHtml.AppendLine("<tbody>")

    foreach ($c in $sectionCollectors) {
        $badge = Get-StatusBadge -Status $c.Status
        $notes = if ($c.Error) { ConvertTo-HtmlSafe -Text $c.Error } else { '' }
        $null = $sectionHtml.AppendLine("<tr>")
        $null = $sectionHtml.AppendLine("<td>$(ConvertTo-HtmlSafe -Text $c.Collector)</td>")
        $null = $sectionHtml.AppendLine("<td>$badge</td>")
        $null = $sectionHtml.AppendLine("<td class='num'>$($c.Items)</td>")
        $null = $sectionHtml.AppendLine("<td class='num'>$($c.Duration)</td>")
        $null = $sectionHtml.AppendLine("<td class='notes'>$notes</td>")
        $null = $sectionHtml.AppendLine("</tr>")
    }

    $null = $sectionHtml.AppendLine("</tbody></table>")

    # Data tables for each collector
    foreach ($c in $sectionCollectors) {
        if ($c.Status -ne 'Complete' -or [int]$c.Items -eq 0) { continue }

        $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $c.FileName
        if (-not (Test-Path -Path $csvFile)) { continue }

        $data = Import-Csv -Path $csvFile
        if (-not $data -or @($data).Count -eq 0) { continue }

        $columns = @($data[0].PSObject.Properties.Name)
        $isSecurityConfig = ($columns -contains 'CisControl') -and ($columns -contains 'Status')

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
                $avgCompare = [math]::Round([double]$score.AverageComparativeScore, 1)
            }

            $scoreColor = if ($pctRaw -ge 80) { '#2ecc71' } elseif ($pctRaw -ge 60) { '#f39c12' } else { '#e74c3c' }

            $null = $sectionHtml.AppendLine("<div class='exec-summary'>")
            $null = $sectionHtml.AppendLine("<div class='stat-card' style='border-top-color: $scoreColor;'><div class='stat-value' style='color: $scoreColor;'>$pctRaw%</div><div class='stat-label'>Secure Score</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card info'><div class='stat-value'>$currentPts</div><div class='stat-label'>Points Earned</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card'><div class='stat-value'>$maxPts</div><div class='stat-label'>Points Possible</div></div>")
            if ($null -ne $avgCompare) {
                $compColor = if ($pctRaw -ge $avgCompare) { '#2ecc71' } else { '#f39c12' }
                $null = $sectionHtml.AppendLine("<div class='stat-card' style='border-top-color: $compColor;'><div class='stat-value' style='color: $compColor;'>$avgCompare%</div><div class='stat-label'>M365 Average</div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>")

            # Progress bar
            $null = $sectionHtml.AppendLine("<div class='score-bar-track'><div class='score-bar-fill' style='width: $pctRaw%; background: $scoreColor;'></div></div>")
        }

        # ----------------------------------------------------------
        # User Summary — MFA adoption stat cards before table
        # ----------------------------------------------------------
        if ($c.FileName -eq '02-User-Summary.csv') {
            $users = $data[0]
            $uProps = @($users.PSObject.Properties.Name)
            $totalUsers = if ($uProps -contains 'TotalUsers') { [int]$users.TotalUsers } else { 0 }
            $licensedUsers = if ($uProps -contains 'Licensed') { $users.Licensed } else { '' }
            $guestUsers = if ($uProps -contains 'GuestUsers') { $users.GuestUsers } else { '' }

            # Load per-user MFA Report for accurate adoption metrics
            $mfaCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '03-MFA-Report.csv'
            $mfaCapable = 0; $mfaRegistered = 0
            $ssprCapable = 0; $ssprRegistered = 0
            if (Test-Path -Path $mfaCsvPath) {
                $mfaData = @(Import-Csv -Path $mfaCsvPath)
                $mfaCapable    = @($mfaData | Where-Object { $_.IsMfaCapable -eq 'True' }).Count
                $mfaRegistered = @($mfaData | Where-Object { $_.IsMfaCapable -eq 'True' -and $_.IsMfaRegistered -eq 'True' }).Count
                $ssprCapable    = @($mfaData | Where-Object { $_.IsSsprCapable -eq 'True' }).Count
                $ssprRegistered = @($mfaData | Where-Object { $_.IsSsprCapable -eq 'True' -and $_.IsSsprRegistered -eq 'True' }).Count
            }

            $mfaPct = if ($mfaCapable -gt 0) { [math]::Round(($mfaRegistered / $mfaCapable) * 100, 1) } else { 0 }
            $mfaColor = if ($mfaPct -ge 90) { '#2ecc71' } elseif ($mfaPct -ge 70) { '#f39c12' } else { '#e74c3c' }

            $ssprPct = if ($ssprCapable -gt 0) { [math]::Round(($ssprRegistered / $ssprCapable) * 100, 1) } else { 0 }
            $ssprColor = if ($ssprPct -ge 90) { '#2ecc71' } elseif ($ssprPct -ge 70) { '#f39c12' } else { '#e74c3c' }

            $null = $sectionHtml.AppendLine("<div class='exec-summary'>")
            $null = $sectionHtml.AppendLine("<div class='stat-card info'><div class='stat-value'>$totalUsers</div><div class='stat-label'>Total Users</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card info'><div class='stat-value'>$licensedUsers</div><div class='stat-label'>Licensed</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card' style='border-top-color: $mfaColor;'><div class='stat-value' style='color: $mfaColor;'>$mfaPct%</div><div class='stat-label'>MFA Adoption</div><div class='stat-detail'>$mfaRegistered / $mfaCapable capable</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card' style='border-top-color: $ssprColor;'><div class='stat-value' style='color: $ssprColor;'>$ssprPct%</div><div class='stat-label'>SSPR Enrolled</div><div class='stat-detail'>$ssprRegistered / $ssprCapable capable</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card info'><div class='stat-value'>$guestUsers</div><div class='stat-label'>Guest Users</div></div>")
            $null = $sectionHtml.AppendLine("</div>")
        }

        # ----------------------------------------------------------
        # Standard data table rendering
        # ----------------------------------------------------------
        $rowCount = @($data).Count
        $null = $sectionHtml.AppendLine("<details class='collector-detail'>")
        $null = $sectionHtml.AppendLine("<summary><h3>$(ConvertTo-HtmlSafe -Text $c.Collector) <span class='row-count'>($rowCount rows)</span></h3></summary>")

        $null = $sectionHtml.AppendLine("<div class='table-wrapper'>")
        $null = $sectionHtml.AppendLine("<table class='data-table'>")
        $null = $sectionHtml.AppendLine("<thead><tr>")
        foreach ($col in $columns) {
            $displayCol = Format-ColumnHeader -Name $col
            $null = $sectionHtml.AppendLine("<th>$(ConvertTo-HtmlSafe -Text $displayCol)</th>")
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
                    'Fail'    { " class='cis-row-fail'" }
                    'Warning' { " class='cis-row-warning'" }
                    'Review'  { " class='cis-row-review'" }
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
                # Security config Status column — add badge styling
                if ($isSecurityConfig -and $col -eq 'Status') {
                    $badgeClass = switch ($val) {
                        'Pass'    { 'badge-complete' }
                        'Fail'    { 'badge-failed' }
                        'Warning' { 'badge-warning' }
                        'Review'  { 'badge-info' }
                        'Unknown' { 'badge-skipped' }
                        default   { '' }
                    }
                    if ($badgeClass) {
                        $val = "<span class='badge $badgeClass'>$val</span>"
                    }
                }
                $null = $sectionHtml.AppendLine("<td>$val</td>")
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
# Build CIS Compliance Summary
# ------------------------------------------------------------------
$cisHtml = [System.Text.StringBuilder]::new()
$allCisFindings = [System.Collections.Generic.List[PSCustomObject]]::new()

# Scan all completed collector CSVs for CIS-mapped findings
foreach ($c in $summary) {
    if ($c.Status -ne 'Complete' -or [int]$c.Items -eq 0) { continue }
    $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $c.FileName
    if (-not (Test-Path -Path $csvFile)) { continue }

    $data = Import-Csv -Path $csvFile
    if (-not $data -or @($data).Count -eq 0) { continue }

    $columns = @($data[0].PSObject.Properties.Name)
    if ($columns -notcontains 'CisControl') { continue }

    foreach ($row in $data) {
        if (-not $row.CisControl -or $row.CisControl -eq '') { continue }
        $allCisFindings.Add([PSCustomObject]@{
            CisControl   = $row.CisControl
            Category     = $row.Category
            Setting      = $row.Setting
            CurrentValue = $row.CurrentValue
            Recommended  = $row.RecommendedValue
            Status       = $row.Status
            Remediation  = $row.Remediation
            Source       = $c.Collector
        })
    }
}

if ($allCisFindings.Count -gt 0) {
    # Calculate CIS compliance score (exclude Unknown from denominator)
    $cisPass = @($allCisFindings | Where-Object { $_.Status -eq 'Pass' }).Count
    $cisFail = @($allCisFindings | Where-Object { $_.Status -eq 'Fail' }).Count
    $cisWarn = @($allCisFindings | Where-Object { $_.Status -eq 'Warning' }).Count
    $cisReview = @($allCisFindings | Where-Object { $_.Status -eq 'Review' }).Count
    $knownStatuses = @('Pass', 'Fail', 'Warning', 'Review')
    $cisUnknown = @($allCisFindings | Where-Object { $_.Status -notin $knownStatuses }).Count
    $cisTotal = $allCisFindings.Count
    $cisScored = $cisTotal - $cisUnknown
    $cisScore = if ($cisScored -gt 0) { [math]::Round(($cisPass / $cisScored) * 100, 1) } else { 0 }
    $scoreDisplay = if ($cisScored -gt 0) { "$cisScore%" } else { 'N/A' }

    # Non-passing findings sorted by severity then control ID
    $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Unknown' = 3; 'Pass' = 4 }
    $nonPassing = @($allCisFindings | Where-Object { $_.Status -ne 'Pass' } |
        Sort-Object -Property @{ Expression = { if ($null -ne $statusPriority[$_.Status]) { $statusPriority[$_.Status] } else { 5 } } }, 'CisControl')

    $null = $cisHtml.AppendLine("<details class='section' open>")
    $null = $cisHtml.AppendLine("<summary><h2>CIS Microsoft 365 Benchmark &mdash; Compliance Summary</h2></summary>")
    $null = $cisHtml.AppendLine("<p>The following findings are mapped to the <strong>CIS Microsoft 365 Foundations Benchmark v6.0.1</strong>. This section highlights areas requiring attention, ordered by severity.</p>")

    # Informational disclaimer
    $null = $cisHtml.AppendLine("<div class='cis-disclaimer'>")
    $null = $cisHtml.AppendLine("<strong>Informational Notice</strong>")
    $null = $cisHtml.AppendLine("<p>This CIS benchmark assessment is provided for <strong>informational purposes only</strong> and does not constitute a comprehensive security assessment, audit, or certification. Results reflect a subset of the 140 CIS controls checked via automated methods at a point in time and should not be considered conclusive. For a thorough security evaluation, consider engaging a qualified security professional for penetration testing and full compliance review.</p>")
    $null = $cisHtml.AppendLine("</div>")

    # Score overview cards
    $cisBenchmarkTotal = 140 # CIS v6.0.1 total — update when benchmark version changes
    $scoreColor = if ($cisScored -eq 0) { 'var(--m365a-medium-gray)' } elseif ($cisScore -ge 80) { '#2ecc71' } elseif ($cisScore -ge 60) { '#f39c12' } else { '#e74c3c' }
    $warnReviewDisplay = @()
    if ($cisWarn -gt 0) { $warnReviewDisplay += "$cisWarn Warning" }
    if ($cisReview -gt 0) { $warnReviewDisplay += "$cisReview Review" }
    if ($cisUnknown -gt 0) { $warnReviewDisplay += "$cisUnknown Unknown" }
    $warnReviewLabel = ($warnReviewDisplay -join ' + ')
    $warnReviewTotal = $cisWarn + $cisReview + $cisUnknown

    $null = $cisHtml.AppendLine("<div class='exec-summary'>")
    $null = $cisHtml.AppendLine("<div class='stat-card' style='border-top-color: $scoreColor;'><div class='stat-value' style='color: $scoreColor;'>$scoreDisplay</div><div class='stat-label'>Compliance Score</div></div>")
    $null = $cisHtml.AppendLine("<div class='stat-card' style='border-top-color: var(--m365a-medium-gray);'><div class='stat-value'>$cisBenchmarkTotal</div><div class='stat-label'>Benchmark Total</div></div>")
    $null = $cisHtml.AppendLine("<div class='stat-card info'><div class='stat-value'>$cisTotal</div><div class='stat-label'>Assessed</div></div>")
    $null = $cisHtml.AppendLine("<div class='stat-card success'><div class='stat-value'>$cisPass</div><div class='stat-label'>Pass</div></div>")
    $null = $cisHtml.AppendLine("<div class='stat-card error'><div class='stat-value'>$cisFail</div><div class='stat-label'>Fail</div></div>")
    if ($warnReviewTotal -gt 0) {
        $null = $cisHtml.AppendLine("<div class='stat-card warning'><div class='stat-value'>$warnReviewTotal</div><div class='stat-label'>$warnReviewLabel</div></div>")
    }
    $null = $cisHtml.AppendLine("</div>")

    # Areas of Improvement table (non-passing only)
    if ($nonPassing.Count -gt 0) {
        $null = $cisHtml.AppendLine("<details class='collector-detail' open>")
        $null = $cisHtml.AppendLine("<summary><h3>Areas of Improvement <span class='row-count'>($($nonPassing.Count) findings)</span></h3></summary>")
        $null = $cisHtml.AppendLine("<div class='table-wrapper'>")
        $null = $cisHtml.AppendLine("<table class='data-table cis-table'>")
        $null = $cisHtml.AppendLine("<thead><tr><th>CIS Control</th><th>Status</th><th>Setting</th><th>Current Value</th><th>Recommended</th><th>Remediation</th></tr></thead>")
        $null = $cisHtml.AppendLine("<tbody>")

        foreach ($finding in $nonPassing) {
            $statusClass = switch ($finding.Status) {
                'Fail'    { 'badge-failed' }
                'Warning' { 'badge-warning' }
                'Review'  { 'badge-info' }
                'Unknown' { 'badge-skipped' }
                default   { '' }
            }
            $statusBadge = "<span class='badge $statusClass'>$($finding.Status)</span>"
            $cisRef = ConvertTo-HtmlSafe -Text $finding.CisControl
            $settingText = ConvertTo-HtmlSafe -Text $finding.Setting
            $currentVal = ConvertTo-HtmlSafe -Text $finding.CurrentValue
            $recommended = ConvertTo-HtmlSafe -Text $finding.Recommended
            $remediation = ConvertTo-HtmlSafe -Text $finding.Remediation

            $null = $cisHtml.AppendLine("<tr class='cis-row-$($finding.Status.ToLower())'>")
            $null = $cisHtml.AppendLine("<td class='cis-id'>$cisRef</td>")
            $null = $cisHtml.AppendLine("<td>$statusBadge</td>")
            $null = $cisHtml.AppendLine("<td>$settingText</td>")
            $null = $cisHtml.AppendLine("<td>$currentVal</td>")
            $null = $cisHtml.AppendLine("<td>$recommended</td>")
            $null = $cisHtml.AppendLine("<td class='remediation-cell'>$remediation</td>")
            $null = $cisHtml.AppendLine("</tr>")
        }

        $null = $cisHtml.AppendLine("</tbody></table>")
        $null = $cisHtml.AppendLine("</div>")
        $null = $cisHtml.AppendLine("</details>")
    }

    # Passing controls summary (collapsed)
    if ($cisPass -gt 0) {
        $null = $cisHtml.AppendLine("<h3>Passing Controls ($cisPass)</h3>")
        $null = $cisHtml.AppendLine("<p class='truncated'>$cisPass controls meet CIS benchmark recommendations. See the detailed section data tables above for full configuration details.</p>")
    }

    $null = $cisHtml.AppendLine("<p class='truncated'>Reference: <a href='https://www.cisecurity.org/benchmark/microsoft_365'>CIS Microsoft 365 Foundations Benchmark v6.0.1</a></p>")
    $null = $cisHtml.AppendLine("</details>")
}

# ------------------------------------------------------------------
# Build issues HTML
# ------------------------------------------------------------------
$issuesHtml = [System.Text.StringBuilder]::new()
if ($issues.Count -gt 0) {
    $null = $issuesHtml.AppendLine("<details class='section' open>")
    $null = $issuesHtml.AppendLine("<summary><h2>Technical Issues</h2></summary>")
    $null = $issuesHtml.AppendLine("<table class='data-table'>")
    $null = $issuesHtml.AppendLine("<thead><tr><th>Severity</th><th>Section</th><th>Collector</th><th>Description</th><th>Recommended Action</th></tr></thead>")
    $null = $issuesHtml.AppendLine("<tbody>")

    foreach ($issue in $issues) {
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

# Append conditional entries to TOC now that CIS/Issues counts are known
if ($allCisFindings.Count -gt 0) {
    $null = $tocHtml.AppendLine("<li><a href='#cis-compliance'>CIS Compliance Summary</a></li>")
}
if ($issues.Count -gt 0) {
    $null = $tocHtml.AppendLine("<li><a href='#issues'>Technical Issues</a></li>")
}
$null = $tocHtml.AppendLine("</ol>")
$null = $tocHtml.AppendLine("</nav>")

# ------------------------------------------------------------------
# Assemble full HTML document
# ------------------------------------------------------------------
$coverBgStyle = if ($waveBase64) {
    "background-image: url('data:image/png;base64,$waveBase64'); background-size: cover; background-position: center;"
} else {
    'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);'
}

$logoImgTag = if ($logoBase64) {
    "<img src='data:image/png;base64,$logoBase64' alt='M365 Assess' class='cover-logo' />"
} else {
    "<div class='cover-logo-text'>M365 Assess</div>"
}

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M365 Assessment Report - $(ConvertTo-HtmlSafe -Text $TenantName)</title>
    <style>
        /* ----------------------------------------------------------
           M365 Assess Theme
           ---------------------------------------------------------- */
        :root {
            --m365a-primary: #2563EB;
            --m365a-dark-primary: #1D4ED8;
            --m365a-accent: #60A5FA;
            --m365a-dark: #0F172A;
            --m365a-dark-gray: #1E293B;
            --m365a-medium-gray: #64748B;
            --m365a-light-gray: #F1F5F9;
            --m365a-border: #CBD5E1;
            --m365a-white: #ffffff;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: var(--m365a-dark-gray);
            background: var(--m365a-white);
        }

        /* ----------------------------------------------------------
           Cover Page
           ---------------------------------------------------------- */
        .cover-page {
            width: 100%;
            min-height: 100vh;
            $coverBgStyle
            background-color: var(--m365a-dark);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            color: var(--m365a-white);
            page-break-after: always;
            padding: 60px 40px;
        }

        .cover-logo {
            max-width: 350px;
            height: auto;
            margin-bottom: 50px;
        }

        .cover-logo-text {
            font-size: 28pt;
            font-weight: bold;
            letter-spacing: 2px;
            margin-bottom: 50px;
        }

        .cover-title {
            font-size: 32pt;
            font-weight: 300;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 15px;
        }

        .cover-subtitle {
            font-size: 16pt;
            font-weight: 300;
            opacity: 0.9;
            margin-bottom: 8px;
        }

        .cover-tenant {
            font-size: 20pt;
            font-weight: 600;
            color: var(--m365a-primary);
            margin-top: 30px;
            margin-bottom: 15px;
        }

        .cover-date {
            font-size: 13pt;
            opacity: 0.7;
            margin-top: 10px;
        }

        .cover-divider {
            width: 80px;
            height: 3px;
            background: var(--m365a-primary);
            margin: 25px auto;
        }

        /* ----------------------------------------------------------
           Content Pages
           ---------------------------------------------------------- */
        .content {
            max-width: none;
            margin: 0 auto;
            padding: 40px 80px;
        }

        h1 {
            font-size: 22pt;
            color: var(--m365a-dark);
            border-bottom: 3px solid var(--m365a-primary);
            padding-bottom: 10px;
            margin: 40px 0 25px 0;
            page-break-after: avoid;
        }

        h2 {
            font-size: 16pt;
            color: var(--m365a-dark);
            border-left: 4px solid var(--m365a-primary);
            padding-left: 15px;
            margin: 35px 0 20px 0;
            page-break-after: avoid;
        }

        h3 {
            font-size: 12pt;
            color: var(--m365a-medium-gray);
            margin: 25px 0 12px 0;
            page-break-after: avoid;
        }

        .section-description {
            color: var(--m365a-medium-gray);
            font-size: 10pt;
            line-height: 1.6;
            margin: 0 0 15px 0;
            padding-left: 19px;
        }

        /* ----------------------------------------------------------
           Table of Contents
           ---------------------------------------------------------- */
        .report-toc {
            background: var(--m365a-white);
            border: 1px solid var(--m365a-border);
            border-radius: 6px;
            padding: 20px 30px 20px 30px;
            margin: 30px 0;
        }

        .toc-heading {
            font-size: 14pt;
            color: var(--m365a-dark);
            margin: 0 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--m365a-border);
            border-left: none;
            padding-left: 0;
        }

        .toc-list {
            columns: 2;
            column-gap: 40px;
            list-style: decimal;
            padding-left: 20px;
            margin: 0;
        }

        .toc-list li {
            padding: 4px 0;
            break-inside: avoid;
            font-size: 10.5pt;
        }

        .toc-list a {
            color: var(--m365a-dark);
            text-decoration: none;
            border-bottom: 1px dotted var(--m365a-border);
            transition: color 0.15s, border-color 0.15s;
        }

        .toc-list a:hover {
            color: var(--m365a-accent);
            border-bottom-color: var(--m365a-accent);
        }

        /* ----------------------------------------------------------
           Tenant Organization Card
           ---------------------------------------------------------- */
        .tenant-card {
            background: var(--m365a-light-gray);
            border-left: 4px solid var(--m365a-primary);
            border-radius: 0 8px 8px 0;
            padding: 25px 30px;
            margin-bottom: 30px;
        }

        .tenant-heading {
            font-size: 14pt;
            color: var(--m365a-dark);
            margin: 0 0 15px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--m365a-border);
            border-left: none;
            padding-left: 0;
        }

        .tenant-org-name {
            font-size: 22pt;
            font-weight: 700;
            color: var(--m365a-dark);
            margin-bottom: 15px;
        }

        .tenant-facts {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }

        .tenant-facts-secondary {
            margin-top: 12px;
        }

        .tenant-fact .fact-label {
            display: block;
            font-size: 8pt;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 2px;
        }

        .tenant-fact .fact-value {
            display: block;
            font-size: 11pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }

        .tenant-id-val {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 9.5pt !important;
            letter-spacing: 0.5px;
        }

        .tenant-domains {
            margin-top: 15px;
            padding-top: 12px;
            border-top: 1px solid var(--m365a-border);
        }

        .tenant-domains .fact-label {
            display: block;
            font-size: 8pt;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 8px;
        }

        .domain-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .domain-tag {
            display: inline-block;
            padding: 3px 10px;
            background: var(--m365a-white);
            border: 1px solid var(--m365a-border);
            border-radius: 4px;
            font-size: 9.5pt;
            font-weight: 500;
            color: var(--m365a-dark);
        }

        .domain-tag.domain-system {
            color: var(--m365a-medium-gray);
            border-style: dashed;
            font-size: 8.5pt;
        }

        .tenant-meta {
            margin-top: 15px;
            padding-top: 12px;
            border-top: 1px solid var(--m365a-border);
            display: flex;
            flex-wrap: wrap;
            gap: 8px 24px;
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
        }

        /* ----------------------------------------------------------
           Score Progress Bar
           ---------------------------------------------------------- */
        .score-bar-track {
            background: #e9ecef;
            border-radius: 8px;
            height: 12px;
            margin: 0 0 20px 0;
            overflow: hidden;
        }

        .score-bar-fill {
            height: 100%;
            border-radius: 8px;
        }

        /* ----------------------------------------------------------
           Executive Summary
           ---------------------------------------------------------- */
        .exec-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 25px 0;
        }

        .stat-card {
            background: var(--m365a-light-gray);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            border-top: 3px solid var(--m365a-primary);
        }

        .stat-card .stat-value {
            font-size: 28pt;
            font-weight: bold;
            color: var(--m365a-dark);
        }

        .stat-card .stat-label {
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 5px;
        }

        .stat-card .stat-detail {
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 3px;
        }

        .stat-card.success { border-top-color: #2ecc71; }
        .stat-card.warning { border-top-color: #f39c12; }
        .stat-card.error { border-top-color: var(--m365a-primary); }
        .stat-card.info { border-top-color: var(--m365a-accent); }

        .cis-disclaimer {
            background: #f0f7ff;
            border-left: 3px solid var(--m365a-accent);
            padding: 15px;
            margin: 15px 0;
            border-radius: 6px;
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
        }
        .cis-disclaimer strong { color: var(--m365a-dark); }
        .cis-disclaimer p { margin: 8px 0 0 0; }

        /* ----------------------------------------------------------
           Tables
           ---------------------------------------------------------- */
        .table-wrapper {
            overflow-x: auto;
            margin: 15px 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
            margin: 10px 0;
        }

        .summary-table { margin-bottom: 25px; }

        th {
            background: var(--m365a-dark);
            color: var(--m365a-white);
            padding: 10px 12px;
            text-align: left;
            font-weight: 600;
            font-size: 9pt;
            border-right: 1px solid rgba(255,255,255,0.2);
        }

        th:last-child { border-right: none; }

        td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--m365a-border);
            vertical-align: top;
        }

        tr:nth-child(even) { background: var(--m365a-light-gray); }
        tr:hover { background: #e8f4f8; }

        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .notes { color: var(--m365a-medium-gray); font-size: 9pt; }
        .truncated { color: var(--m365a-medium-gray); font-size: 9pt; font-style: italic; margin-top: 5px; }

        /* ----------------------------------------------------------
           Badges
           ---------------------------------------------------------- */
        .badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 8.5pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .badge-complete { background: #d4edda; color: #155724; }
        .badge-skipped { background: #e2e3e5; color: #383d41; }
        .badge-failed { background: #f8d7da; color: #721c24; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .badge-info { background: #d1ecf1; color: #0c5460; }

        /* ----------------------------------------------------------
           Section
           ---------------------------------------------------------- */
        .section {
            margin-bottom: 30px;
            page-break-inside: avoid;
        }

        /* Collapsible sections */
        details.section {
            border: 1px solid var(--m365a-border);
            border-radius: 6px;
            padding: 0 20px 0 20px;
        }

        details.section > summary {
            cursor: pointer;
            list-style: none;
            user-select: none;
        }

        details.section > summary::-webkit-details-marker { display: none; }

        details.section > summary h2 {
            position: relative;
            padding-right: 30px;
        }

        details.section > summary h2::after {
            content: '\25B6';
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            transition: transform 0.2s;
        }

        details[open].section > summary h2::after {
            transform: translateY(-50%) rotate(90deg);
        }

        details[open].section {
            padding-bottom: 20px;
        }

        .data-table td {
            max-width: 300px;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        /* Sortable column headers */
        .data-table th {
            cursor: pointer;
            user-select: none;
        }

        .data-table th:hover { background: #2a2a4e; }

        .data-table th::after {
            content: ' \2195';
            opacity: 0.3;
            font-size: 8pt;
        }

        .data-table th.sort-asc::after {
            content: ' \25B2';
            opacity: 0.8;
        }

        .data-table th.sort-desc::after {
            content: ' \25BC';
            opacity: 0.8;
        }

        /* Collapsible data sub-sections */
        .collector-detail {
            margin: 15px 0;
            border: 1px solid var(--m365a-border);
            border-radius: 4px;
        }

        .collector-detail > summary {
            cursor: pointer;
            list-style: none;
            padding: 8px 15px;
            background: var(--m365a-light-gray);
            border-radius: 4px;
            user-select: none;
        }

        .collector-detail > summary::-webkit-details-marker { display: none; }

        .collector-detail > summary h3 {
            display: inline;
            margin: 0;
            position: relative;
            padding-right: 24px;
        }

        .collector-detail > summary h3::after {
            content: '\25B6';
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            transition: transform 0.2s;
        }

        .collector-detail[open] > summary h3::after {
            transform: translateY(-50%) rotate(90deg);
        }

        .collector-detail[open] > summary {
            border-radius: 4px 4px 0 0;
            border-bottom: 1px solid var(--m365a-border);
        }

        .row-count {
            font-weight: normal;
            color: var(--m365a-medium-gray);
            font-size: 9pt;
        }

        /* Scrollable data tables — max ~25 rows visible */
        .collector-detail .table-wrapper {
            max-height: 800px;
            overflow-y: auto;
            overflow-x: auto;
        }

        .collector-detail .data-table thead th {
            position: sticky;
            top: 0;
            z-index: 1;
        }

        /* CIS Compliance */
        .cis-table .cis-id {
            font-family: 'Consolas', 'Courier New', monospace;
            font-weight: 700;
            color: var(--m365a-dark);
            white-space: nowrap;
        }

        .cis-table .remediation-cell {
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            max-width: 350px;
        }

        .cis-row-fail { border-left: 3px solid var(--m365a-primary); background-color: #fef2f2 !important; }
        .cis-row-warning { border-left: 3px solid #f39c12; background-color: #fffbeb !important; }
        .cis-row-review { border-left: 3px solid var(--m365a-accent); background-color: #f0f9ff !important; }
        .cis-row-unknown { border-left: 3px solid var(--m365a-medium-gray); background-color: #f9fafb !important; }

        /* ----------------------------------------------------------
           Footer
           ---------------------------------------------------------- */
        .report-footer {
            margin-top: 50px;
            padding: 20px 0;
            border-top: 2px solid var(--m365a-border);
            text-align: center;
            color: var(--m365a-medium-gray);
            font-size: 9pt;
        }

        .report-footer .m365a-name {
            color: var(--m365a-primary);
            font-weight: 600;
        }

        /* ----------------------------------------------------------
           Print Styles
           ---------------------------------------------------------- */
        @media print {
            body { font-size: 9pt; }

            .cover-page {
                min-height: auto;
                height: 100vh;
                page-break-after: always;
            }

            .content { padding: 20px 30px; }

            h1 { font-size: 18pt; margin-top: 20px; }
            h2 { font-size: 14pt; margin-top: 20px; }

            table { font-size: 8pt; }
            th { padding: 6px 8px; }
            td { padding: 5px 8px; }

            .exec-summary { grid-template-columns: repeat(4, 1fr); }
            .report-toc { page-break-inside: avoid; page-break-after: always; }
            .toc-list { columns: 1; }
            .tenant-card { page-break-inside: avoid; }
            .tenant-facts { grid-template-columns: repeat(3, 1fr); }
            .tenant-meta { font-size: 8pt; }
            .domain-tag { font-size: 8pt; padding: 2px 6px; }

            .section { page-break-inside: auto; }
            details.section { border: none; padding: 0; }
            details.section > summary { pointer-events: none; }
            details.section > summary h2::after { display: none; }
            details:not([open]) > *:not(summary) { display: block !important; }
            .collector-detail { border: none; }
            .collector-detail > summary { pointer-events: none; background: none; border: none; }
            .collector-detail > summary h3::after { display: none; }
            .collector-detail .table-wrapper { max-height: none !important; overflow: visible !important; }
            .data-table th::after { display: none; }
            .data-table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }

            @page {
                size: letter;
                margin: 0.75in;
            }

            @page :first {
                margin: 0;
            }
        }
    </style>
</head>
<body>
    <!-- Cover Page -->
    <div class="cover-page">
        $logoImgTag
        <div class="cover-title">M365 Environment</div>
        <div class="cover-title" style="margin-top: 0;">Assessment Report</div>
        <div class="cover-divider"></div>
        <div class="cover-tenant">$(ConvertTo-HtmlSafe -Text $TenantName)</div>
        <div class="cover-subtitle">$assessmentDate</div>
        <div class="cover-date">v$assessmentVersion</div>
    </div>

    <!-- Content -->
    <div class="content">
        <!-- Executive Summary -->
        <h1>Executive Summary</h1>
        <p>This report summarizes the findings of the Microsoft 365 environment assessment
        conducted for <strong>$(ConvertTo-HtmlSafe -Text $TenantName)</strong> on
        <strong>$assessmentDate</strong>. The assessment evaluated
        <strong>$totalCollectors</strong> configuration areas across
        <strong>$($sections.Count)</strong> sections.</p>

        <div class="exec-summary">
            <div class="stat-card info">
                <div class="stat-value">$($sections.Count)</div>
                <div class="stat-label">Sections</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">$completeCount</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-value">$skippedCount</div>
                <div class="stat-label">Skipped</div>
            </div>
            <div class="stat-card error">
                <div class="stat-value">$failedCount</div>
                <div class="stat-label">Failed</div>
            </div>
        </div>
"@

if ($issues.Count -gt 0) {
    $html += @"

        <p><strong>$($issues.Count) issue(s)</strong> were identified during the assessment:
        $errorCount error(s) and $warningCount warning(s). See the
        <a href="#issues">Technical Issues</a> section for details.</p>
"@
}
else {
    $html += @"

        <p>No issues were identified during the assessment. All collectors completed successfully.</p>
"@
}

if ($allCisFindings.Count -gt 0) {
    $nonPassingCount = @($allCisFindings | Where-Object { $_.Status -ne 'Pass' }).Count
    $html += @"

        <p>Security configuration was evaluated against <strong>$($allCisFindings.Count) of 140 CIS Microsoft 365
        Foundations Benchmark v6.0.1</strong> controls. <strong>$nonPassingCount finding(s)</strong> require
        attention. See the <a href="#cis-compliance">CIS Compliance Summary</a> for details and remediation guidance.</p>
"@
}

$html += @"

        $($tocHtml.ToString())

        <!-- Assessment Results by Section -->
        <h1 id="assessment-results">Assessment Results</h1>
        $($sectionHtml.ToString())
"@

if ($allCisFindings.Count -gt 0) {
    $html += @"

        <a id="cis-compliance"></a>
        <h1>CIS Compliance Summary</h1>
        $($cisHtml.ToString())
"@
}

if ($issues.Count -gt 0) {
    $html += @"

        <a id="issues"></a>
        <h1>Technical Issues</h1>
        $($issuesHtml.ToString())
"@
}

$html += @"

        <!-- Footer -->
        <div class="report-footer">
            <p>Generated by <span class="m365a-name">M365 Assess</span>
            M365 Assessment Tool v$assessmentVersion</p>
            <p>$(Get-Date -Format 'MMMM d, yyyy h:mm tt')</p>
        </div>
    </div>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('.data-table').forEach(function(table) {
            var headers = table.querySelectorAll('thead th');
            headers.forEach(function(th, colIndex) {
                th.addEventListener('click', function() {
                    sortTable(table, colIndex, th);
                });
            });
        });
    });

    function sortTable(table, colIndex, th) {
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var currentDir = th.getAttribute('data-sort-dir') || 'none';
        var newDir = currentDir === 'asc' ? 'desc' : 'asc';

        th.closest('thead').querySelectorAll('th').forEach(function(h) {
            h.setAttribute('data-sort-dir', 'none');
            h.classList.remove('sort-asc', 'sort-desc');
        });

        th.setAttribute('data-sort-dir', newDir);
        th.classList.add('sort-' + newDir);

        rows.sort(function(a, b) {
            var aVal = a.cells[colIndex] ? a.cells[colIndex].textContent.trim() : '';
            var bVal = b.cells[colIndex] ? b.cells[colIndex].textContent.trim() : '';

            var aNum = parseFloat(aVal);
            var bNum = parseFloat(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return newDir === 'asc' ? aNum - bNum : bNum - aNum;
            }

            var cmp = aVal.localeCompare(bVal, undefined, {sensitivity: 'base'});
            return newDir === 'asc' ? cmp : -cmp;
        });

        rows.forEach(function(row) { tbody.appendChild(row); });
    }
    </script>
</body>
</html>
"@

# ------------------------------------------------------------------
# Write HTML file
# ------------------------------------------------------------------
Set-Content -Path $OutputPath -Value $html -Encoding UTF8
Write-Output "HTML report generated: $OutputPath"

# ------------------------------------------------------------------
# Generate PDF if wkhtmltopdf is available
# ------------------------------------------------------------------
if (-not $SkipPdf) {
    $pdfPath = [System.IO.Path]::ChangeExtension($OutputPath, '.pdf')
    $wkhtmltopdf = Get-Command -Name 'wkhtmltopdf' -ErrorAction SilentlyContinue

    if ($wkhtmltopdf) {
        try {
            & wkhtmltopdf --page-size Letter --margin-top 15 --margin-bottom 15 --margin-left 15 --margin-right 15 --enable-local-file-access $OutputPath $pdfPath 2>$null
            if (Test-Path -Path $pdfPath) {
                Write-Output "PDF report generated: $pdfPath"
            }
        }
        catch {
            Write-Verbose "PDF generation failed: $_"
        }
    }
    else {
        Write-Verbose "wkhtmltopdf not found. To generate PDF, open the HTML report in a browser and print to PDF."
    }
}
