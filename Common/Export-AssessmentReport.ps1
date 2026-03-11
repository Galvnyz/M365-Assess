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
    Version: 0.5.0
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
# Load control registry
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1')
$controlsPath = Join-Path -Path $projectRoot -ChildPath 'controls'
$controlRegistry = Import-ControlRegistry -ControlsPath $controlsPath

# ------------------------------------------------------------------
# Framework lookup table
# ------------------------------------------------------------------
$frameworkLookup = @{
    'CIS-E3-L1'  = @{ Col = 'CisE3L1';   Label = 'CIS E3 L1';          Css = 'fw-cis' }
    'CIS-E3-L2'  = @{ Col = 'CisE3L2';   Label = 'CIS E3 L2';          Css = 'fw-cis-l2' }
    'CIS-E5-L1'  = @{ Col = 'CisE5L1';   Label = 'CIS E5 L1';          Css = 'fw-cis' }
    'CIS-E5-L2'  = @{ Col = 'CisE5L2';   Label = 'CIS E5 L2';          Css = 'fw-cis-l2' }
    'NIST-800-53'= @{ Col = 'Nist80053';  Label = 'NIST 800-53 Rev 5';  Css = 'fw-nist' }
    'NIST-CSF'   = @{ Col = 'NistCsf';    Label = 'NIST CSF 2.0';       Css = 'fw-csf' }
    'ISO-27001'  = @{ Col = 'Iso27001';   Label = 'ISO 27001:2022';     Css = 'fw-iso' }
    'STIG'       = @{ Col = 'Stig';       Label = 'DISA STIG';          Css = 'fw-stig' }
    'PCI-DSS'    = @{ Col = 'PciDss';     Label = 'PCI DSS v4.0.1';     Css = 'fw-pci' }
    'CMMC'       = @{ Col = 'Cmmc';       Label = 'CMMC 2.0';           Css = 'fw-cmmc' }
    'HIPAA'      = @{ Col = 'Hipaa';      Label = 'HIPAA';              Css = 'fw-hipaa' }
    'CISA-SCuBA' = @{ Col = 'CisaScuba';  Label = 'CISA SCuBA';         Css = 'fw-scuba' }
    'SOC-2'      = @{ Col = 'Soc2';       Label = 'SOC 2 TSC';          Css = 'fw-soc2' }
}
# Ordered list for consistent rendering (all frameworks always included)
$allFrameworkKeys = @('CIS-E3-L1','CIS-E3-L2','CIS-E5-L1','CIS-E5-L2','NIST-800-53','NIST-CSF','ISO-27001','STIG','PCI-DSS','CMMC','HIPAA','CISA-SCuBA','SOC-2')
$cisProfileKeys = @('CIS-E3-L1','CIS-E3-L2','CIS-E5-L1','CIS-E5-L2')

# ------------------------------------------------------------------
# Validate input
# ------------------------------------------------------------------
if (-not (Test-Path -Path $AssessmentFolder -PathType Container)) {
    Write-Error "Assessment folder not found: $AssessmentFolder"
    return
}

$summaryFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Summary*.csv' -ErrorAction SilentlyContinue | Select-Object -First 1
$summaryPath = if ($summaryFile) { $summaryFile.FullName } else { Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Summary.csv' }
if (-not (Test-Path -Path $summaryPath)) {
    Write-Error "Summary CSV not found: $summaryPath"
    return
}

if (-not $OutputPath) {
    # Derive domain prefix from tenant data for filename (resolved later, fallback to generic)
    $reportDomainPrefix = ''
    $OutputPath = Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Report.html'
}

# ------------------------------------------------------------------
# Load assessment data
# ------------------------------------------------------------------
$summary = Import-Csv -Path $summaryPath
$issueFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Issues*.log' -ErrorAction SilentlyContinue | Select-Object -First 1
$issueReportPath = if ($issueFile) { $issueFile.FullName } else { Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Issues.log' }
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

# Framework mappings are now sourced from the control registry (loaded above).
# The $controlRegistry hashtable is keyed by CheckId and contains framework data.

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

# Domain prefix is written to the log header by the main script — read it from there
# (avoids fragile CSV-scanning; the main script already resolved it from TenantId or Graph)

# Read assessment version and cloud environment from log if available
$assessmentVersion = '0.5.0'
$cloudEnvironment = 'commercial'
# Find the log file (may have domain suffix, e.g., _Assessment-Log_contoso.txt)
$logFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Log*.txt' -ErrorAction SilentlyContinue | Select-Object -First 1
$logPath = if ($logFile) { $logFile.FullName } else { Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Log.txt' }
if (Test-Path -Path $logPath) {
    $logHead = Get-Content -Path $logPath -TotalCount 10
    $versionLine = $logHead | Where-Object { $_ -match 'Version:\s+v(.+)' }
    if ($versionLine) {
        $assessmentVersion = $Matches[1]
    }
    $cloudLine = $logHead | Where-Object { $_ -match 'Cloud:\s+(.+)' }
    if ($cloudLine) {
        $cloudEnvironment = $Matches[1].Trim()
    }
    if ($reportDomainPrefix -eq '') {
        $domainLine = $logHead | Where-Object { $_ -match 'Domain:\s+(\S+)' }
        if ($domainLine -and $Matches[1]) {
            $reportDomainPrefix = $Matches[1].Trim()
            $OutputPath = Join-Path -Path $AssessmentFolder -ChildPath "_Assessment-Report_${reportDomainPrefix}.html"
        }
    }
}

# Map cloud environment to display names and CSS classes
$cloudDisplayNames = @{
    'commercial' = 'Commercial'
    'gcc'        = 'GCC'
    'gcchigh'    = 'GCC High'
    'dod'        = 'DoD'
}
$cloudDisplayName = if ($cloudDisplayNames.ContainsKey($cloudEnvironment)) { $cloudDisplayNames[$cloudEnvironment] } else { $cloudEnvironment }

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

# Preferred section display order — sections not listed keep their CSV order at the end
$sectionDisplayOrder = @('Tenant','Identity','Hybrid','Licensing','Email','Intune','Security','Collaboration','Inventory','ScubaGear')
$sections = @(
    foreach ($s in $sectionDisplayOrder) { if ($sections -contains $s) { $s } }
    foreach ($s in $sections) { if ($sectionDisplayOrder -notcontains $s) { $s } }
)

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
# SVG chart helpers — inline charts for the HTML report
# ------------------------------------------------------------------
function Get-SvgDonut {
    param(
        [double]$Percentage,
        [string]$CssClass = 'success',
        [string]$Label = '',
        [int]$Size = 120,
        [int]$StrokeWidth = 10
    )
    $radius = ($Size / 2) - $StrokeWidth
    $circumference = [math]::Round(2 * [math]::PI * $radius, 2)
    $dashOffset = [math]::Round($circumference * (1 - ($Percentage / 100)), 2)
    $center = $Size / 2
    $displayVal = if ($Label) { $Label } else { "$Percentage%" }
    return @"
<svg class='donut-chart' width='$Size' height='$Size' viewBox='0 0 $Size $Size'>
<circle class='donut-track' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'/>
<circle class='donut-fill donut-$CssClass' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'
  stroke-dasharray='$circumference' stroke-dashoffset='$dashOffset' stroke-linecap='round' transform='rotate(-90 $center $center)'/>
<text class='donut-text' x='$center' y='$center' text-anchor='middle' dominant-baseline='central'>$displayVal</text>
</svg>
"@
}

function Get-SvgMultiDonut {
    param(
        [array]$Segments,
        [string]$CenterLabel = '',
        [int]$Size = 130,
        [int]$StrokeWidth = 11
    )
    $radius = ($Size / 2) - $StrokeWidth
    $circumference = [math]::Round(2 * [math]::PI * $radius, 2)
    $center = $Size / 2
    $svg = "<svg class='donut-chart' width='$Size' height='$Size' viewBox='0 0 $Size $Size'>"
    $svg += "<circle class='donut-track' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'/>"
    $offset = 0
    foreach ($seg in $Segments) {
        if ($seg.Pct -le 0) { continue }
        $arcLen = [math]::Round(($seg.Pct / 100) * $circumference, 2)
        $gapLen = [math]::Round($circumference - $arcLen, 2)
        $rotDeg = [math]::Round(($offset / 100) * 360 - 90, 2)
        $svg += "<circle class='donut-fill donut-$($seg.Css)' data-segment='$($seg.Css)' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth' stroke-dasharray='$arcLen $gapLen' transform='rotate($rotDeg $center $center)'/>"
        $offset += $seg.Pct
    }
    $svg += "<text class='donut-text donut-text-sm' x='$center' y='$center' text-anchor='middle' dominant-baseline='central'>$CenterLabel</text>"
    $svg += "</svg>"
    return $svg
}

function Get-SvgHorizontalBar {
    param(
        [array]$Segments
    )
    $barHtml = "<div class='hbar-chart'>"
    foreach ($seg in $Segments) {
        if ($seg.Pct -gt 0) {
            $barHtml += "<div class='hbar-segment hbar-$($seg.Css)' style='width: $($seg.Pct)%;' title='$($seg.Label): $($seg.Count)'><span class='hbar-label'>$($seg.Count)</span></div>"
        }
    }
    $barHtml += "</div>"
    return $barHtml
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
    if ($columns -contains 'Status' -and $columns -contains 'CheckId') {
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

    # ScubaGear baseline: failures first, then by Control ID
    if ($columns -contains 'Control ID' -and $columns -contains 'Result') {
        $resultPriority = @{ 'Fail' = 0; 'N/A' = 2; 'Pass' = 3 }
        return @($Data | Sort-Object -Property @{
            Expression = { if ($null -ne $resultPriority[$_.Result]) { $resultPriority[$_.Result] } else { 1 } }
        }, 'Control ID')
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
    'Identity'      = 'User accounts, MFA enrollment, admin roles, conditional access policies, and password policies. Identity is the primary attack surface &mdash; these controls determine who can access your environment and how they authenticate. Compromised credentials remain the leading cause of data breaches; strong identity controls (MFA, least-privilege roles, conditional access) are the single most effective defense. See <a href="https://learn.microsoft.com/en-us/entra/fundamentals/concept-secure-remote-workers" target="_blank">Microsoft Entra identity security guidance</a>.'
    'Licensing'     = 'Microsoft 365 license allocation and utilization. Understanding license distribution helps identify unused spend and ensures users have the entitlements needed for security features like Defender and Intune.'
    'Email'         = 'Mailbox infrastructure, Exchange Online security configuration, email protection policies, mail flow, and DNS-based email authentication. Email remains the #1 attack vector &mdash; over 90% of cyberattacks begin with a phishing email, and business email compromise (BEC) accounts for billions in losses annually.'
    'Intune'        = 'Device enrollment, compliance policies, and configuration profiles. Intune controls ensure corporate devices meet security baselines and that non-compliant devices are restricted from accessing company data.'
    'Security'      = 'Microsoft Secure Score, Defender for Office 365 policies, and Data Loss Prevention rules. These controls provide defense-in-depth against malware, ransomware, and accidental data leakage. Defender policies should be configured at <em>Standard</em> or <em>Strict</em> preset levels as defined in the <a href="https://learn.microsoft.com/en-us/defender-office-365/recommended-settings-for-eop-and-office365" target="_blank">Microsoft recommended security settings</a>. DLP rules prevent sensitive data (PII, financial records, health information) from leaving the organization via email, chat, or file sharing.'
    'Collaboration' = 'SharePoint, OneDrive, and Microsoft Teams configuration and access settings. Collaboration tools are where sensitive data lives &mdash; these controls govern sharing, guest access, and external communication. Misconfigured sharing settings are a common source of data exposure; anonymous sharing links and unrestricted guest access should be reviewed carefully. See <a href="https://learn.microsoft.com/en-us/microsoft-365/solutions/setup-secure-collaboration-with-teams" target="_blank">Microsoft secure collaboration guidance</a>.'
    'Hybrid'        = 'On-premises Active Directory synchronization and hybrid identity configuration. Hybrid sync health directly impacts authentication reliability and determines which identities are managed in the cloud vs. on-premises.'
    'Inventory'     = 'Per-object inventory of mailboxes, distribution lists, Microsoft 365 groups, Teams, SharePoint sites, and OneDrive accounts. Designed for M&amp;A due diligence, migration planning, and tenant-wide asset enumeration.'
    'ScubaGear'     = 'CISA <a href="https://github.com/cisagov/ScubaGear" target="_blank">ScubaGear</a> baseline compliance scan assessing Microsoft 365 configuration against Secure Cloud Business Applications (SCuBA) security baselines. Controls are categorized as <strong>Shall</strong> (mandatory) or <strong>Should</strong> (recommended).'
}

foreach ($sectionName in $sections) {
    $sectionCollectors = @($summary | Where-Object { $_.Section -eq $sectionName })

    # Reorder Email collectors for natural report flow
    if ($sectionName -eq 'Email') {
        $emailOrder = @{
            '09-Mailbox-Summary.csv'       = 0
            '11b-EXO-Security-Config.csv'  = 1
            '11-Email-Security.csv'        = 2
            '10-Mail-Flow.csv'             = 3
            '12-DNS-Authentication.csv'    = 4
        }
        $sectionCollectors = @($sectionCollectors | Sort-Object -Property @{
            Expression = { if ($emailOrder.ContainsKey($_.FileName)) { $emailOrder[$_.FileName] } else { 99 } }
        })
    }

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

        $null = $sectionHtml.AppendLine("<div class='tenant-card' id='section-tenant'>")
        $null = $sectionHtml.AppendLine("<h2 class='tenant-heading'>Organization Profile</h2>")
        $null = $sectionHtml.AppendLine("<div class='tenant-org-name'>$(ConvertTo-HtmlSafe -Text $orgName)</div>")

        # Primary facts row
        $null = $sectionHtml.AppendLine("<div class='tenant-facts'>")
        if ($defaultDomain) {
            $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Primary Domain</span><span class='fact-value'>$(ConvertTo-HtmlSafe -Text $defaultDomain)</span></div>")
        }
        $null = $sectionHtml.AppendLine("<div class='tenant-fact'><span class='fact-label'>Cloud</span><span class='cloud-badge cloud-$(ConvertTo-HtmlSafe -Text $cloudEnvironment)'>$(ConvertTo-HtmlSafe -Text $cloudDisplayName)</span></div>")
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

    # Collector status — compact chip grid
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

            # MFA / SSPR adoption from per-user report
            $mfaCapable = 0; $mfaRegistered = 0; $ssprCapable = 0; $ssprRegistered = 0
            if ($mfaRawData.Count -gt 0) {
                $mfaCapable     = @($mfaRawData | Where-Object { $_.IsMfaCapable -eq 'True' }).Count
                $mfaRegistered  = @($mfaRawData | Where-Object { $_.IsMfaCapable -eq 'True' -and $_.IsMfaRegistered -eq 'True' }).Count
                $ssprCapable    = @($mfaRawData | Where-Object { $_.IsSsprCapable -eq 'True' }).Count
                $ssprRegistered = @($mfaRawData | Where-Object { $_.IsSsprCapable -eq 'True' -and $_.IsSsprRegistered -eq 'True' }).Count
            }
            $mfaPct = if ($mfaCapable -gt 0) { [math]::Round(($mfaRegistered / $mfaCapable) * 100, 1) } else { 0 }
            $mfaClass = if ($mfaPct -ge 90) { 'success' } elseif ($mfaPct -ge 70) { 'warning' } else { 'danger' }
            $ssprPct = if ($ssprCapable -gt 0) { [math]::Round(($ssprRegistered / $ssprCapable) * 100, 1) } else { 0 }
            $ssprClass = if ($ssprPct -ge 90) { 'success' } elseif ($ssprPct -ge 70) { 'warning' } else { 'danger' }
            $disabledClass = if ($disabledUsers -gt 0) { 'danger' } else { 'success' }
            $mfaSignInPct = if ($totalUsers -gt 0) { [math]::Round(($withMfa / $totalUsers) * 100, 1) } else { 0 }
            $mfaSignInClass = if ($mfaSignInPct -ge 90) { 'success' } elseif ($mfaSignInPct -ge 70) { 'warning' } else { 'danger' }

            $null = $sectionHtml.AppendLine("<div class='email-dashboard'>")

            # --- Top row: 3-column layout ---
            $null = $sectionHtml.AppendLine("<div class='email-dash-top'>")

            # Left column: User metrics with icons
            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>User Summary</div>")
            $null = $sectionHtml.AppendLine("<div class='email-metrics-grid'>")

            # Build user metric cards with icons and color coding
            $userMetrics = @(
                @{ Icon = '&#128101;'; Value = $totalUsers;    Label = 'Total Users';    Css = '' }
                @{ Icon = '&#127915;'; Value = $licensedUsers; Label = 'Licensed';       Css = '' }
                @{ Icon = '&#128587;'; Value = $guestUsers;    Label = 'Guest Users';    Css = '' }
                @{ Icon = '&#128683;'; Value = $disabledUsers; Label = 'Disabled';       Css = $disabledClass }
                @{ Icon = '&#128260;'; Value = $syncedUsers;   Label = 'Synced On-Prem'; Css = '' }
                @{ Icon = '&#9729;';   Value = $cloudOnly;     Label = 'Cloud Only';     Css = '' }
                @{ Icon = '&#128272;'; Value = $withMfa;       Label = 'With MFA';       Css = $mfaSignInClass }
            )
            foreach ($m in $userMetrics) {
                $cssExtra = if ($m.Css) { " id-metric-$($m.Css)" } else { '' }
                $null = $sectionHtml.AppendLine("<div class='email-metric-card$cssExtra'><div class='email-metric-icon'>$($m.Icon)</div><div class='email-metric-body'><div class='email-metric-value'>$($m.Value)</div><div class='email-metric-label'>$(ConvertTo-HtmlSafe -Text $m.Label)</div></div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # Middle column: MFA & SSPR donuts
            $mfaDonut  = Get-SvgDonut -Percentage $mfaPct  -CssClass $mfaClass  -Size 110 -StrokeWidth 10
            $ssprDonut = Get-SvgDonut -Percentage $ssprPct -CssClass $ssprClass -Size 110 -StrokeWidth 10

            $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
            $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Authentication</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-stack'>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-item'>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-chart'>$mfaDonut</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-info'><div class='id-donut-title'>MFA Adoption</div><div class='id-donut-detail'>$mfaRegistered / $mfaCapable enrolled</div></div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-item'>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-chart'>$ssprDonut</div>")
            $null = $sectionHtml.AppendLine("<div class='id-donut-info'><div class='id-donut-title'>SSPR Enrollment</div><div class='id-donut-detail'>$ssprRegistered / $ssprCapable enrolled</div></div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")
            $null = $sectionHtml.AppendLine("</div>")

            # Right column: Entra Security Config donut
            if ($entraData.Count -gt 0) {
                $entraTotal  = $entraData.Count
                $entraPass   = @($entraData | Where-Object { $_.Status -eq 'Pass' }).Count
                $entraFail   = @($entraData | Where-Object { $_.Status -eq 'Fail' }).Count
                $entraWarn   = @($entraData | Where-Object { $_.Status -eq 'Warning' }).Count
                $entraReview = @($entraData | Where-Object { $_.Status -eq 'Review' }).Count

                $entraSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($entraPass   / $entraTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($entraFail   / $entraTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($entraWarn   / $entraTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'info';    Pct = [math]::Round(($entraReview / $entraTotal) * 100, 1); Label = 'Review' }
                )
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
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$entraReview</span></div>")
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
        $polCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '11-Email-Security.csv'

        $mbxData = if (Test-Path $mbxCsvPath) { @(Import-Csv $mbxCsvPath) } else { @() }
        $exoData = if (Test-Path $exoCsvPath) { @(Import-Csv $exoCsvPath) } else { @() }
        $polData = if (Test-Path $polCsvPath) { @(Import-Csv $polCsvPath) } else { @() }

        $hasMailbox = $mbxData.Count -gt 0
        $hasExo = $exoData.Count -gt 0
        $hasPolicies = $polData.Count -gt 0

        # Also pre-load DNS Authentication data
        $dnsCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '12-DNS-Authentication.csv'
        $dnsData = if (Test-Path $dnsCsvPath) { @(Import-Csv $dnsCsvPath) } else { @() }
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
                $exoTotal  = $exoData.Count
                $exoPass   = @($exoData | Where-Object { $_.Status -eq 'Pass' }).Count
                $exoFail   = @($exoData | Where-Object { $_.Status -eq 'Fail' }).Count
                $exoWarn   = @($exoData | Where-Object { $_.Status -eq 'Warning' }).Count
                $exoReview = @($exoData | Where-Object { $_.Status -eq 'Review' }).Count

                if ($exoTotal -gt 0) {
                    $exoSegments = @(
                        @{ Css = 'success'; Pct = [math]::Round(($exoPass   / $exoTotal) * 100, 1); Label = 'Pass' }
                        @{ Css = 'danger';  Pct = [math]::Round(($exoFail   / $exoTotal) * 100, 1); Label = 'Fail' }
                        @{ Css = 'warning'; Pct = [math]::Round(($exoWarn   / $exoTotal) * 100, 1); Label = 'Warning' }
                        @{ Css = 'info';    Pct = [math]::Round(($exoReview / $exoTotal) * 100, 1); Label = 'Review' }
                    )
                    $exoDonut = Get-SvgMultiDonut -Segments $exoSegments -CenterLabel "$exoTotal" -Size 130 -StrokeWidth 12

                    $null = $sectionHtml.AppendLine("<div class='email-dash-col'>")
                    $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>EXO Security Config</div>")
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
                        $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$exoReview</span></div>")
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
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Email Authentication</div>")

                # DNS stat cards — compact 2-column grid for column context
                $null = $sectionHtml.AppendLine("<div class='dns-stats-col'>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $spfClass'><div class='dns-stat-value'>$spfConfigured / $totalDomains</div><div class='dns-stat-label'>SPF</div></div>")
                $dmarcDetail = if ($dmarcMonitoring -gt 0) { "<div class='dns-stat-detail'>$dmarcMonitoring monitoring</div>" } else { '' }
                $null = $sectionHtml.AppendLine("<div class='dns-stat $dmarcClass'><div class='dns-stat-value'>$dmarcEnforced / $totalDomains</div><div class='dns-stat-label'>DMARC Enforced</div>$dmarcDetail</div>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $dkimClass'><div class='dns-stat-value'>$dkimConfigured / $totalDomains</div><div class='dns-stat-label'>DKIM</div></div>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $mtaStsClass'><div class='dns-stat-value'>$mtaStsConfigured / $totalDomains</div><div class='dns-stat-label'>MTA-STS</div></div>")
                $null = $sectionHtml.AppendLine("<div class='dns-stat $tlsRptClass'><div class='dns-stat-value'>$tlsRptConfigured / $totalDomains</div><div class='dns-stat-label'>TLS-RPT</div></div>")
                if ($dnsColumns -contains 'PublicDNSConfirm') {
                    $null = $sectionHtml.AppendLine("<div class='dns-stat $publicClass'><div class='dns-stat-value'>$publicConfirmed / $totalDomains</div><div class='dns-stat-label'>Public DNS</div></div>")
                }
                $null = $sectionHtml.AppendLine("</div>")

                # Collapsible protocol descriptions
                $null = $sectionHtml.AppendLine("<details class='dns-protocols'>")
                $null = $sectionHtml.AppendLine("<summary>About Email Authentication Protocols</summary>")
                $null = $sectionHtml.AppendLine("<div class='dns-protocols-body'>")
                $null = $sectionHtml.AppendLine("<p><strong>SPF</strong> (Sender Policy Framework) specifies which mail servers are authorized to send email on behalf of your domain. Without SPF, attackers can send emails that appear to come from your domain with no way for recipients to detect the forgery.</p>")
                $null = $sectionHtml.AppendLine("<p><strong>DKIM</strong> (DomainKeys Identified Mail) adds a cryptographic signature to outgoing messages, proving they haven't been tampered with in transit. DKIM protects message integrity and is essential for DMARC alignment.</p>")
                $null = $sectionHtml.AppendLine("<p><strong>DMARC</strong> (Domain-based Message Authentication, Reporting &amp; Conformance) ties SPF and DKIM together with a policy that tells receiving servers what to do with messages that fail authentication &mdash; monitor (<code>p=none</code>), quarantine, or reject. DMARC at <code>p=reject</code> is the gold standard and is required by <a href='https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security' target='_blank'>CISA BOD 18-01</a> for federal agencies.</p>")
                $null = $sectionHtml.AppendLine("<p><strong>MTA-STS</strong> (RFC 8461) enforces TLS encryption for inbound email transport, preventing man-in-the-middle downgrade attacks. <strong>TLS-RPT</strong> (RFC 8460) provides daily reports on TLS delivery failures so you know when encrypted delivery is failing.</p>")
                $null = $sectionHtml.AppendLine("<p class='advisory-links'><strong>Resources:</strong> <a href='https://learn.microsoft.com/en-us/defender-office-365/email-authentication-about' target='_blank'>Microsoft Email Authentication</a> &middot; <a href='https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure' target='_blank'>Configure DMARC</a> &middot; <a href='https://learn.microsoft.com/en-us/purview/enhancing-mail-flow-with-mta-sts' target='_blank'>MTA-STS for Exchange Online</a> &middot; <a href='https://csrc.nist.gov/pubs/sp/800/177/r1/final' target='_blank'>NIST SP 800-177</a> &middot; <a href='https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security' target='_blank'>CISA BOD 18-01</a></p>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</details>")

                $null = $sectionHtml.AppendLine("</div>") # end email-dash-col (DNS)
            }

            $null = $sectionHtml.AppendLine("</div>") # end email-dash-top

            # --- Below: Email Policies as responsive grid ---
            if ($hasPolicies) {
                $null = $sectionHtml.AppendLine("<div class='email-dash-policies'>")
                $null = $sectionHtml.AppendLine("<div class='email-dash-heading'>Email Policies</div>")
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
        $hybridCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '22-Hybrid-Sync.csv'
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
                $drDisplay = switch ($domainRestrict) { 'AllowList' { 'Allow List' }; 'BlockList' { 'Block List' }; 'None' { 'None' }; 'none' { 'None' }; default { $domainRestrict } }
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
                $spoSecTotal  = $spoSecData.Count
                $spoSecPass   = @($spoSecData | Where-Object { $_.Status -eq 'Pass' }).Count
                $spoSecFail   = @($spoSecData | Where-Object { $_.Status -eq 'Fail' }).Count
                $spoSecWarn   = @($spoSecData | Where-Object { $_.Status -eq 'Warning' }).Count
                $spoSecReview = @($spoSecData | Where-Object { $_.Status -eq 'Review' }).Count

                $spoSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($spoSecPass   / $spoSecTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($spoSecFail   / $spoSecTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($spoSecWarn   / $spoSecTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'info';    Pct = [math]::Round(($spoSecReview / $spoSecTotal) * 100, 1); Label = 'Review' }
                )
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
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$spoSecReview</span></div>")
                }
                $null = $sectionHtml.AppendLine("<div class='score-detail-row score-delta'><span class='score-detail-label'>Total Controls</span><span class='score-detail-value'>$spoSecTotal</span></div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
                $null = $sectionHtml.AppendLine("</div>")
            }

            # --- Right column: Teams Security Config donut ---
            if ($teamSecData.Count -gt 0) {
                $teamSecTotal  = $teamSecData.Count
                $teamSecPass   = @($teamSecData | Where-Object { $_.Status -eq 'Pass' }).Count
                $teamSecFail   = @($teamSecData | Where-Object { $_.Status -eq 'Fail' }).Count
                $teamSecWarn   = @($teamSecData | Where-Object { $_.Status -eq 'Warning' }).Count
                $teamSecReview = @($teamSecData | Where-Object { $_.Status -eq 'Review' }).Count

                $teamSegments = @(
                    @{ Css = 'success'; Pct = [math]::Round(($teamSecPass   / $teamSecTotal) * 100, 1); Label = 'Pass' }
                    @{ Css = 'danger';  Pct = [math]::Round(($teamSecFail   / $teamSecTotal) * 100, 1); Label = 'Fail' }
                    @{ Css = 'warning'; Pct = [math]::Round(($teamSecWarn   / $teamSecTotal) * 100, 1); Label = 'Warning' }
                    @{ Css = 'info';    Pct = [math]::Round(($teamSecReview / $teamSecTotal) * 100, 1); Label = 'Review' }
                )
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
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$teamSecReview</span></div>")
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
            $scoreDonut = Get-SvgDonut -Percentage $pctRaw -CssClass $scoreClass -Size 160 -StrokeWidth 14

            # Load Defender Security Config for status breakdown
            $defCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '18b-Defender-Security-Config.csv'
            $defPass = 0; $defFail = 0; $defWarn = 0; $defReview = 0; $defTotal = 0
            if (Test-Path -Path $defCsvPath) {
                $defData = @(Import-Csv -Path $defCsvPath)
                $defTotal = $defData.Count
                $defPass = @($defData | Where-Object { $_.Status -eq 'Pass' }).Count
                $defFail = @($defData | Where-Object { $_.Status -eq 'Fail' }).Count
                $defWarn = @($defData | Where-Object { $_.Status -eq 'Warning' }).Count
                $defReview = @($defData | Where-Object { $_.Status -eq 'Review' }).Count
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
                    @{ Css = 'info'; Pct = $defReviewPct; Label = 'Review' }
                )
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
                    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-info'></span> Review</span><span class='score-detail-value' style='color: var(--m365a-accent);'>$defReview</span></div>")
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
        # ScubaGear Baseline — summary cards + link to native report
        # ----------------------------------------------------------
        if ($c.FileName -eq '27-ScubaGear-Baseline.csv') {
            $scubaData = @($data)
            $totalControls = $scubaData.Count

            # Result counts
            $passCount = @($scubaData | Where-Object { $_.Result -eq 'Pass' }).Count
            $failCount = @($scubaData | Where-Object { $_.Result -eq 'Fail' }).Count
            $naCount = @($scubaData | Where-Object { $_.Result -eq 'N/A' }).Count
            $warnCount = @($scubaData | Where-Object { $_.Result -notin @('Pass', 'Fail', 'N/A') -and $_.Result }).Count

            # Criticality breakdown for failures
            $shallFail = @($scubaData | Where-Object { $_.Result -eq 'Fail' -and $_.Criticality -match 'Shall' }).Count
            $shouldFail = @($scubaData | Where-Object { $_.Result -eq 'Fail' -and $_.Criticality -match 'Should' }).Count

            $passClass = if ($passCount -gt 0) { 'success' } else { '' }
            $failClass = if ($failCount -eq 0) { 'success' } else { 'danger' }
            $naClass = ''

            $null = $sectionHtml.AppendLine("<div class='section-advisory'>")
            $null = $sectionHtml.AppendLine("<strong>CISA SCuBA Baseline Compliance</strong>")
            $null = $sectionHtml.AppendLine("<p>Results from the <a href='https://github.com/cisagov/ScubaGear' target='_blank'>CISA ScubaGear</a> tool assessing Microsoft 365 tenant configuration against Secure Cloud Business Applications (SCuBA) baselines. <strong>Shall</strong> controls are mandatory requirements; <strong>Should</strong> controls are recommended best practices.</p>")

            # Link to native report if it exists
            $scubaReportDir = Join-Path -Path $AssessmentFolder -ChildPath 'ScubaGear-Report'
            $nativeReport = Get-ChildItem -Path $scubaReportDir -Filter 'BaselineReports.html' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($nativeReport) {
                $relPath = $nativeReport.FullName.Substring($AssessmentFolder.Length + 1) -replace '\\', '/'
                $null = $sectionHtml.AppendLine("<p>For the full interactive report with per-product breakdowns, open the <a href='$relPath' target='_blank'>ScubaGear Native Report</a>.</p>")
            }
            $null = $sectionHtml.AppendLine("</div>")

            $null = $sectionHtml.AppendLine("<div class='exec-summary'>")
            $null = $sectionHtml.AppendLine("<div class='stat-card $passClass'><div class='stat-value'>$passCount</div><div class='stat-label'>Pass</div><div class='stat-detail'>of $totalControls controls</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card $failClass'><div class='stat-value'>$failCount</div><div class='stat-label'>Fail</div><div class='stat-detail'>$shallFail Shall / $shouldFail Should</div></div>")
            $null = $sectionHtml.AppendLine("<div class='stat-card $naClass'><div class='stat-value'>$naCount</div><div class='stat-label'>N/A</div><div class='stat-detail'>Not applicable or not implemented</div></div>")
            if ($warnCount -gt 0) {
                $null = $sectionHtml.AppendLine("<div class='stat-card warning'><div class='stat-value'>$warnCount</div><div class='stat-label'>Warning</div></div>")
            }
            $null = $sectionHtml.AppendLine("</div>")

            # Filter to key columns and add Result-based row coloring
            $columns = @('Control ID', 'Requirement', 'Result', 'Criticality', 'Details')
        }

        # ----------------------------------------------------------
        # Standard data table rendering
        # ----------------------------------------------------------
        $rowCount = @($data).Count
        $isScubaGear = ($c.FileName -eq '27-ScubaGear-Baseline.csv')
        $collectorDisplay = if ($c.FileName -eq '11-Email-Security.csv') { 'Email Policies' } else { $c.Collector }
        $null = $sectionHtml.AppendLine("<details class='collector-detail'>")
        $null = $sectionHtml.AppendLine("<summary><h3>$(ConvertTo-HtmlSafe -Text $collectorDisplay) <span class='row-count'>($rowCount rows)</span></h3></summary>")

        $null = $sectionHtml.AppendLine("<div class='table-wrapper'>")
        $null = $sectionHtml.AppendLine("<table class='data-table'>")
        $null = $sectionHtml.AppendLine("<thead><tr>")
        foreach ($col in $columns) {
            $displayCol = Format-ColumnHeader -Name $col
            $null = $sectionHtml.AppendLine("<th scope='col'>$(ConvertTo-HtmlSafe -Text $displayCol)</th>")
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
            elseif ($isScubaGear -and $row.Result) {
                $rowClass = switch ($row.Result) {
                    'Fail' { " class='cis-row-fail'" }
                    'N/A'  { " class='cis-row-unknown'" }
                    default { '' }
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
                # ScubaGear Result column — badge styling
                if ($isScubaGear -and $col -eq 'Result') {
                    $badgeClass = switch ($val) {
                        'Pass' { 'badge-complete' }
                        'Fail' { 'badge-failed' }
                        'N/A'  { 'badge-skipped' }
                        default { '' }
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
# Build unified Compliance Overview section
# ------------------------------------------------------------------
$complianceHtml = [System.Text.StringBuilder]::new()
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
        $entry = if ($controlRegistry.ContainsKey($row.CheckId)) { $controlRegistry[$row.CheckId] } else { $null }
        $fw = if ($entry) { $entry.frameworks } else { @{} }
        $cisProfiles = if ($fw.'cis-m365-v6' -and $fw.'cis-m365-v6'.profiles) { $fw.'cis-m365-v6'.profiles } else { @() }
        $cisId = if ($fw.'cis-m365-v6' -and $fw.'cis-m365-v6'.controlId) { $fw.'cis-m365-v6'.controlId } else { '' }
        $allCisFindings.Add([PSCustomObject]@{
            CheckId      = $row.CheckId
            CisControl   = $cisId
            Category     = $row.Category
            Setting      = $row.Setting
            CurrentValue = $row.CurrentValue
            Recommended  = $row.RecommendedValue
            Status       = $row.Status
            Remediation  = $row.Remediation
            Source       = $c.Collector
            CisE3L1      = if ($cisProfiles -contains 'E3-L1') { $cisId } else { '' }
            CisE3L2      = if ($cisProfiles -contains 'E3-L2') { $cisId } else { '' }
            CisE5L1      = if ($cisProfiles -contains 'E5-L1') { $cisId } else { '' }
            CisE5L2      = if ($cisProfiles -contains 'E5-L2') { $cisId } else { '' }
            NistCsf      = if ($fw.'nist-csf')    { $fw.'nist-csf'.controlId }    else { '' }
            Nist80053    = if ($fw.'nist-800-53')  { $fw.'nist-800-53'.controlId } else { '' }
            Iso27001     = if ($fw.'iso-27001')    { $fw.'iso-27001'.controlId }   else { '' }
            Stig         = if ($fw.stig)           { $fw.stig.controlId }          else { '' }
            PciDss       = if ($fw.'pci-dss')      { $fw.'pci-dss'.controlId }     else { '' }
            Cmmc         = if ($fw.cmmc)           { $fw.cmmc.controlId }          else { '' }
            Hipaa        = if ($fw.hipaa)          { $fw.hipaa.controlId }         else { '' }
            CisaScuba    = if ($fw.'cisa-scuba')   { $fw.'cisa-scuba'.controlId }  else { '' }
            Soc2         = if ($fw.soc2)           { $fw.soc2.controlId }          else { '' }
        })
    }
}

if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) {

    # Load framework catalog CSVs to get total control counts
    $catalogCounts = @{}
    $frameworksDir = Join-Path -Path $projectRoot -ChildPath 'assets/frameworks'
    $catalogFiles = @{
        'CIS-E3-L1'   = 'cis-e3-l1.csv'
        'CIS-E3-L2'   = 'cis-e3-l2.csv'
        'CIS-E5-L1'   = 'cis-e5-l1.csv'
        'CIS-E5-L2'   = 'cis-e5-l2.csv'
        'NIST-800-53'  = 'nist-800-53-r5.csv'
        'NIST-CSF'     = 'nist-csf-2.0.csv'
        'ISO-27001'    = 'iso-27001-2022.csv'
        'STIG'         = 'disa-stig-m365.csv'
        'PCI-DSS'      = 'pci-dss-v4.csv'
        'CMMC'         = 'cmmc-nist-800-171-r2.csv'
        'HIPAA'        = 'hipaa-security-rule.csv'
        'CISA-SCuBA'   = 'cisa-scuba-baselines.csv'
    }
    foreach ($fwKey in $allFrameworkKeys) {
        if ($catalogFiles.ContainsKey($fwKey)) {
            $catPath = Join-Path -Path $frameworksDir -ChildPath $catalogFiles[$fwKey]
            if (Test-Path -Path $catPath) {
                $catData = Import-Csv -Path $catPath
                $catalogCounts[$fwKey] = @($catData).Count
            }
        }
    }
    # Overall CIS status counts (for status filter labels)
    $cisPass = @($allCisFindings | Where-Object { $_.Status -eq 'Pass' }).Count
    $cisFail = @($allCisFindings | Where-Object { $_.Status -eq 'Fail' }).Count
    $cisWarn = @($allCisFindings | Where-Object { $_.Status -eq 'Warning' }).Count
    $cisReview = @($allCisFindings | Where-Object { $_.Status -eq 'Review' }).Count
    $knownStatuses = @('Pass', 'Fail', 'Warning', 'Review')
    $cisUnknown = @($allCisFindings | Where-Object { $_.Status -notin $knownStatuses }).Count

    $null = $complianceHtml.AppendLine("<details class='section' open>")
    $null = $complianceHtml.AppendLine("<summary><h2>Compliance Overview</h2></summary>")
    $null = $complianceHtml.AppendLine("<p>Security findings mapped across compliance frameworks. Use the selector below to choose which frameworks to display.</p>")

    # Informational disclaimer
    $null = $complianceHtml.AppendLine("<div class='cis-disclaimer'>")
    $null = $complianceHtml.AppendLine("<strong>Informational Notice</strong>")
    $null = $complianceHtml.AppendLine("<p>This compliance assessment is provided for <strong>informational purposes only</strong> and does not constitute a comprehensive security assessment, audit, or certification. Results reflect automated checks at a point in time and should not be considered conclusive. For a thorough security evaluation, consider engaging a qualified security professional.</p>")
    $null = $complianceHtml.AppendLine("</div>")

    # Framework multi-selector
    $null = $complianceHtml.AppendLine("<div class='fw-selector' id='fwSelector'>")
    $null = $complianceHtml.AppendLine("<span class='fw-selector-label'>Frameworks:</span>")
    foreach ($fwKey in $allFrameworkKeys) {
        $fwInfo = $frameworkLookup[$fwKey]
        $null = $complianceHtml.AppendLine("<label class='fw-checkbox'><input type='checkbox' value='$($fwInfo.Col)' checked> $($fwInfo.Label)</label>")
    }
    $null = $complianceHtml.AppendLine("<span class='fw-selector-actions'><button type='button' id='fwSelectAll' class='fw-action-btn'>All</button><button type='button' id='fwSelectNone' class='fw-action-btn'>None</button></span>")
    $null = $complianceHtml.AppendLine("</div>")

    # Status distribution bar chart
    $cisTotal = $allCisFindings.Count
    if ($cisTotal -gt 0) {
        $segments = @(
            @{ Css = 'pass'; Pct = [math]::Round(($cisPass / $cisTotal) * 100, 1); Count = $cisPass; Label = 'Pass' }
            @{ Css = 'fail'; Pct = [math]::Round(($cisFail / $cisTotal) * 100, 1); Count = $cisFail; Label = 'Fail' }
            @{ Css = 'warning'; Pct = [math]::Round(($cisWarn / $cisTotal) * 100, 1); Count = $cisWarn; Label = 'Warning' }
            @{ Css = 'review'; Pct = [math]::Round(($cisReview / $cisTotal) * 100, 1); Count = $cisReview; Label = 'Review' }
        )
        if ($cisUnknown -gt 0) {
            $segments += @{ Css = 'unknown'; Pct = [math]::Round(($cisUnknown / $cisTotal) * 100, 1); Count = $cisUnknown; Label = 'Unknown' }
        }
        $barChart = Get-SvgHorizontalBar -Segments $segments
        $null = $complianceHtml.AppendLine("<div class='compliance-status-bar'>")
        $null = $complianceHtml.AppendLine("<div class='compliance-bar-header'><span class='compliance-bar-title'>Finding Status Distribution</span><span class='compliance-bar-total'>$cisTotal controls assessed</span></div>")
        $null = $complianceHtml.AppendLine($barChart)
        $null = $complianceHtml.AppendLine("<div class='hbar-legend'>")
        foreach ($seg in $segments) {
            if ($seg.Count -gt 0) {
                $null = $complianceHtml.AppendLine("<span class='hbar-legend-item'><span class='chart-legend-dot dot-$(switch ($seg.Css) { 'pass' { 'success' } 'fail' { 'danger' } 'warning' { 'warning' } 'review' { 'info' } default { 'muted' } })'></span>$($seg.Label) ($($seg.Count))</span>")
            }
        }
        $null = $complianceHtml.AppendLine("</div>")
        $null = $complianceHtml.AppendLine("</div>")
    }

    # Framework coverage cards (all frameworks)
    $null = $complianceHtml.AppendLine("<div class='exec-summary' id='fwCards'>")
    foreach ($fwKey in $allFrameworkKeys) {
        $fwInfo = $frameworkLookup[$fwKey]
        $col = $fwInfo.Col
        if ($fwKey -in $cisProfileKeys) {
            # CIS profile card — show compliance score for controls in this profile
            $profileFindings = @($allCisFindings | Where-Object { $_.$col -and $_.$col -ne '' })
            $profilePass = @($profileFindings | Where-Object { $_.Status -eq 'Pass' }).Count
            $profileScored = $profileFindings.Count
            $profileScore = if ($profileScored -gt 0) { [math]::Round(($profilePass / $profileScored) * 100, 1) } else { 0 }
            $scoreDisplay = if ($profileScored -gt 0) { "$profileScore%" } else { 'N/A' }
            $scoreClass = if ($profileScored -eq 0) { '' } elseif ($profileScore -ge 80) { 'success' } elseif ($profileScore -ge 60) { 'warning' } else { 'danger' }
            $catalogTotal = if ($catalogCounts.ContainsKey($fwKey)) { $catalogCounts[$fwKey] } else { 0 }
            $coverageLabel = if ($catalogTotal -gt 0) { "$($profileFindings.Count) of $catalogTotal assessed" } else { "$($profileFindings.Count) assessed" }
            $null = $complianceHtml.AppendLine("<div class='stat-card fw-card $scoreClass' data-fw='$col'><div class='stat-value'>$scoreDisplay</div><div class='stat-label'>$($fwInfo.Label)<br><small>$coverageLabel</small></div></div>")
        }
        else {
            # Non-CIS card — show mapping coverage
            $mappedControls = @($allCisFindings | Where-Object { $_.$col -and $_.$col -ne '' } | ForEach-Object { $_.$col -split ';' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | Sort-Object -Unique)
            $mappedCount = $mappedControls.Count
            $totalCount = if ($catalogCounts.ContainsKey($fwKey)) { $catalogCounts[$fwKey] } else { 0 }
            $coveragePct = if ($totalCount -gt 0) { [math]::Round(($mappedCount / $totalCount) * 100, 0) } else { 0 }
            $coverageClass = if ($totalCount -eq 0) { '' } elseif ($coveragePct -ge 70) { 'success' } elseif ($coveragePct -ge 50) { 'warning' } else { 'danger' }
            $coverageLabel = if ($totalCount -gt 0) { "$mappedCount of $totalCount mapped" } else { "$mappedCount controls mapped" }
            $null = $complianceHtml.AppendLine("<div class='stat-card fw-card $coverageClass' data-fw='$col'><div class='stat-value'>$coveragePct%</div><div class='stat-label'>$($fwInfo.Label)<br><small>$coverageLabel</small></div></div>")
        }
    }
    $null = $complianceHtml.AppendLine("</div>")

    # Status filter (multi-select checkboxes)
    $null = $complianceHtml.AppendLine("<div class='status-filter' id='statusFilter'>")
    $null = $complianceHtml.AppendLine("<span class='status-filter-label'>Status:</span>")
    $null = $complianceHtml.AppendLine("<label class='status-checkbox status-fail'><input type='checkbox' value='fail' checked> Fail ($cisFail)</label>")
    if ($cisWarn -gt 0) {
        $null = $complianceHtml.AppendLine("<label class='status-checkbox status-warning'><input type='checkbox' value='warning' checked> Warning ($cisWarn)</label>")
    }
    if ($cisReview -gt 0) {
        $null = $complianceHtml.AppendLine("<label class='status-checkbox status-review'><input type='checkbox' value='review' checked> Review ($cisReview)</label>")
    }
    $null = $complianceHtml.AppendLine("<label class='status-checkbox status-pass'><input type='checkbox' value='pass' checked> Pass ($cisPass)</label>")
    if ($cisUnknown -gt 0) {
        $null = $complianceHtml.AppendLine("<label class='status-checkbox status-unknown'><input type='checkbox' value='unknown' checked> Unknown ($cisUnknown)</label>")
    }
    $null = $complianceHtml.AppendLine("<span class='fw-selector-actions'><button type='button' id='statusSelectAll' class='fw-action-btn'>All</button><button type='button' id='statusSelectNone' class='fw-action-btn'>None</button></span>")
    $null = $complianceHtml.AppendLine("</div>")

    # Unified compliance matrix table (all frameworks as columns)
    $null = $complianceHtml.AppendLine("<div class='table-wrapper'>")
    $null = $complianceHtml.AppendLine("<table class='data-table matrix-table' id='complianceTable'>")

    # Header row — fixed columns + one column per framework
    $headerCols = "<th scope='col'>Control</th><th scope='col'>Description</th><th scope='col'>Status</th>"
    foreach ($fwKey in $allFrameworkKeys) {
        $fwInfo = $frameworkLookup[$fwKey]
        $headerCols += "<th scope='col' class='fw-col' data-fw='$($fwInfo.Col)'>$($fwInfo.Label)</th>"
    }
    $null = $complianceHtml.AppendLine("<thead><tr>$headerCols</tr></thead>")
    $null = $complianceHtml.AppendLine("<tbody>")

    # Sort findings by CheckId (groups by collector area)
    $matrixFindings = @($allCisFindings | Sort-Object -Property CheckId)
    foreach ($finding in $matrixFindings) {
        $statusClass = switch ($finding.Status) {
            'Pass'    { 'badge-success' }
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-info' }
            default   { 'badge-skipped' }
        }
        $statusBadge = "<span class='badge $statusClass'>$($finding.Status)</span>"
        $checkRef = ConvertTo-HtmlSafe -Text $finding.CheckId
        $settingText = ConvertTo-HtmlSafe -Text $finding.Setting

        $null = $complianceHtml.AppendLine("<tr class='cis-row-$($finding.Status.ToLower())'>")
        $null = $complianceHtml.AppendLine("<td class='cis-id'>$checkRef</td>")
        $null = $complianceHtml.AppendLine("<td>$settingText</td>")
        $null = $complianceHtml.AppendLine("<td>$statusBadge</td>")

        # One cell per framework
        foreach ($fwKey in $allFrameworkKeys) {
            $fwInfo = $frameworkLookup[$fwKey]
            $col = $fwInfo.Col
            $val = $finding.$col
            if ($val -and $val -ne '') {
                $tags = ($val -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | ForEach-Object {
                    "<span class='fw-tag $($fwInfo.Css)'>$(ConvertTo-HtmlSafe -Text $_)</span>"
                }) -join ''
                $null = $complianceHtml.AppendLine("<td class='fw-col framework-refs' data-fw='$col'>$tags</td>")
            }
            else {
                $null = $complianceHtml.AppendLine("<td class='fw-col framework-refs' data-fw='$col'><span class='fw-unmapped'>&mdash;</span></td>")
            }
        }
        $null = $complianceHtml.AppendLine("</tr>")
    }

    $null = $complianceHtml.AppendLine("</tbody></table>")
    $null = $complianceHtml.AppendLine("</div>")
    $null = $complianceHtml.AppendLine("</details>")
}

# ------------------------------------------------------------------
# Build issues HTML
# ------------------------------------------------------------------
$issuesHtml = [System.Text.StringBuilder]::new()
if ($issues.Count -gt 0) {
    $null = $issuesHtml.AppendLine("<details class='section' open>")
    $null = $issuesHtml.AppendLine("<summary><h2>Technical Issues</h2></summary>")
    $null = $issuesHtml.AppendLine("<table class='data-table'>")
    $null = $issuesHtml.AppendLine("<thead><tr><th scope='col'>Severity</th><th scope='col'>Section</th><th scope='col'>Collector</th><th scope='col'>Description</th><th scope='col'>Recommended Action</th></tr></thead>")
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

# Append conditional entries to TOC now that compliance/issues counts are known
if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) {
    $null = $tocHtml.AppendLine("<li><a href='#compliance-overview'>Compliance Overview</a></li>")
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
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
            --m365a-success: #2ecc71;
            --m365a-warning: #f39c12;
            --m365a-danger: #e74c3c;
            --m365a-info: #3498db;
            --m365a-success-bg: #d4edda;
            --m365a-warning-bg: #fff3cd;
            --m365a-danger-bg: #f8d7da;
            --m365a-info-bg: #d1ecf1;
            --m365a-body-bg: #ffffff;
            --m365a-text: #1E293B;
            --m365a-card-bg: #ffffff;
            --m365a-hover-bg: #e8f4f8;
        }

        body.dark-theme {
            --m365a-primary: #60A5FA;
            --m365a-dark-primary: #93C5FD;
            --m365a-accent: #3B82F6;
            --m365a-dark: #F1F5F9;
            --m365a-dark-gray: #E2E8F0;
            --m365a-medium-gray: #94A3B8;
            --m365a-light-gray: #1E293B;
            --m365a-border: #334155;
            --m365a-white: #0F172A;
            --m365a-body-bg: #0F172A;
            --m365a-text: #E2E8F0;
            --m365a-card-bg: #1E293B;
            --m365a-hover-bg: #1E3A5F;
            --m365a-success: #34D399;
            --m365a-warning: #FBBF24;
            --m365a-danger: #F87171;
            --m365a-info: #60A5FA;
            --m365a-success-bg: #064E3B;
            --m365a-warning-bg: #78350F;
            --m365a-danger-bg: #7F1D1D;
            --m365a-info-bg: #1E3A5F;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 13pt;
            line-height: 1.65;
            color: var(--m365a-text);
            background: var(--m365a-body-bg);
        }

        a { color: var(--m365a-primary); }
        a:hover { color: var(--m365a-accent); }

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
            max-width: 500px;
            height: auto;
            margin-bottom: 40px;
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
           Executive Summary Hero
           ---------------------------------------------------------- */
        .exec-hero {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 30px;
            padding: 28px 32px;
            margin: 0 0 24px 0;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            border-radius: 10px;
        }
        .exec-hero-title {
            font-size: 20pt;
            font-weight: 700;
            color: var(--m365a-dark);
            margin: 0 0 8px 0;
            border: none;
            padding: 0;
        }
        .exec-hero-desc {
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
            line-height: 1.5;
            margin: 0 0 16px 0;
        }
        .exec-hero-donut {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .exec-hero-stats {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .exec-hero-stat {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 9.5pt;
        }
        .exec-hero-center {
            display: flex;
            align-items: center;
            padding: 0 20px;
            border-left: 1px solid var(--m365a-border);
            border-right: 1px solid var(--m365a-border);
        }
        .exec-hero-metrics {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .exec-hero-metric {
            text-align: center;
            padding: 12px 16px;
            background: var(--m365a-card-bg);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
            min-width: 100px;
        }
        .exec-hero-metric-value {
            font-size: 22pt;
            font-weight: 700;
            color: var(--m365a-accent);
            line-height: 1.1;
        }
        .exec-hero-metric-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }
        .exec-hero-right {
            display: flex;
            flex-direction: column;
        }
        .exec-hero-toc-label {
            font-size: 9pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 2px solid var(--m365a-border);
        }
        .exec-hero-toc {
            list-style: decimal;
            padding-left: 18px;
            margin: 0;
        }
        .exec-hero-toc li {
            padding: 3px 0;
            font-size: 9.5pt;
        }
        .exec-hero-toc a {
            color: var(--m365a-dark);
            text-decoration: none;
            transition: color 0.15s;
        }
        .exec-hero-toc a:hover {
            color: var(--m365a-accent);
        }
        .exec-alert {
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 9.5pt;
            margin: 0 0 8px 0;
            line-height: 1.5;
        }
        .exec-alert a { color: var(--m365a-accent); text-decoration: none; }
        .exec-alert a:hover { text-decoration: underline; }
        .exec-alert-warn {
            background: var(--m365a-warning-bg);
            border-left: 3px solid var(--m365a-warning);
            color: var(--m365a-dark);
        }
        .exec-alert-info {
            background: var(--m365a-info-bg);
            border-left: 3px solid var(--m365a-accent);
            color: var(--m365a-dark);
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

        .cloud-badge {
            display: inline-block;
            padding: 3px 12px;
            border-radius: 4px;
            font-size: 10pt;
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        .cloud-commercial {
            background: #e8f0fe;
            color: #1a73e8;
            border: 1px solid #c5d9f7;
        }
        .cloud-gcc {
            background: #e6f4ea;
            color: #137333;
            border: 1px solid #b7e1c5;
        }
        .cloud-gcchigh {
            background: #fef3e0;
            color: #c26401;
            border: 1px solid #f5d9a8;
        }
        .cloud-dod {
            background: #fce8e6;
            color: #c5221f;
            border: 1px solid #f5b7b1;
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
           SVG Donut Charts
           ---------------------------------------------------------- */
        .donut-chart { display: block; margin: 0 auto; }
        .donut-track { stroke: var(--m365a-border); }
        .donut-fill { transition: stroke-dashoffset 0.6s ease, opacity 0.15s ease, stroke-width 0.15s ease; }
        .donut-success { stroke: var(--m365a-success); }
        .donut-warning { stroke: var(--m365a-warning); }
        .donut-danger { stroke: var(--m365a-danger); }
        .donut-info { stroke: var(--m365a-accent); }
        .donut-text { font-size: 22px; font-weight: 700; fill: var(--m365a-text); font-family: inherit; }
        .donut-text-sm { font-size: 16px; }
        /* Donut segment highlight on legend hover */
        .dash-panel.donut-hover-active .donut-fill { opacity: 0.3; }
        .dash-panel.donut-hover-active .donut-fill.donut-highlight { opacity: 1; stroke-width: 16; }
        .score-detail-row { transition: background 0.15s ease; border-radius: 4px; }
        .score-detail-row.donut-highlight { background: var(--m365a-hover-bg); }

        .chart-panel {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 24px;
            align-items: center;
            margin: 20px 0;
            padding: 20px;
            background: var(--m365a-light-gray);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
        }
        .chart-panel-center {
            grid-template-columns: 1fr;
            justify-items: center;
        }
        .chart-legend {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .chart-legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 10pt;
        }
        .chart-legend-dot {
            width: 12px; height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .chart-legend-dot.dot-success { background: var(--m365a-success); }
        .chart-legend-dot.dot-warning { background: var(--m365a-warning); }
        .chart-legend-dot.dot-danger { background: var(--m365a-danger); }
        .chart-legend-dot.dot-info { background: var(--m365a-accent); }
        .chart-legend-dot.dot-muted { background: var(--m365a-medium-gray); }

        /* Dash panel — donut + details side-by-side */
        .dash-panel {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 20px;
            align-items: center;
            padding: 24px;
            background: var(--m365a-light-gray);
            border-radius: 8px;
            border: 1px solid var(--m365a-border);
        }
        .dash-panel-donut { text-align: center; }
        .score-donut-label {
            margin-top: 8px;
            font-size: 9pt;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
        }
        .dash-panel-details {
            display: flex;
            flex-direction: column;
            gap: 0;
        }
        .score-detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid var(--m365a-border);
        }
        .score-detail-row:last-child { border-bottom: none; }
        .score-detail-label {
            font-size: 10pt;
            color: var(--m365a-medium-gray);
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .score-detail-value {
            font-size: 16pt;
            font-weight: 700;
            color: var(--m365a-dark);
        }
        .score-detail-max {
            font-size: 11pt;
            font-weight: 400;
            color: var(--m365a-medium-gray);
        }
        .score-delta { font-size: 9pt; }
        .score-delta .score-detail-value { font-size: 11pt; }
        .success-text { color: var(--m365a-success); }
        .warning-text { color: var(--m365a-warning); }
        .danger-text { color: var(--m365a-danger); }

        /* Horizontal bar chart */
        .hbar-chart {
            display: flex;
            height: 28px;
            border-radius: 6px;
            overflow: hidden;
            margin: 12px 0;
            background: var(--m365a-border);
        }
        .hbar-segment {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            transition: width 0.4s ease;
        }
        .hbar-label {
            font-size: 8pt;
            font-weight: 600;
            color: #fff;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .hbar-pass { background: var(--m365a-success); }
        .hbar-fail { background: var(--m365a-danger); }
        .hbar-warning { background: var(--m365a-warning); }
        .hbar-review { background: var(--m365a-accent); }
        .hbar-unknown { background: var(--m365a-medium-gray); }
        .hbar-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: 9pt; color: var(--m365a-medium-gray); }
        .hbar-legend-item { display: inline-flex; align-items: center; gap: 5px; }
        .compliance-status-bar { padding: 16px 20px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 8px; margin: 16px 0; }
        .compliance-bar-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .compliance-bar-title { font-weight: 600; font-size: 10pt; color: var(--m365a-dark); }
        .compliance-bar-total { font-size: 9pt; color: var(--m365a-medium-gray); }

        /* Identity donut stack (MFA & SSPR side-by-side in dashboard) */
        .id-donut-stack {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .id-donut-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
        }
        .id-donut-chart { flex-shrink: 0; }
        .id-donut-info { min-width: 0; }
        .id-donut-title {
            font-size: 10pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }
        .id-donut-detail {
            font-size: 8.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 2px;
        }
        /* Color-coded identity metric cards */
        .id-metric-danger { border-left: 3px solid var(--m365a-danger); }
        .id-metric-danger .email-metric-value { color: var(--m365a-danger); }
        .id-metric-success .email-metric-value { color: var(--m365a-success); }
        .id-metric-warning { border-left: 3px solid var(--m365a-warning); }
        .id-metric-warning .email-metric-value { color: var(--m365a-warning); }

        /* ----------------------------------------------------------
           Score Progress Bar
           ---------------------------------------------------------- */
        .score-bar-track {
            background: var(--m365a-border);
            border-radius: 8px;
            height: 12px;
            margin: 0 0 20px 0;
            overflow: hidden;
        }

        .score-bar-fill {
            height: 100%;
            border-radius: 8px;
        }
        .score-bar-fill.success { background: var(--m365a-success); }
        .score-bar-fill.warning { background: var(--m365a-warning); }
        .score-bar-fill.danger { background: var(--m365a-danger); }

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

        .stat-card .stat-value-sm { font-size: 18pt; }

        .stat-card.success { border-top-color: var(--m365a-success); }
        .stat-card.success .stat-value { color: var(--m365a-success); }
        .stat-card.warning { border-top-color: var(--m365a-warning); }
        .stat-card.warning .stat-value { color: var(--m365a-warning); }
        .stat-card.danger { border-top-color: var(--m365a-danger); }
        .stat-card.danger .stat-value { color: var(--m365a-danger); }
        .stat-card.error { border-top-color: var(--m365a-primary); }
        .stat-card.info { border-top-color: var(--m365a-accent); }

        /* ----------------------------------------------------------
           Email Dashboard (combined overview)
           ---------------------------------------------------------- */
        .email-dashboard {
            margin: 20px 0;
            padding: 24px;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            border-radius: 10px;
        }
        .email-dash-top {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
        }
        .email-dash-col { min-width: 0; }
        .email-dash-heading {
            font-size: 10pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--m365a-medium-gray);
            margin-bottom: 14px;
            padding-bottom: 8px;
            border-bottom: 2px solid var(--m365a-border);
        }
        .email-dash-dns {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--m365a-border);
        }
        .dns-stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
            margin-top: 12px;
        }
        /* Compact 2-column grid for DNS stats inside a dashboard column */
        .dns-stats-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 8px;
        }
        .dns-stats-col .dns-stat {
            padding: 8px 6px;
        }
        .dns-stats-col .dns-stat-value {
            font-size: 12pt;
        }
        /* Email Policies — responsive grid below the 3-column dashboard row */
        .email-dash-policies {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--m365a-border);
        }
        .policy-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 10px;
            margin-top: 8px;
        }
        .dns-stat {
            text-align: center;
            padding: 12px 8px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            border-top: 3px solid var(--m365a-primary);
        }
        .dns-stat.success { border-top-color: var(--m365a-success); }
        .dns-stat.warning { border-top-color: var(--m365a-warning); }
        .dns-stat.danger { border-top-color: var(--m365a-danger); }
        .dns-stat-value {
            font-size: 16pt;
            font-weight: bold;
            color: var(--m365a-dark);
        }
        .dns-stat.success .dns-stat-value { color: var(--m365a-success); }
        .dns-stat.warning .dns-stat-value { color: var(--m365a-warning); }
        .dns-stat.danger .dns-stat-value { color: var(--m365a-danger); }
        .dns-stat-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
        }
        .dns-stat-detail {
            font-size: 7.5pt;
            color: var(--m365a-medium-gray);
            margin-top: 2px;
        }
        .dns-protocols {
            margin-top: 12px;
        }
        .dns-protocols summary {
            font-size: 9pt;
            font-weight: 600;
            color: var(--m365a-accent);
            cursor: pointer;
            padding: 6px 0;
        }
        .dns-protocols summary:hover { text-decoration: underline; }
        .dns-protocols-body {
            font-size: 9pt;
            color: var(--m365a-medium-gray);
            line-height: 1.6;
            padding: 10px 0;
        }
        .dns-protocols-body p { margin: 6px 0; }
        .dns-protocols-body code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 8.5pt;
        }
        .dns-protocols-body a { color: var(--m365a-accent); text-decoration: none; }
        .dns-protocols-body a:hover { text-decoration: underline; }

        /* Mailbox metrics within dashboard */
        .email-metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .hybrid-env-grid {
            grid-template-columns: 1fr;
        }
        .email-metric-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: var(--m365a-card-bg);
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
        }
        .email-metric-icon {
            font-size: 18pt;
            line-height: 1;
            flex-shrink: 0;
        }
        .email-metric-body { min-width: 0; }
        .email-metric-value {
            font-size: 16pt;
            font-weight: bold;
            color: var(--m365a-dark);
            line-height: 1.1;
        }
        .email-metric-label {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 1px;
        }

        /* Dashboard card hover — subtle highlight for presentations */
        .email-metric-card,
        .id-donut-item,
        .policy-card,
        .dns-stat {
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .email-metric-card:hover,
        .id-donut-item:hover,
        .policy-card:hover,
        .dns-stat:hover {
            background: var(--m365a-hover-bg);
            border-color: var(--m365a-accent);
        }

        /* EXO donut panel within dashboard */
        .email-dash-col .dash-panel {
            border: none;
            padding: 0;
            background: transparent;
        }

        /* Policy cards within dashboard */
        .policy-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .policy-card {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            border-radius: 6px;
            border: 1px solid var(--m365a-border);
            background: var(--m365a-card-bg);
        }
        .policy-card.policy-enabled {
            border-left: 4px solid var(--m365a-success);
        }
        .policy-card.policy-disabled {
            border-left: 4px solid var(--m365a-danger);
        }
        .policy-status-badge {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12pt;
            font-weight: bold;
            flex-shrink: 0;
        }
        .policy-enabled .policy-status-badge {
            background: var(--m365a-success-bg);
            color: var(--m365a-success);
        }
        .policy-disabled .policy-status-badge {
            background: var(--m365a-danger-bg);
            color: var(--m365a-danger);
        }
        .policy-info { flex: 1; min-width: 0; }
        .policy-name {
            font-size: 9.5pt;
            font-weight: 600;
            color: var(--m365a-dark);
        }
        .policy-detail {
            font-size: 8pt;
            color: var(--m365a-medium-gray);
            margin-top: 1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .policy-status-label {
            font-size: 8.5pt;
            font-weight: 600;
            flex-shrink: 0;
        }
        .policy-enabled .policy-status-label { color: var(--m365a-success); }
        .policy-disabled .policy-status-label { color: var(--m365a-danger); }

        .cis-disclaimer {
            background: var(--m365a-info-bg);
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
           Section Advisory Blocks
           ---------------------------------------------------------- */
        .section-advisory {
            background: var(--m365a-light-gray);
            border-left: 3px solid var(--m365a-accent);
            padding: 15px 18px;
            margin: 12px 0 8px 0;
            border-radius: 0 6px 6px 0;
            font-size: 9.5pt;
            color: var(--m365a-medium-gray);
            line-height: 1.5;
        }
        .section-advisory strong { color: var(--m365a-dark); }
        .section-advisory p { margin: 6px 0; }
        .section-advisory code {
            background: var(--m365a-border);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 9pt;
        }
        .section-advisory .advisory-links {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid var(--m365a-border);
            font-size: 8.5pt;
        }
        .section-advisory .advisory-links a {
            color: var(--m365a-accent);
            text-decoration: none;
        }
        .section-advisory .advisory-links a:hover { text-decoration: underline; }

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

        /* Collector chip grid — compact status display */
        .collector-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 8px 0 18px 0;
        }

        .collector-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px 5px 10px;
            border-radius: 6px;
            font-size: 8.5pt;
            background: var(--m365a-light-gray);
            border: 1px solid var(--m365a-border);
            line-height: 1.3;
            max-width: 340px;
        }

        .chip-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .chip-complete .chip-dot { background: var(--m365a-success); }
        .chip-skipped .chip-dot  { background: var(--m365a-medium-gray); }
        .chip-failed .chip-dot   { background: var(--m365a-danger); }

        .chip-name {
            font-weight: 500;
            color: var(--m365a-text);
            white-space: nowrap;
        }

        .chip-count {
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            color: var(--m365a-medium-gray);
            margin-left: 2px;
        }

        .chip-count::before { content: '\00B7\00A0'; }

        .chip-note {
            font-size: 7.5pt;
            color: var(--m365a-danger);
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            transition: max-width 0.2s ease, white-space 0.2s ease;
        }
        .chip-note.expanded {
            max-width: 600px;
            white-space: normal;
            word-break: break-word;
        }

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
        tr:hover { background: var(--m365a-hover-bg); }

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

        .badge-complete { background: var(--m365a-success-bg); color: #155724; }
        .badge-success { background: var(--m365a-success-bg); color: #155724; }
        .badge-skipped { background: #e2e3e5; color: #383d41; }
        .badge-failed { background: var(--m365a-danger-bg); color: #721c24; }
        .badge-warning { background: var(--m365a-warning-bg); color: #856404; }
        .badge-info { background: var(--m365a-info-bg); color: #0c5460; }

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

        .data-table th:hover { background: var(--m365a-dark-gray); }

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

        .cis-row-fail { border-left: 3px solid var(--m365a-danger); background-color: var(--m365a-danger-bg); }
        .cis-row-warning { border-left: 3px solid var(--m365a-warning); background-color: var(--m365a-warning-bg); }
        .cis-row-review { border-left: 3px solid var(--m365a-accent); background-color: var(--m365a-info-bg); }
        .cis-row-unknown { border-left: 3px solid var(--m365a-medium-gray); background-color: var(--m365a-light-gray); }

        /* Framework cross-reference tags */
        .framework-refs { white-space: normal; max-width: 260px; }
        .fw-tag { display: inline-block; padding: 1px 5px; margin: 1px; border-radius: 3px; font-size: 0.72em; font-family: 'Consolas', 'Courier New', monospace; }
        .fw-cis    { background: #e8f0fe; color: #1a56db; }
        .fw-cis-l2 { background: #dbeafe; color: #1e40af; }
        .fw-nist   { background: #e8f0fe; color: #1a56db; }
        .fw-csf   { background: #fef3c7; color: #92400e; }
        .fw-iso   { background: #ecfdf5; color: #065f46; }
        .fw-stig  { background: #f3e8ff; color: #6b21a8; }
        .fw-pci   { background: #fef2f2; color: #991b1b; }
        .fw-cmmc  { background: #f0fdfa; color: #134e4a; }
        .fw-hipaa { background: #fdf2f8; color: #9d174d; }
        .fw-scuba { background: #fff7ed; color: #9a3412; }
        .fw-soc2  { background: #eff6ff; color: #1e3a5f; }
        .fw-unmapped { color: var(--m365a-border); font-size: 0.85em; }

        /* Framework multi-selector */
        .fw-selector { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 10px 14px; margin: 12px 0; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .fw-selector-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
        .fw-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
        .fw-checkbox:hover { background: var(--m365a-hover-bg); border-color: var(--m365a-accent); }
        .fw-checkbox.active { background: var(--m365a-dark); color: #fff; border-color: var(--m365a-dark); }
        .fw-checkbox input[type="checkbox"] { display: none; }
        .fw-selector-actions { margin-left: auto; display: flex; gap: 4px; }
        .fw-action-btn { padding: 3px 10px; border: 1px solid var(--m365a-border); border-radius: 3px; background: var(--m365a-card-bg); cursor: pointer; font-size: 0.78em; color: var(--m365a-medium-gray); }
        .fw-action-btn:hover { background: var(--m365a-hover-bg); }

        /* Status filter */
        .status-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 14px; margin: 0 0 12px; background: var(--m365a-light-gray); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .status-filter-label { font-weight: 600; font-size: 0.85em; color: var(--m365a-dark); margin-right: 4px; }
        .status-checkbox { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--m365a-border); border-radius: 4px; font-size: 0.82em; cursor: pointer; transition: all 0.15s; background: var(--m365a-card-bg); user-select: none; }
        .status-checkbox:hover { border-color: var(--m365a-accent); }
        .status-checkbox input[type="checkbox"] { display: none; }
        .status-fail.active { background: #fef2f2; color: #991b1b; border-color: #fca5a5; font-weight: 600; }
        .status-warning.active { background: #fffbeb; color: #92400e; border-color: #fcd34d; font-weight: 600; }
        .status-review.active { background: #f0f9ff; color: #1e40af; border-color: #93c5fd; font-weight: 600; }
        .status-pass.active { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; font-weight: 600; }
        .status-unknown.active { background: #f9fafb; color: #6b7280; border-color: #d1d5db; font-weight: 600; }

        /* Matrix table */
        .matrix-table td { vertical-align: top; }
        .matrix-table .framework-refs { max-width: 180px; }

        /* ----------------------------------------------------------
           Theme Toggle
           ---------------------------------------------------------- */
        .theme-toggle {
            position: fixed; top: 16px; right: 16px; z-index: 1000;
            background: var(--m365a-card-bg); border: 1px solid var(--m365a-border);
            border-radius: 50%; width: 44px; height: 44px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2); transition: all 0.3s ease;
            font-size: 18px; line-height: 1; padding: 0;
        }
        body.dark-theme .theme-toggle {
            background: #E2E8F0; border-color: #CBD5E1;
            box-shadow: 0 2px 12px rgba(0,0,0,0.5);
            color: #1E293B;
        }
        .theme-toggle:hover { transform: scale(1.1); }
        body:not(.dark-theme) .theme-icon-dark { display: none; }
        body.dark-theme .theme-icon-light { display: none; }

        /* ----------------------------------------------------------
           Dark Theme Selector Overrides
           (CSS variables handle most colors; these fix elements
            with hardcoded colors or inverted semantics)
           ---------------------------------------------------------- */
        body.dark-theme th {
            background: #1E3A5F;
            color: #E2E8F0;
            border-right: 1px solid rgba(255,255,255,0.15);
        }
        body.dark-theme th:last-child { border-right: none; }
        body.dark-theme .data-table th:hover { background: #254E78; }

        body.dark-theme .badge-complete,
        body.dark-theme .badge-success { background: #065F46; color: #6EE7B7; }
        body.dark-theme .badge-failed { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .badge-warning { background: #78350F; color: #FCD34D; }
        body.dark-theme .badge-info { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .badge-skipped { background: #334155; color: #94A3B8; }

        body.dark-theme .fw-cis    { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-cis-l2 { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist   { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-csf    { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-iso    { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-stig   { background: #3B0764; color: #C4B5FD; }
        body.dark-theme .fw-pci    { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cmmc   { background: #134E4A; color: #5EEAD4; }
        body.dark-theme .fw-hipaa  { background: #831843; color: #F9A8D4; }
        body.dark-theme .fw-scuba  { background: #7C2D12; color: #FDBA74; }
        body.dark-theme .fw-soc2   { background: #1E3A5F; color: #60A5FA; }

        body.dark-theme .cloud-commercial { background: #1E3A5F; color: #93C5FD; border-color: #334155; }
        body.dark-theme .cloud-gcc { background: #064E3B; color: #6EE7B7; border-color: #334155; }
        body.dark-theme .cloud-gcchigh { background: #78350F; color: #FCD34D; border-color: #334155; }
        body.dark-theme .cloud-dod { background: #7F1D1D; color: #FCA5A5; border-color: #334155; }

        body.dark-theme .fw-checkbox.active { background: #3B82F6; color: #ffffff; border-color: #3B82F6; }
        body.dark-theme .status-fail.active { background: #7F1D1D; color: #FCA5A5; border-color: #991B1B; }
        body.dark-theme .status-warning.active { background: #78350F; color: #FCD34D; border-color: #92400E; }
        body.dark-theme .status-review.active { background: #1E3A5F; color: #93C5FD; border-color: #1E40AF; }
        body.dark-theme .status-pass.active { background: #064E3B; color: #6EE7B7; border-color: #065F46; }
        body.dark-theme .status-unknown.active { background: #334155; color: #94A3B8; border-color: #475569; }

        body.dark-theme .cis-disclaimer { background: #1E293B; }
        body.dark-theme .section-advisory code { background: #334155; color: #E2E8F0; }

        body.dark-theme .cover-page {
            background-color: #1E293B;
            color: #F1F5F9;
        }
        body.dark-theme .cover-title { color: #F1F5F9; }
        body.dark-theme .cover-subtitle { color: #E2E8F0; }
        body.dark-theme .cover-tenant { color: #60A5FA; }
        body.dark-theme .cover-date { color: #94A3B8; opacity: 1; }

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
           Focus Styles
           ---------------------------------------------------------- */
        a:focus-visible, .theme-toggle:focus-visible, .data-table th:focus-visible {
            outline: 2px solid var(--m365a-accent);
            outline-offset: 2px;
        }

        /* ----------------------------------------------------------
           Print Styles
           ---------------------------------------------------------- */
        @media print {
            body { font-size: 9pt; }
            .theme-toggle { display: none; }

            /* --- Fix 6: Force light theme for print --- */
            body.dark-theme {
                --m365a-primary: #2563EB;
                --m365a-dark-primary: #1D4ED8;
                --m365a-accent: #60A5FA;
                --m365a-dark: #0F172A;
                --m365a-dark-gray: #1E293B;
                --m365a-medium-gray: #64748B;
                --m365a-light-gray: #F1F5F9;
                --m365a-border: #CBD5E1;
                --m365a-white: #ffffff;
                --m365a-body-bg: #ffffff;
                --m365a-text: #1E293B;
                --m365a-card-bg: #ffffff;
                --m365a-hover-bg: #e8f4f8;
                --m365a-success: #2ecc71;
                --m365a-warning: #f39c12;
                --m365a-danger: #e74c3c;
                --m365a-info: #3498db;
                --m365a-success-bg: #d4edda;
                --m365a-warning-bg: #fff3cd;
                --m365a-danger-bg: #f8d7da;
                --m365a-info-bg: #d1ecf1;
            }

            .cover-page {
                min-height: auto;
                height: 100vh;
                page-break-after: always;
            }

            .content { padding: 20px 30px; }

            h1 { font-size: 18pt; margin-top: 20px; }
            h2 { font-size: 14pt; margin-top: 20px; }

            /* --- Fix 4: Table header repetition and spacing --- */
            thead { display: table-header-group; }
            thead th { position: static !important; }
            table { font-size: 8pt; }
            th { padding: 6px 8px; }
            td { padding: 5px 8px; }

            /* --- Fix 7: Tighten compliance framework cards --- */
            .exec-summary { grid-template-columns: repeat(4, 1fr); gap: 12px; }
            .stat-card { padding: 12px; }
            .stat-value { font-size: 22pt; }

            /* --- Fix 1: Switch dashboards to 2-column grid --- */
            .email-dashboard { page-break-inside: auto; padding: 12px; }
            .email-dash-top { grid-template-columns: 1fr 1fr; page-break-inside: auto; }
            .email-metrics-grid { grid-template-columns: 1fr; }

            /* --- Fix 2: Scale down donut SVGs --- */
            .donut-chart { max-width: 100px; height: auto; }
            .dash-panel-donut .donut-chart { max-width: 90px; }
            .id-donut-chart .donut-chart { max-width: 80px; }

            /* --- Fix 5: Reduce spacing and padding for print density --- */
            .email-metric-card { padding: 6px 8px; gap: 6px; }
            .email-metric-icon { font-size: 14pt; }
            .email-metric-value { font-size: 12pt; }
            .email-metric-label { font-size: 7pt; }
            .score-detail-value { font-size: 12pt; }
            .score-detail-label { font-size: 8pt; }
            .id-donut-item { padding: 6px 8px; gap: 8px; }
            .id-donut-title { font-size: 8pt; }
            .id-donut-detail { font-size: 7pt; }
            .dash-panel { gap: 10px; padding: 10px; }
            .dns-stat { padding: 8px 4px; }
            .dns-stat-value { font-size: 12pt; }
            .policy-card { padding: 6px 10px; }

            .dns-stats-row { grid-template-columns: repeat(6, 1fr); }
            .dns-stats-col { grid-template-columns: 1fr 1fr; gap: 6px; }
            .dns-stats-col .dns-stat { padding: 4px 3px; }
            .dns-stats-col .dns-stat-value { font-size: 10pt; }
            .policy-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .email-dash-policies { margin-top: 12px; padding-top: 10px; }
            .dns-protocols { display: block; }
            .dns-protocols-body { display: block; }
            .chart-panel { page-break-inside: avoid; }

            /* --- Fix 3: Allow dashboards to break across pages --- */
            .id-donut-stack { page-break-inside: auto; }
            .exec-hero { page-break-inside: avoid; page-break-after: always; grid-template-columns: 1fr auto 1fr; }
            .exec-hero-center { border-left: none; border-right: none; padding: 0 10px; }
            .tenant-card { page-break-inside: avoid; }
            .tenant-facts { grid-template-columns: repeat(3, 1fr); }
            .tenant-meta { font-size: 8pt; }
            .domain-tag { font-size: 8pt; padding: 2px 6px; }

            /* --- Section / details expansion for print --- */
            .section { page-break-inside: auto; }
            details.section { border: none; padding: 0; }
            details.section > summary { pointer-events: none; }
            details.section > summary h2::after { display: none; }
            details:not([open]) > *:not(summary) { display: block !important; }
            .collector-detail { border: none; }
            .collector-detail > summary {
                pointer-events: none;
                background: none;
                border: none;
                page-break-after: avoid;
            }
            .collector-detail > summary h3::after { display: none; }
            .collector-detail .table-wrapper { max-height: none !important; overflow: visible !important; }
            .data-table th::after { display: none; }
            .data-table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
            .fw-selector { display: none; }
            .status-filter { display: none; }
            .matrix-table tr { display: table-row !important; }
            .fw-col { display: table-cell !important; }

            /* --- Fix 8: Hide hover effects in print --- */
            .email-metric-card:hover,
            .id-donut-item:hover,
            .policy-card:hover,
            .dns-stat:hover { background: inherit; border-color: inherit; }
            tr:hover { background: inherit; }
            .dash-panel.donut-hover-active .donut-fill { opacity: 1; }
            .score-detail-row.donut-highlight { background: inherit; }

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
    <!-- Theme Toggle -->
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode" title="Toggle light/dark mode">
        <span class="theme-icon-light">&#9788;</span>
        <span class="theme-icon-dark">&#9790;</span>
    </button>

    <!-- Cover Page -->
    <header class="cover-page">
        $logoImgTag
        <div class="cover-title">M365 Environment</div>
        <div class="cover-title" style="margin-top: 0;">Assessment Report</div>
        <div class="cover-divider"></div>
        <div class="cover-tenant">$(ConvertTo-HtmlSafe -Text $TenantName)</div>
        <div class="cover-subtitle">$assessmentDate</div>
        <div class="cover-date">v$assessmentVersion</div>
    </header>

    <!-- Content -->
    <main class="content">
        <!-- Executive Summary — Hero Panel -->
        <div class="exec-hero">
            <div class="exec-hero-left">
                <h1 class="exec-hero-title">Executive Summary</h1>
                <p class="exec-hero-desc">Microsoft 365 environment assessment for
                <strong>$(ConvertTo-HtmlSafe -Text $TenantName)</strong> conducted on
                <strong>$assessmentDate</strong>.</p>
                <div class="exec-hero-donut">
                    $(
                        $completePct = if ($totalCollectors -gt 0) { [math]::Round(($completeCount / $totalCollectors) * 100, 0) } else { 0 }
                        $donutClass = if ($completePct -ge 90) { 'success' } elseif ($completePct -ge 70) { 'warning' } else { 'danger' }
                        Get-SvgDonut -Percentage $completePct -CssClass $donutClass -Label "$completeCount/$totalCollectors" -Size 120 -StrokeWidth 10
                    )
                    <div class="exec-hero-stats">
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-success"></span><strong>$completeCount</strong> Completed</div>
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-warning"></span><strong>$skippedCount</strong> Skipped</div>
                        <div class="exec-hero-stat"><span class="chart-legend-dot dot-danger"></span><strong>$failedCount</strong> Failed</div>
                    </div>
                </div>
            </div>
            <div class="exec-hero-center">
                <div class="exec-hero-metrics">
                    <div class="exec-hero-metric">
                        <div class="exec-hero-metric-value">$totalCollectors</div>
                        <div class="exec-hero-metric-label">Config Areas</div>
                    </div>
                    <div class="exec-hero-metric">
                        <div class="exec-hero-metric-value">$($sections.Count)</div>
                        <div class="exec-hero-metric-label">Sections</div>
                    </div>
                    <div class="exec-hero-metric">
                        <div class="exec-hero-metric-value">$($allCisFindings.Count)</div>
                        <div class="exec-hero-metric-label">CIS Controls</div>
                    </div>
                    <div class="exec-hero-metric">
                        <div class="exec-hero-metric-value">12</div>
                        <div class="exec-hero-metric-label">Frameworks</div>
                    </div>
                </div>
            </div>
            <div class="exec-hero-right">
                <div class="exec-hero-toc-label">Sections</div>
                <ol class="exec-hero-toc">
                    $( foreach ($tocSection in $sections) {
                        if ($tocSection -eq 'Tenant') {
                            "<li><a href='#section-tenant'>Organization Profile</a></li>`n"
                        } else {
                            $tocId = ($tocSection -replace '[^a-zA-Z0-9]', '-').ToLower()
                            $tocLabel = [System.Web.HttpUtility]::HtmlEncode($tocSection)
                            "<li><a href='#section-$tocId'>$tocLabel</a></li>`n"
                        }
                    })
                    $( if ($allCisFindings.Count -gt 0 -and $controlRegistry.Count -gt 0) { "<li><a href='#compliance-overview'>Compliance Overview</a></li>`n" })
                    $( if ($issues.Count -gt 0) { "<li><a href='#issues'>Technical Issues</a></li>`n" })
                </ol>
            </div>
        </div>
"@

if ($issues.Count -gt 0) {
    $html += @"

        <div class="exec-alert exec-alert-warn">&#9888; <strong>$($issues.Count) issue(s)</strong> identified:
        $errorCount error(s) and $warningCount warning(s). See <a href="#issues">Technical Issues</a>.</div>
"@
}

if ($allCisFindings.Count -gt 0) {
    $nonPassingCount = @($allCisFindings | Where-Object { $_.Status -ne 'Pass' }).Count
    if ($nonPassingCount -gt 0) {
        $html += @"

        <div class="exec-alert exec-alert-info">&#128270; <strong>$nonPassingCount finding(s)</strong> across
        $($allCisFindings.Count) controls require attention. See <a href="#compliance-overview">Compliance Overview</a>.</div>
"@
    }
}

$html += @"

        $($sectionHtml.ToString())
"@

if ($complianceHtml.Length -gt 0) {
    $html += @"

        <a id="compliance-overview"></a>
        <h1>Compliance Overview</h1>
        $($complianceHtml.ToString())
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
        <footer class="report-footer">
            <p>Generated by <span class="m365a-name">M365 Assess</span>
            M365 Assessment Tool v$assessmentVersion</p>
            <p>$(Get-Date -Format 'MMMM d, yyyy h:mm tt')</p>
        </footer>
    </main>
    <script>
    // Theme toggle
    (function() {
        var toggle = document.getElementById('themeToggle');
        var stored = localStorage.getItem('m365a-theme');
        if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.add('dark-theme');
        }
        if (toggle) {
            toggle.addEventListener('click', function() {
                document.body.classList.toggle('dark-theme');
                localStorage.setItem('m365a-theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
            });
        }
    })();

    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('.data-table').forEach(function(table) {
            var headers = table.querySelectorAll('thead th');
            headers.forEach(function(th, colIndex) {
                th.addEventListener('click', function() {
                    sortTable(table, colIndex, th);
                });
            });
        });

        // --- Framework multi-selector ---
        var selector = document.getElementById('fwSelector');
        if (selector) {
            var checkboxes = selector.querySelectorAll('input[type="checkbox"]');
            var table = document.getElementById('complianceTable');
            var cards = document.querySelectorAll('.fw-card');
            function applyFrameworkFilter() {
                var active = [];
                checkboxes.forEach(function(cb) {
                    var lbl = cb.closest('.fw-checkbox');
                    if (cb.checked) { lbl.classList.add('active'); active.push(cb.value); }
                    else { lbl.classList.remove('active'); }
                });
                // Toggle table columns
                if (table) {
                    var allCols = table.querySelectorAll('.fw-col');
                    allCols.forEach(function(el) {
                        var fw = el.getAttribute('data-fw');
                        el.style.display = active.indexOf(fw) !== -1 ? '' : 'none';
                    });
                }
                // Toggle coverage cards
                cards.forEach(function(card) {
                    var fw = card.getAttribute('data-fw');
                    card.style.display = active.indexOf(fw) !== -1 ? '' : 'none';
                });
            }

            checkboxes.forEach(function(cb) {
                cb.addEventListener('change', applyFrameworkFilter);
            });

            var btnAll = document.getElementById('fwSelectAll');
            var btnNone = document.getElementById('fwSelectNone');
            if (btnAll) btnAll.addEventListener('click', function() {
                checkboxes.forEach(function(cb) { cb.checked = true; });
                applyFrameworkFilter();
            });
            if (btnNone) btnNone.addEventListener('click', function() {
                checkboxes.forEach(function(cb) { cb.checked = false; });
                applyFrameworkFilter();
            });

            // Initialize visual state
            applyFrameworkFilter();
        }

        // --- Status filter (multi-select) ---
        var statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            var statusCbs = statusFilter.querySelectorAll('input[type="checkbox"]');
            var compTable = document.getElementById('complianceTable');
            if (compTable) {
                var compRows = compTable.querySelectorAll('tbody tr');

                function applyStatusFilter() {
                    var active = [];
                    statusCbs.forEach(function(cb) {
                        var lbl = cb.closest('.status-checkbox');
                        if (cb.checked) { lbl.classList.add('active'); active.push(cb.value); }
                        else { lbl.classList.remove('active'); }
                    });
                    compRows.forEach(function(row) {
                        var show = false;
                        for (var i = 0; i < active.length; i++) {
                            if ((row.className || '').indexOf('cis-row-' + active[i]) !== -1) { show = true; break; }
                        }
                        row.style.display = show ? '' : 'none';
                    });
                }

                statusCbs.forEach(function(cb) {
                    cb.addEventListener('change', applyStatusFilter);
                });

                var sAll = document.getElementById('statusSelectAll');
                var sNone = document.getElementById('statusSelectNone');
                if (sAll) sAll.addEventListener('click', function() {
                    statusCbs.forEach(function(cb) { cb.checked = true; });
                    applyStatusFilter();
                });
                if (sNone) sNone.addEventListener('click', function() {
                    statusCbs.forEach(function(cb) { cb.checked = false; });
                    applyStatusFilter();
                });

                applyStatusFilter();
            }
        }
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

    // --- Donut chart interactive highlighting ---
    // Hover a legend row to highlight both the row and its matching SVG segment
    document.querySelectorAll('.dash-panel-details .score-detail-row').forEach(function(row) {
        var dot = row.querySelector('.chart-legend-dot');
        if (!dot) return;
        // Detect segment type from dot-* class
        var seg = null;
        dot.classList.forEach(function(c) {
            if (c.indexOf('dot-') === 0) seg = c.substring(4);
        });
        if (!seg) return;
        var panel = row.closest('.dash-panel');
        if (!panel) return;

        row.addEventListener('mouseenter', function() {
            panel.classList.add('donut-hover-active');
            row.classList.add('donut-highlight');
            panel.querySelectorAll('.donut-fill[data-segment="' + seg + '"]').forEach(function(c) {
                c.classList.add('donut-highlight');
            });
        });
        row.addEventListener('mouseleave', function() {
            panel.classList.remove('donut-hover-active');
            row.classList.remove('donut-highlight');
            panel.querySelectorAll('.donut-fill.donut-highlight').forEach(function(c) {
                c.classList.remove('donut-highlight');
            });
        });
    });
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
