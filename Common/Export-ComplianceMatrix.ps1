<#
.SYNOPSIS
    Exports compliance overview data as a formatted XLSX workbook.
.DESCRIPTION
    Reads security config CSVs from an assessment folder, looks up each CheckId
    in the control registry, and generates a two-sheet XLSX file:
      Sheet 1 - Compliance Matrix (one row per check with all framework mappings)
      Sheet 2 - Summary (pass/fail counts and coverage per framework)
    Framework columns are auto-discovered from JSON definitions in controls/frameworks/.
    Requires the ImportExcel module. If not available, logs a warning and returns.
.PARAMETER AssessmentFolder
    Path to the assessment output folder containing collector CSVs and the summary file.
.PARAMETER TenantName
    Optional tenant name used in the output filename. If omitted, derived from the
    summary CSV filename.
.EXAMPLE
    .\Common\Export-ComplianceMatrix.ps1 -AssessmentFolder .\M365-Assessment\Assessment_20260311_033912_contoso
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
# Load control registry + framework definitions
# ------------------------------------------------------------------
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1')
$controlsPath = Join-Path -Path $projectRoot -ChildPath 'controls'
$controlRegistry = Import-ControlRegistry -ControlsPath $controlsPath

if ($controlRegistry.Count -eq 0) {
    Write-Warning "Control registry is empty — cannot generate compliance matrix."
    return
}

. (Join-Path -Path $PSScriptRoot -ChildPath 'Import-FrameworkDefinitions.ps1')
$allFrameworks = Import-FrameworkDefinitions -FrameworksPath (Join-Path -Path $projectRoot -ChildPath 'controls/frameworks')

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
# Scan CSVs and build findings with dynamic framework columns
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
        $baseCheckId = $row.CheckId -replace '\.\d+$', ''
        $entry = if ($controlRegistry.ContainsKey($baseCheckId)) { $controlRegistry[$baseCheckId] } else { $null }
        $fw = if ($entry) { $entry.frameworks } else { @{} }

        # Fixed columns
        $finding = [ordered]@{
            CheckId     = $row.CheckId
            Setting     = $row.Setting
            Category    = $row.Category
            Status      = $row.Status
            Source      = $c.Collector
            Remediation = $row.Remediation
        }

        # Dynamic framework columns (one per framework, sorted by displayOrder)
        foreach ($fwDef in $allFrameworks) {
            $fwData = $fw.($fwDef.frameworkId)
            if ($fwData -and $fwData.controlId) {
                $cellValue = $fwData.controlId
                # Profile-based frameworks: append inline profile tags
                if ($fwData.profiles -and @($fwData.profiles).Count -gt 0) {
                    $tags = @($fwData.profiles | ForEach-Object { "[$_]" }) -join ''
                    $cellValue = "$cellValue $tags"
                }
                $finding[$fwDef.label] = $cellValue
            }
            else {
                $finding[$fwDef.label] = ''
            }
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
# Build summary data (one row per framework)
# ------------------------------------------------------------------
$summaryData = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($fwDef in $allFrameworks) {
    $colLabel = $fwDef.label
    $mapped = @($sortedFindings | Where-Object { $_.$colLabel -and $_.$colLabel -ne '' -and $_.Status -ne 'Info' })
    $totalMapped = $mapped.Count

    if ($totalMapped -eq 0) {
        $summaryData.Add([PSCustomObject][ordered]@{
            Framework      = $colLabel
            'Total Mapped' = 0
            Pass           = 0
            Fail           = 0
            Warning        = 0
            Review         = 0
            'Pass Rate %'  = 'N/A'
        })
        continue
    }

    $pass   = @($mapped | Where-Object { $_.Status -eq 'Pass' }).Count
    $fail   = @($mapped | Where-Object { $_.Status -eq 'Fail' }).Count
    $warn   = @($mapped | Where-Object { $_.Status -eq 'Warning' }).Count
    $review = @($mapped | Where-Object { $_.Status -eq 'Review' }).Count
    $pct    = [math]::Round(($pass / $totalMapped) * 100, 1)

    $summaryData.Add([PSCustomObject][ordered]@{
        Framework      = $colLabel
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

# Sheet 1 - Compliance Matrix
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

# Sheet 2 - Summary
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

# Matrix sheet - color-code Status column
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
