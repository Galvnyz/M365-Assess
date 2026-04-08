<#
.SYNOPSIS
    Exports compliance overview data as a formatted XLSX workbook.
.DESCRIPTION
    Reads security config CSVs from an assessment folder, looks up each CheckId
    in the control registry, and generates an XLSX file with up to four sheets:
      Sheet 1 - Compliance Matrix (one row per check; framework columns + SCF impact/domain)
      Sheet 2 - Summary (pass/fail counts and coverage per framework)
      Sheet 3 - Grouped by Profile (CIS M365 profile-level breakdown)
      Sheet 4 - Verification (one row per SCF assessment objective -- audit guidance)
    Framework columns are auto-discovered from JSON definitions in controls/frameworks/.
    SCF impact and verification data require CheckID v2.0.0 registry entries.
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

$riskSeverityPath = Join-Path -Path $controlsPath -ChildPath 'risk-severity.json'
$riskSeverity = @{}
if (Test-Path -Path $riskSeverityPath) {
    $riskJson = Get-Content -Path $riskSeverityPath -Raw | ConvertFrom-Json -AsHashtable
    if ($riskJson.ContainsKey('checks')) {
        $riskSeverity = $riskJson['checks']
    }
}

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
            CheckId         = $row.CheckId
            Setting         = $row.Setting
            Category        = $row.Category
            Status          = $row.Status
            RiskSeverity    = if ($riskSeverity.ContainsKey($baseCheckId)) { $riskSeverity[$baseCheckId] } else { '' }
            ImpactSeverity  = if ($entry -and $entry.impactRating) { $entry.impactRating.severity }  else { '' }
            ImpactRationale = if ($entry -and $entry.impactRating) { $entry.impactRating.rationale } else { '' }
            SCFDomain       = if ($entry -and $entry.scf)          { $entry.scf.domain }             else { '' }
            CSFFunction     = if ($entry -and $entry.scf)          { $entry.scf.csfFunction }        else { '' }
            SCFWeight       = if ($entry -and $entry.scf)          { $entry.scf.relativeWeighting }  else { '' }
            Source          = $c.Collector
            Remediation     = $row.Remediation
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

# Sheet 3 - Grouped by Framework (CIS M365 profile-compliance breakdown)
$cisFw = $allFrameworks | Where-Object { $_.frameworkId -like 'cis-m365-*' } | Select-Object -First 1
if ($cisFw -and $findings.Count -gt 0) {
    $catalogPath = Join-Path -Path $PSScriptRoot -ChildPath 'Export-FrameworkCatalog.ps1'
    if (Test-Path -Path $catalogPath) {
        . $catalogPath
        # Build finding objects compatible with the scoring engine
        $catalogFindings = @($sortedFindings | ForEach-Object {
            $fwHash = @{}
            foreach ($fwDef in $allFrameworks) {
                $baseId = $_.CheckId -replace '\.\d+$', ''
                if ($controlRegistry.ContainsKey($baseId) -and $controlRegistry[$baseId].frameworks) {
                    $fwObj = $controlRegistry[$baseId].frameworks
                    if ($fwObj.PSObject.Properties.Name -contains $fwDef.frameworkId) {
                        $fwHash[$fwDef.frameworkId] = $fwObj.($fwDef.frameworkId)
                    }
                }
            }
            [PSCustomObject]@{
                CheckId      = $_.CheckId
                Setting      = $_.Setting
                Status       = $_.Status
                RiskSeverity = 'Medium'
                Section      = $_.Source
                Frameworks   = $fwHash
            }
        })

        $groupedResult = Export-FrameworkCatalog -Findings $catalogFindings -Framework $cisFw -ControlRegistry $controlRegistry -Mode Grouped -WarningAction SilentlyContinue
        if ($groupedResult -and $groupedResult.Groups) {
            $groupedRows = [System.Collections.Generic.List[PSCustomObject]]::new()
            foreach ($group in $groupedResult.Groups) {
                $grpPassRate = if ($group.Mapped -gt 0) { [math]::Round(($group.Passed / $group.Mapped) * 100, 1) } else { 0 }
                $groupedRows.Add([PSCustomObject][ordered]@{
                    Profile      = $group.Key
                    Label        = $group.Label
                    Total        = $group.Total
                    Mapped       = $group.Mapped
                    Passed       = $group.Passed
                    Failed       = $group.Failed
                    Other        = $group.Other
                    'Pass Rate %' = $grpPassRate
                })
            }
            $groupedParams = @{
                Path          = $outputFile
                WorksheetName = 'Grouped by Profile'
                AutoSize      = $true
                FreezeTopRow  = $true
                BoldTopRow    = $true
                TableStyle    = 'Medium9'
            }
            $groupedRows | Export-Excel @groupedParams
        }
    }
}

# Sheet 4 - Verification (one row per SCF assessment objective)
$verificationRows = [System.Collections.Generic.List[PSCustomObject]]::new()
$seenVerifIds = [System.Collections.Generic.HashSet[string]]::new()

foreach ($vFinding in $sortedFindings) {
    $vBaseId = $vFinding.CheckId -replace '\.\d+$', ''
    if (-not $seenVerifIds.Add($vBaseId)) { continue }
    $vEntry = if ($controlRegistry.ContainsKey($vBaseId)) { $controlRegistry[$vBaseId] } else { $null }
    if (-not $vEntry -or -not $vEntry.scf -or -not $vEntry.scf.assessmentObjectives) { continue }

    foreach ($ao in $vEntry.scf.assessmentObjectives) {
        $verificationRows.Add([PSCustomObject][ordered]@{
            CheckId    = $vBaseId
            'Check Name' = $vEntry.name
            'AO ID'    = $ao.aoId
            Objective  = $ao.text
        })
    }
}

if ($verificationRows.Count -gt 0) {
    $verifParams = @{
        Path          = $outputFile
        WorksheetName = 'Verification'
        AutoSize      = $true
        FreezeTopRow  = $true
        BoldTopRow    = $true
        TableStyle    = 'Medium15'
    }
    $verificationRows | Export-Excel @verifParams
}

# ------------------------------------------------------------------
# Apply conditional formatting
# ------------------------------------------------------------------
$pkg = Open-ExcelPackage -Path $outputFile

# Matrix sheet - color-code Status, RiskSeverity, and ImpactSeverity columns
$matrixSheet = $pkg.Workbook.Worksheets['Compliance Matrix']
$statusCol      = 4   # Column D = Status
$riskSevCol     = 5   # Column E = RiskSeverity
$impactSevCol   = 6   # Column F = ImpactSeverity
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

    $sevVal = $matrixSheet.Cells[$r, $riskSevCol].Value
    switch ($sevVal) {
        'Critical' { $matrixSheet.Cells[$r, $riskSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(185, 28, 28));  $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 226, 226)) }
        'High'     { $matrixSheet.Cells[$r, $riskSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(154, 52, 18));  $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(255, 237, 213)) }
        'Medium'   { $matrixSheet.Cells[$r, $riskSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(146, 64, 14));  $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 243, 199)) }
        'Low'      { $matrixSheet.Cells[$r, $riskSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(21, 128, 61));  $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(220, 252, 231)) }
        'Info'     { $matrixSheet.Cells[$r, $riskSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(107, 114, 128)); $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $riskSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(243, 244, 246)) }
    }

    $impactVal = $matrixSheet.Cells[$r, $impactSevCol].Value
    switch ($impactVal) {
        'Critical' { $matrixSheet.Cells[$r, $impactSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(185, 28, 28));  $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 226, 226)) }
        'High'     { $matrixSheet.Cells[$r, $impactSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(154, 52, 18));  $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(255, 237, 213)) }
        'Medium'   { $matrixSheet.Cells[$r, $impactSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(146, 64, 14));  $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 243, 199)) }
        'Low'      { $matrixSheet.Cells[$r, $impactSevCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(21, 128, 61));  $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $impactSevCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(220, 252, 231)) }
    }
}

Close-ExcelPackage $pkg

Write-Host "  Compliance matrix exported: $outputFile" -ForegroundColor Green
