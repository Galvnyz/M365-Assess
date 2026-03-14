<#
.SYNOPSIS
    Exports compliance overview data as a formatted XLSX workbook.
.DESCRIPTION
    Reads security config CSVs from an assessment folder, looks up each CheckId
    in the control registry, and generates a two-sheet XLSX file:
      Sheet 1 — Compliance Matrix (one row per check with all framework mappings)
      Sheet 2 — Summary (pass/fail counts and coverage per framework)
    Requires the ImportExcel module. If not available, logs a warning and returns.
.PARAMETER AssessmentFolder
    Path to the assessment output folder containing collector CSVs and the summary file.
.PARAMETER TenantName
    Optional tenant name used in the output filename. If omitted, derived from the
    summary CSV filename.
.EXAMPLE
    .\Common\Export-ComplianceMatrix.ps1 -AssessmentFolder .\M365-Assessment\Assessment_20260311_033912_dzmlab
.NOTES
    Requires: ImportExcel module (Install-Module ImportExcel -Scope CurrentUser)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$AssessmentFolder,

    [Parameter()]
    [string]$TenantName
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------
# Check for ImportExcel module
# ------------------------------------------------------------------
if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    Write-Warning "ImportExcel module not available — skipping XLSX compliance matrix export. Install with: Install-Module ImportExcel -Scope CurrentUser"
    return
}
Import-Module ImportExcel -ErrorAction Stop

# ------------------------------------------------------------------
# Validate input
# ------------------------------------------------------------------
if (-not (Test-Path -Path $AssessmentFolder -PathType Container)) {
    Write-Error "Assessment folder not found: $AssessmentFolder"
    return
}

# ------------------------------------------------------------------
# Load control registry
# ------------------------------------------------------------------
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1')
$controlsPath = Join-Path -Path $projectRoot -ChildPath 'controls'
$controlRegistry = Import-ControlRegistry -ControlsPath $controlsPath

if ($controlRegistry.Count -eq 0) {
    Write-Warning "Control registry is empty — cannot generate compliance matrix."
    return
}

# ------------------------------------------------------------------
# Derive tenant name if not provided
# ------------------------------------------------------------------
if (-not $TenantName) {
    $summaryFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Summary*.csv' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($summaryFile -and $summaryFile.Name -match '_Assessment-Summary_(.+)\.csv$') {
        $TenantName = $Matches[1]
    } else {
        $TenantName = 'tenant'
    }
}

# ------------------------------------------------------------------
# Load assessment summary to identify collector CSVs
# ------------------------------------------------------------------
$summaryFile = Get-ChildItem -Path $AssessmentFolder -Filter '_Assessment-Summary*.csv' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $summaryFile) {
    Write-Error "Assessment summary CSV not found in: $AssessmentFolder"
    return
}
$summary = Import-Csv -Path $summaryFile.FullName

# ------------------------------------------------------------------
# Framework column definitions (order matches HTML report)
# ------------------------------------------------------------------
$frameworkColumns = [ordered]@{
    'CIS E3-L1'       = 'CisE3L1'
    'CIS E3-L2'       = 'CisE3L2'
    'CIS E5-L1'       = 'CisE5L1'
    'CIS E5-L2'       = 'CisE5L2'
    'NIST 800-53'     = 'Nist80053'
    'NIST CSF'        = 'NistCsf'
    'ISO 27001'       = 'Iso27001'
    'DISA STIG'       = 'Stig'
    'PCI DSS'         = 'PciDss'
    'CMMC 2.0'        = 'Cmmc'
    'HIPAA'           = 'Hipaa'
    'CISA SCuBA'      = 'CisaScuba'
    'SOC 2 TSC'       = 'Soc2'
}

# Registry framework key mapping (registry key → column property name)
# Used by planned multi-framework XLSX export (v1.0.0, issue #67)
# $registryToCol = @{
#     'cis-m365-v6' = $null  # Handled specially via profiles
#     'nist-800-53' = 'Nist80053'
#     'nist-csf'    = 'NistCsf'
#     'iso-27001'   = 'Iso27001'
#     'stig'        = 'Stig'
#     'pci-dss'     = 'PciDss'
#     'cmmc'        = 'Cmmc'
#     'hipaa'       = 'Hipaa'
#     'cisa-scuba'  = 'CisaScuba'
#     'soc2'        = 'Soc2'
# }

# ------------------------------------------------------------------
# Scan CSVs and build findings
# ------------------------------------------------------------------
$findings = [System.Collections.Generic.List[PSCustomObject]]::new()

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
        $cisProfiles = if ($fw.'cis-m365-v6' -and $fw.'cis-m365-v6'.profiles) { $fw.'cis-m365-v6'.profiles } else { @() }
        $cisId = if ($fw.'cis-m365-v6' -and $fw.'cis-m365-v6'.controlId) { $fw.'cis-m365-v6'.controlId } else { '' }

        $finding = [ordered]@{
            CheckId      = $row.CheckId
            Setting      = $row.Setting
            Category     = $row.Category
            Status       = $row.Status
            Source       = $c.Collector
            Remediation  = $row.Remediation
            CisE3L1      = if ($cisProfiles -contains 'E3-L1') { $cisId } else { '' }
            CisE3L2      = if ($cisProfiles -contains 'E3-L2') { $cisId } else { '' }
            CisE5L1      = if ($cisProfiles -contains 'E5-L1') { $cisId } else { '' }
            CisE5L2      = if ($cisProfiles -contains 'E5-L2') { $cisId } else { '' }
            Nist80053    = if ($fw.'nist-800-53')  { $fw.'nist-800-53'.controlId } else { '' }
            NistCsf      = if ($fw.'nist-csf')     { $fw.'nist-csf'.controlId }    else { '' }
            Iso27001     = if ($fw.'iso-27001')     { $fw.'iso-27001'.controlId }   else { '' }
            Stig         = if ($fw.stig)            { $fw.stig.controlId }          else { '' }
            PciDss       = if ($fw.'pci-dss')       { $fw.'pci-dss'.controlId }     else { '' }
            Cmmc         = if ($fw.cmmc)            { $fw.cmmc.controlId }          else { '' }
            Hipaa        = if ($fw.hipaa)           { $fw.hipaa.controlId }         else { '' }
            CisaScuba    = if ($fw.'cisa-scuba')    { $fw.'cisa-scuba'.controlId }  else { '' }
            Soc2         = if ($fw.soc2)            { $fw.soc2.controlId }          else { '' }
        }
        $findings.Add([PSCustomObject]$finding)
    }
}

if ($findings.Count -eq 0) {
    Write-Warning "No CheckId-mapped findings found — skipping XLSX export."
    return
}

# Sort by CheckId
$sortedFindings = $findings | Sort-Object -Property CheckId

# ------------------------------------------------------------------
# Build summary data
# ------------------------------------------------------------------
$summaryData = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($fwLabel in $frameworkColumns.Keys) {
    $colProp = $frameworkColumns[$fwLabel]
    $mapped = @($sortedFindings | Where-Object { $_.$colProp -and $_.$colProp -ne '' -and $_.Status -ne 'Info' })
    $totalMapped = $mapped.Count
    if ($totalMapped -eq 0) {
        $summaryData.Add([PSCustomObject][ordered]@{
            Framework    = $fwLabel
            'Total Mapped' = 0
            Pass         = 0
            Fail         = 0
            Warning      = 0
            Review       = 0
            'Pass Rate %' = 'N/A'
        })
        continue
    }

    $pass    = @($mapped | Where-Object { $_.Status -eq 'Pass' }).Count
    $fail    = @($mapped | Where-Object { $_.Status -eq 'Fail' }).Count
    $warn    = @($mapped | Where-Object { $_.Status -eq 'Warning' }).Count
    $review  = @($mapped | Where-Object { $_.Status -eq 'Review' }).Count
    $pct     = [math]::Round(($pass / $totalMapped) * 100, 1)

    $summaryData.Add([PSCustomObject][ordered]@{
        Framework      = $fwLabel
        'Total Mapped' = $totalMapped
        Pass           = $pass
        Fail           = $fail
        Warning        = $warn
        Review         = $review
        'Pass Rate %'  = $pct
    })
}

# ------------------------------------------------------------------
# Export to XLSX
# ------------------------------------------------------------------
$outputFile = Join-Path -Path $AssessmentFolder -ChildPath "_Compliance-Matrix_$TenantName.xlsx"

# Remove existing file to avoid append issues
if (Test-Path -Path $outputFile) {
    Remove-Item -Path $outputFile -Force
}

# Sheet 1 — Compliance Matrix
$matrixParams = @{
    Path          = $outputFile
    WorksheetName = 'Compliance Matrix'
    AutoSize      = $true
    AutoFilter    = $true
    FreezeTopRow  = $true
    BoldTopRow    = $true
    TableStyle    = 'Medium2'
}
$sortedFindings | Export-Excel @matrixParams

# Sheet 2 — Summary
$summaryParams = @{
    Path          = $outputFile
    WorksheetName = 'Summary'
    AutoSize      = $true
    FreezeTopRow  = $true
    BoldTopRow    = $true
    TableStyle    = 'Medium6'
}
$summaryData | Export-Excel @summaryParams

# ------------------------------------------------------------------
# Apply conditional formatting
# ------------------------------------------------------------------
$pkg = Open-ExcelPackage -Path $outputFile

# Matrix sheet — color-code Status column
$matrixSheet = $pkg.Workbook.Worksheets['Compliance Matrix']
$statusCol = 4  # Column D = Status
$lastRow = $matrixSheet.Dimension.End.Row

for ($r = 2; $r -le $lastRow; $r++) {
    $val = $matrixSheet.Cells[$r, $statusCol].Value
    switch ($val) {
        'Pass'    { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(21, 128, 61));  $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(220, 252, 231)) }
        'Fail'    { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(185, 28, 28));  $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 226, 226)) }
        'Warning' { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(146, 64, 14));  $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 243, 199)) }
        'Review'  { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(30, 64, 175));  $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(219, 234, 254)) }
        'Info'    { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(107, 114, 128)); $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(243, 244, 246)) }
    }
}

Close-ExcelPackage $pkg

Write-Host "  Compliance matrix exported: $outputFile" -ForegroundColor Green
