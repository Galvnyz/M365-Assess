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
.PARAMETER NoBranding
    Suppress the open-source project branding on the cover page. Useful for
    white-labeling reports delivered to clients.
.PARAMETER SkipPdf
    Skip PDF generation even if wkhtmltopdf is available on the system.
.PARAMETER SkipComplianceOverview
    Omit the Compliance Overview section from the report. Useful when running
    a single section assessment where framework coverage cards are not relevant.
.PARAMETER SkipCoverPage
    Omit the branded cover page (logo, tenant name, date, version). The report
    starts directly at the executive summary or section content.
.PARAMETER SkipExecutiveSummary
    Omit the executive summary hero panel (donut chart, metrics, TOC, alert
    banners). Useful for data-only exports.
.PARAMETER FrameworkFilter
    Limit the compliance overview to specific framework families. Valid values:
    CIS, NIST, ISO, STIG, PCI, CMMC, HIPAA, CISA, SOC2. Default: all frameworks.
.PARAMETER CustomBranding
    Hashtable for white-label reports. Supported keys: CompanyName (string),
    LogoPath (file path to PNG/JPEG/SVG), AccentColor (hex color like '#1a56db').
.PARAMETER FrameworkExport
    Generate standalone per-framework HTML catalog exports alongside the main report.
    Specify framework families (CIS, NIST, ISO, etc.) or 'All'. Output files are
    named _<Framework>-Catalog_<tenant>.html in the assessment folder.
.PARAMETER CisFrameworkId
    The framework ID for the active CIS benchmark version used for the CisControl
    property and reverse lookup. Defaults to 'cis-m365-v6'. Set to 'cis-m365-v7'
    when CIS v7.0 framework data is available.
.PARAMETER OpenReport
    Automatically open the generated HTML report in the default browser after
    generation. Works on Windows, macOS, and Linux.
.EXAMPLE
    PS> .\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_20260306_195618'

    Generates an HTML report in the assessment folder.
.EXAMPLE
    PS> .\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_20260306_195618' -TenantName 'Contoso Ltd'

    Generates a report with the specified tenant name on the cover page.
.NOTES

    Author:  Daren9m
#>
# Variables set here are consumed by dot-sourced companion files
# (Build-SectionHtml.ps1, Get-ReportTemplate.ps1) via shared scope.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
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
    [switch]$NoBranding,

    [Parameter()]
    [switch]$SkipPdf,

    [Parameter()]
    [switch]$SkipComplianceOverview,

    [Parameter()]
    [switch]$SkipCoverPage,

    [Parameter()]
    [switch]$SkipExecutiveSummary,

    [Parameter()]
    [ValidateSet('CIS','NIST','ISO','STIG','PCI','CMMC','HIPAA','CISA','SOC2','FedRAMP','Essential8','MITRE','CISv8')]
    [string[]]$FrameworkFilter,

    [Parameter()]
    [hashtable]$CustomBranding,

    [Parameter()]
    [ValidateSet('CIS','NIST','ISO','STIG','PCI','CMMC','HIPAA','CISA','SOC2','FedRAMP','Essential8','MITRE','CISv8','All')]
    [string[]]$FrameworkExport,

    [Parameter()]
    [string]$CisFrameworkId = 'cis-m365-v6',

    [Parameter()]
    [switch]$OpenReport,

    [Parameter()]
    [switch]$QuickScan
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ------------------------------------------------------------------
# Load control registry
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1')
$controlsPath = Join-Path -Path $projectRoot -ChildPath 'controls'
$controlRegistry = Import-ControlRegistry -ControlsPath $controlsPath -CisFrameworkId $CisFrameworkId

# ------------------------------------------------------------------
# Framework definitions (auto-discovered from JSON)
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-FrameworkDefinitions.ps1')
$allFrameworks = Import-FrameworkDefinitions -FrameworksPath (Join-Path -Path $projectRoot -ChildPath 'controls/frameworks')

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
    if ($tenantData -and @($tenantData).Count -gt 0 -and $tenantData[0].PSObject.Properties.Name -contains 'OrgDisplayName') {
        $TenantName = $tenantData[0].OrgDisplayName
    }
    elseif ($tenantData -and @($tenantData).Count -gt 0 -and $tenantData[0].PSObject.Properties.Name -contains 'DefaultDomain') {
        $TenantName = $tenantData[0].DefaultDomain
    }
    else {
        $TenantName = 'M365 Tenant'
    }
}

# Domain prefix is written to the log header by the main script — read it from there
# (avoids fragile CSV-scanning; the main script already resolved it from TenantId or Graph)

# Read assessment version and cloud environment from log if available
$assessmentVersion = (Import-PowerShellDataFile -Path "$PSScriptRoot/../M365-Assess.psd1").ModuleVersion
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
# Load report helper functions (needed before asset loading below)
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'ReportHelpers.ps1')

# ------------------------------------------------------------------
# Load and base64-encode logo and background from assets/
# Searches by pattern so any logo-*.png/jpeg or wave/bg-*.png works.
# ------------------------------------------------------------------
$assetsDir = Join-Path -Path $projectRoot -ChildPath 'assets'

$logoAsset = Get-AssetBase64 -Directory $assetsDir -Patterns @('*logo-cropped*white*', '*logo-cropped*', '*logo-white*', '*logo*')
$logoBase64 = if ($logoAsset) { $logoAsset.Base64 } else { '' }
$logoMime   = if ($logoAsset) { $logoAsset.Mime }   else { 'image/png' }

$waveAsset = Get-AssetBase64 -Directory $assetsDir -Patterns @('*wave*', '*bg*')
$waveBase64 = if ($waveAsset) { $waveAsset.Base64 } else { '' }
$waveMime   = if ($waveAsset) { $waveAsset.Mime }   else { 'image/png' }

$brandName = 'M365 Assess'
$accentColor = ''
if ($CustomBranding) {
    if ($CustomBranding.ContainsKey('LogoPath') -and (Test-Path -Path $CustomBranding.LogoPath)) {
        $customLogoBytes = [System.IO.File]::ReadAllBytes($CustomBranding.LogoPath)
        $logoBase64 = [Convert]::ToBase64String($customLogoBytes)
        $ext = [System.IO.Path]::GetExtension($CustomBranding.LogoPath).TrimStart('.').ToLower()
        $logoMime = switch ($ext) { 'jpg' { 'image/jpeg' } 'jpeg' { 'image/jpeg' } 'svg' { 'image/svg+xml' } default { 'image/png' } }
    }
    if ($CustomBranding.ContainsKey('CompanyName')) {
        $brandName = $CustomBranding.CompanyName
    }
    if ($CustomBranding.ContainsKey('AccentColor')) {
        $accentColor = $CustomBranding.AccentColor
    }
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
$sectionDisplayOrder = @('Tenant','Identity','Hybrid','Licensing','Email','Intune','Security','Collaboration','PowerBI','Inventory','ActiveDirectory','SOC2')
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
# Build report content and assemble HTML (dot-sourced for shared scope)
# ------------------------------------------------------------------
# Build section HTML: data tables, dashboards, compliance, TOC, issues
. (Join-Path -Path $PSScriptRoot -ChildPath 'Build-SectionHtml.ps1')

# Assemble full HTML template: CSS, cover page, executive summary, JS
. (Join-Path -Path $PSScriptRoot -ChildPath 'Get-ReportTemplate.ps1')

# ------------------------------------------------------------------
# Write HTML file
# ------------------------------------------------------------------
Set-Content -Path $OutputPath -Value $html -Encoding UTF8
Write-Output "HTML report generated: $OutputPath"

if ($OpenReport) {
    Start-Process -FilePath $OutputPath
}

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
