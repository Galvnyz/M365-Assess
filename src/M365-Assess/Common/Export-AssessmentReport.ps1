#Requires -Version 7.0
<#
.SYNOPSIS
    Generates an HTML assessment report from M365 assessment output.
.DESCRIPTION
    Reads CSV data from an M365 assessment output folder and produces a self-contained
    HTML report powered by a React single-page application. The report bundles all
    JavaScript, CSS, and data inline — no external files or CDN calls required.

    A companion XLSX compliance matrix is also generated in the same folder.
.PARAMETER AssessmentFolder
    Path to the assessment output folder (e.g., .\M365-Assessment\Assessment_20260306_195618).
    Must contain _Assessment-Summary.csv.
.PARAMETER OutputPath
    Path for the generated HTML report. Defaults to _Assessment-Report_<domain>.html in
    the assessment folder.
.PARAMETER TenantName
    Tenant display name for the report title. Read from Tenant Information CSV if omitted.
.PARAMETER ReportTheme
    Default visual theme baked into the report. Users can change the theme via the report
    UI. Valid values: Neon (default), Console, Saas, HighContrast. Neon and Console default
    to dark mode; Saas defaults to light mode; HighContrast defaults to dark mode.
.PARAMETER WhiteLabel
    Hides M365-Assess GitHub link and Galvnyz attribution from the report footer.
.PARAMETER OpenReport
    Automatically opens the generated HTML report in the default browser.
.PARAMETER QuickScan
    Passed through for context; has no effect on the React HTML report.
.PARAMETER DriftReport
    Drift comparison rows from Compare-AssessmentBaseline. Passed to the XLSX export.
.PARAMETER DriftBaselineLabel
    Baseline label string — retained for downstream compatibility.
.PARAMETER DriftBaselineTimestamp
    Baseline timestamp string — retained for downstream compatibility.
.EXAMPLE
    PS> .\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_20260306_195618'
.NOTES
    Author: Daren9m
#>
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
    [ValidateSet('Neon', 'Console', 'Light', 'HighContrast')]
    [string]$ReportTheme = 'Neon',

    [Parameter()]
    [ValidateSet('Compact', 'Comfort')]
    [string]$ReportDensity = 'Compact',

    [Parameter()]
    [switch]$WhiteLabel,

    [Parameter()]
    [switch]$CompactReport,

    [Parameter()]
    [switch]$OpenReport,

    [Parameter()]
    [switch]$QuickScan,

    [Parameter()]
    [AllowEmptyCollection()]
    [PSCustomObject[]]$DriftReport = @(),

    [Parameter()]
    [string]$DriftBaselineLabel = '',

    [Parameter()]
    [string]$DriftBaselineTimestamp = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# ------------------------------------------------------------------
# Load control registry and framework definitions
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1')
$controlsPath    = Join-Path -Path $projectRoot -ChildPath 'controls'
$cisFrameworkId  = 'cis-m365-v6'
$controlRegistry = Import-ControlRegistry -ControlsPath $controlsPath -CisFrameworkId $cisFrameworkId

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

# ------------------------------------------------------------------
# Load assessment metadata
# ------------------------------------------------------------------
$summary = Import-Csv -Path $summaryPath

$tenantCsv  = Join-Path -Path $AssessmentFolder -ChildPath '01-Tenant-Info.csv'
$tenantData = if (Test-Path -Path $tenantCsv) { Import-Csv -Path $tenantCsv } else { $null }

if (-not $TenantName) {
    if ($tenantData -and @($tenantData).Count -gt 0 -and $tenantData[0].PSObject.Properties.Name -contains 'OrgDisplayName') {
        $TenantName = $tenantData[0].OrgDisplayName
    } elseif ($tenantData -and @($tenantData).Count -gt 0 -and $tenantData[0].PSObject.Properties.Name -contains 'DefaultDomain') {
        $TenantName = $tenantData[0].DefaultDomain
    } else {
        $TenantName = 'M365 Tenant'
    }
}

# Read domain prefix and version from the assessment log
$reportDomainPrefix  = ''
$assessedAt          = [datetime]::UtcNow.ToString('o')
$assessmentVersion   = (Import-PowerShellDataFile -Path "$PSScriptRoot/../M365-Assess.psd1").ModuleVersion
$logFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Log*.txt' -ErrorAction SilentlyContinue | Select-Object -First 1
$logPath = if ($logFile) { $logFile.FullName } else { Join-Path -Path $AssessmentFolder -ChildPath '_Assessment-Log.txt' }
if (Test-Path -Path $logPath) {
    $logHead = Get-Content -Path $logPath -TotalCount 10
    $versionLine = $logHead | Where-Object { $_ -match 'Version:\s+v(.+)' }
    if ($versionLine) { $assessmentVersion = $Matches[1] }
    $domainLine = $logHead | Where-Object { $_ -match 'Domain:\s+(\S+)' }
    if ($domainLine -and $Matches[1]) { $reportDomainPrefix = $Matches[1].Trim() }
    $startedLine = $logHead | Where-Object { $_ -match 'Started:\s+(.+)' }
    if ($startedLine -and $Matches[1]) { $assessedAt = $Matches[1].Trim() }
}

# Determine output path
if (-not $OutputPath) {
    $suffix  = if ($reportDomainPrefix) { "_$reportDomainPrefix" } else { '' }
    $OutputPath = Join-Path -Path $AssessmentFolder -ChildPath "_Assessment-Report$suffix.html"
}

# ------------------------------------------------------------------
# Load section data, build findings list, and export XLSX
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Build-ReportData.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Build-SectionHtml.ps1')
# $allCisFindings and $sectionData are now set in scope

# ------------------------------------------------------------------
# Build REPORT_DATA JSON
# ------------------------------------------------------------------
$xlsxName   = if ($reportDomainPrefix) { "_Compliance-Matrix_$reportDomainPrefix.xlsx" } else { '_Compliance-Matrix.xlsx' }
$reportTitle = if ($TenantName -ne 'M365 Tenant') { "$TenantName — M365 Security Assessment" } else { 'M365 Security Assessment' }

$reportJson = Build-ReportDataJson `
    -AllFindings    $allCisFindings `
    -SectionData    $sectionData `
    -RegistryData   $controlRegistry `
    -WhiteLabel:    $WhiteLabel `
    -XlsxFileName   $xlsxName `
    -FrameworkDefs  $allFrameworks

# ------------------------------------------------------------------
# Assemble HTML and write output
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Get-ReportTemplate.ps1')

$themeDefaults = @{
    'Neon'          = @{ Theme = 'neon';          Mode = 'dark'  }
    'Console'       = @{ Theme = 'console';       Mode = 'dark'  }
    'Light'         = @{ Theme = 'saas';          Mode = 'light' }
    'HighContrast'  = @{ Theme = 'high-contrast'; Mode = 'dark'  }
}
$htmlTheme = $themeDefaults[$ReportTheme]
$html = Get-ReportTemplate `
    -ReportDataJson  $reportJson `
    -ReportTitle     $reportTitle `
    -DefaultTheme    $htmlTheme.Theme `
    -DefaultMode     $htmlTheme.Mode `
    -DefaultDensity  ($ReportDensity.ToLower())

Set-Content -Path $OutputPath -Value $html -Encoding UTF8
Write-Output "HTML report generated: $OutputPath"

# ------------------------------------------------------------------
# Write bridge JSON for M365-Remediate integration
# ------------------------------------------------------------------
. (Join-Path -Path $PSScriptRoot -ChildPath 'Export-AssessmentBridgeJson.ps1')

$tenantIdValue = if ($tenantData -and @($tenantData).Count -gt 0 -and $tenantData[0].PSObject.Properties.Name -contains 'TenantId') {
    $tenantData[0].TenantId
} else { '' }

$registryVersionValue = ''
$registryJsonPath = Join-Path -Path $projectRoot -ChildPath 'controls/registry.json'
if (Test-Path -Path $registryJsonPath) {
    try {
        $regMeta = Get-Content -Path $registryJsonPath -Raw | ConvertFrom-Json
        $registryVersionValue = if ($regMeta.dataVersion) { $regMeta.dataVersion } else { $regMeta.schemaVersion }
    } catch { Write-Verbose "Could not read registry version: $_" }
}

$bridgeSuffix = if ($reportDomainPrefix) { "_$reportDomainPrefix" } else { '' }
$bridgePath   = Join-Path -Path $AssessmentFolder -ChildPath "_Assessment$bridgeSuffix.json"

try {
    $written = Export-AssessmentBridgeJson `
        -AllFindings       $allCisFindings `
        -RegistryData      $controlRegistry `
        -TenantId          $tenantIdValue `
        -TenantName        $TenantName `
        -AssessedAt        $assessedAt `
        -AssessmentVersion $assessmentVersion `
        -RegistryVersion   $registryVersionValue `
        -OutputPath        $bridgePath
    Write-Output "Bridge JSON written: $written"
} catch {
    Write-Warning "Bridge JSON export failed: $($_.Exception.Message)"
}

if ($OpenReport) {
    Start-Process -FilePath $OutputPath
}
