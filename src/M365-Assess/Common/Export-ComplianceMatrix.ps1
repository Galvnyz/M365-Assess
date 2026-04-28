<#
.SYNOPSIS
    Exports compliance overview data as a formatted XLSX workbook.
.DESCRIPTION
    Reads security config CSVs from an assessment folder, looks up each CheckId
    in the control registry, and generates an XLSX file with up to seven sheets:
      Sheet 1 - Compliance Matrix (one row per check; framework columns + SCF impact/domain)
      Sheet 2 - Summary (pass/fail counts and coverage per framework)
      Sheet 3 - Grouped by Profile (CIS M365 profile-level breakdown)
      Sheet 4 - Verification (one row per SCF assessment objective -- audit guidance)
      Sheet 5 - Remediation Roadmap (Now/Next/Later view; only when findings need fixing)
      Sheet 6 - Drift (only when -CompareBaseline was passed)
      Sheet 7 - Evidence Details (D1 #785; one row per finding with structured evidence)
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
    [string]$TenantName,

    [Parameter()]
    [hashtable]$CustomBranding,

    [Parameter()]
    [AllowEmptyCollection()]
    [PSCustomObject[]]$DriftReport = @()
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
. (Join-Path -Path $PSScriptRoot -ChildPath 'Get-RemediationLane.ps1')
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
# D1 #785 -- parallel collection of structured evidence per finding. Populated only
# for rows where at least one evidence field is non-empty; surfaced on Sheet 5.
$evidenceRows = [System.Collections.Generic.List[PSCustomObject]]::new()
$evidenceFieldNames = @('ObservedValue','ExpectedValue','EvidenceSource','EvidenceTimestamp','CollectionMethod','PermissionRequired','Confidence','Limitations')

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

        # D1 #785 -- collect rows with structured evidence for the dedicated sheet
        $hasEvidence = $false
        foreach ($f in $evidenceFieldNames) {
            if ($columns -contains $f -and -not [string]::IsNullOrWhiteSpace($row.$f)) {
                $hasEvidence = $true
                break
            }
        }
        if ($hasEvidence) {
            $evidenceRows.Add([PSCustomObject][ordered]@{
                CheckId            = $row.CheckId
                Setting            = $row.Setting
                Status             = $row.Status
                ObservedValue      = if ($columns -contains 'ObservedValue')      { $row.ObservedValue }      else { '' }
                ExpectedValue      = if ($columns -contains 'ExpectedValue')      { $row.ExpectedValue }      else { '' }
                EvidenceSource     = if ($columns -contains 'EvidenceSource')     { $row.EvidenceSource }     else { '' }
                EvidenceTimestamp  = if ($columns -contains 'EvidenceTimestamp')  { $row.EvidenceTimestamp }  else { '' }
                CollectionMethod   = if ($columns -contains 'CollectionMethod')   { $row.CollectionMethod }   else { '' }
                PermissionRequired = if ($columns -contains 'PermissionRequired') { $row.PermissionRequired } else { '' }
                Confidence         = if ($columns -contains 'Confidence')         { $row.Confidence }         else { '' }
                Limitations        = if ($columns -contains 'Limitations')        { $row.Limitations }        else { '' }
            })
        }

        $baseCheckId = $row.CheckId -replace '\.\d+$', ''
        $entry = if ($controlRegistry.ContainsKey($baseCheckId)) { $controlRegistry[$baseCheckId] } else { $null }
        $fw = if ($entry) { $entry.frameworks } else { @{} }

        # Issue #715: precompute Horizon (Now/Next/Later) so the XLSX agrees
        # with the HTML report's Remediation Roadmap. Pass-status rows get an
        # empty Horizon — the lane is a remediation concept, not a finding one.
        $sevForLane = if ($riskSeverity.ContainsKey($baseCheckId)) { $riskSeverity[$baseCheckId] } else { 'medium' }
        $effortForLane = if ($entry -and $entry.effort) { $entry.effort } else { 'medium' }
        $horizon = Get-RemediationLane -Status $row.Status -Severity $sevForLane -Effort $effortForLane

        # Fixed columns
        $finding = [ordered]@{
            CheckId         = $row.CheckId
            Setting         = $row.Setting
            Category        = $row.Category
            Status          = $row.Status
            Horizon         = $horizon
            RiskSeverity    = if ($riskSeverity.ContainsKey($baseCheckId)) { $riskSeverity[$baseCheckId] } else { '' }
            ImpactSeverity  = if ($entry -and $entry.impactRating) { $entry.impactRating.severity }  else { '' }
            ImpactRationale = if ($entry -and $entry.impactRating) { $entry.impactRating.rationale } else { '' }
            SCFDomain       = if ($entry -and $entry.scf)          { $entry.scf.domain }             else { '' }
            CSFFunction     = if ($entry -and $entry.scf)          { $entry.scf.csfFunction }        else { '' }
            SCFWeight       = if ($entry -and $entry.scf)          { $entry.scf.relativeWeighting }  else { '' }
            Effort          = $effortForLane
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
    # #802: strict denominator -- Pass / (Pass + Fail + Warning) per CHECK-STATUS-MODEL.md.
    # Review / Skipped / Unknown / NotApplicable / NotLicensed are excluded.
    $scoreDenom = $pass + $fail + $warn
    $pct = if ($scoreDenom -gt 0) { [math]::Round(($pass / $scoreDenom) * 100, 1) } else { 0 }

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
# Load scoring engine + build catalog findings (shared by Summary sub-rows + Sheet 3)
# ------------------------------------------------------------------
$catalogPath = Join-Path -Path $PSScriptRoot -ChildPath 'Export-FrameworkCatalog.ps1'
$catalogFindings = $null
if ((Test-Path -Path $catalogPath) -and $findings.Count -gt 0) {
    . $catalogPath
    $catalogFindings = @($sortedFindings | ForEach-Object {
        $fwHash = @{}
        foreach ($fwDef in $allFrameworks) {
            $baseId = $_.CheckId -replace '\.\d+$', ''
            if ($controlRegistry.ContainsKey($baseId) -and $controlRegistry[$baseId].frameworks) {
                $fwObj = $controlRegistry[$baseId].frameworks
                if ($fwObj -is [hashtable] -and $fwObj.ContainsKey($fwDef.frameworkId)) {
                    $fwHash[$fwDef.frameworkId] = $fwObj[$fwDef.frameworkId]
                }
                elseif ($fwObj -and $fwObj.PSObject.Properties.Name -contains $fwDef.frameworkId) {
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
}

# Build expanded summary: parent framework row + sub-rows for profile/maturity frameworks
# profile-compliance (CIS): individual profile rows + a Combined row per license tier
# maturity-level (CMMC): individual level rows only (already cumulative per level)
$summaryExpanded = [System.Collections.Generic.List[PSCustomObject]]::new()
$groupedByFwCache = @{}
foreach ($summaryRow in $summaryData) {
    $summaryExpanded.Add($summaryRow)
    if ($null -eq $catalogFindings) { continue }
    $fwDef = $allFrameworks | Where-Object { $_.label -eq $summaryRow.Framework } | Select-Object -First 1
    if (-not $fwDef -or $fwDef.scoringMethod -notin @('profile-compliance', 'maturity-level')) { continue }
    $grpResult = Export-FrameworkCatalog -Findings $catalogFindings -Framework $fwDef -ControlRegistry $controlRegistry -Mode Grouped -WarningAction SilentlyContinue
    if (-not $grpResult -or -not $grpResult.Groups) { continue }

    # Skip sub-rows when all non-gap groups have identical Mapped counts — indicates that
    # findings lack profile/level tags in the registry so every finding fell through to
    # "include in all groups," making the sub-rows useless and misleading.
    $uniqueMappedCounts = @($grpResult.Groups | Where-Object { -not $_.IsGap } |
        Select-Object -ExpandProperty Mapped | Sort-Object -Unique)
    if ($uniqueMappedCounts.Count -le 1) { continue }

    $groupedByFwCache[$fwDef.frameworkId] = $grpResult

    if ($fwDef.scoringMethod -eq 'profile-compliance') {
        # Detect tier groups: keys like 'E3-L1','E3-L2' share tier prefix 'E3'
        $tierMap = @{}
        foreach ($grp in $grpResult.Groups) {
            if ($grp.IsGap) { continue }
            if ($grp.Key -match '^(.+)-L\d+$') {
                $tk = $Matches[1]
                if (-not $tierMap.ContainsKey($tk)) { $tierMap[$tk] = [System.Collections.Generic.List[hashtable]]::new() }
                $tierMap[$tk].Add($grp)
            }
        }
        $emittedTiers = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($group in $grpResult.Groups) {
            if ($group.IsGap) { continue }
            # #802: strict denominator -- Pass / (Pass + Fail + Warning).
            $subDenom = $group.Passed + $group.Failed + $group.Warning
            $subRate = if ($subDenom -gt 0) { [math]::Round(($group.Passed / $subDenom) * 100, 1) } else { 0 }
            $summaryExpanded.Add([PSCustomObject][ordered]@{
                Framework      = "    $($group.Key) — $($group.Label)"
                'Total Mapped' = $group.Mapped
                Pass           = $group.Passed
                Fail           = $group.Failed
                Warning        = $group.Warning
                Review         = $group.Review
                'Pass Rate %'  = $subRate
            })
            if ($group.Key -match '^(.+)-L\d+$') {
                $tierKey = $Matches[1]
                if ($tierMap.ContainsKey($tierKey) -and -not $emittedTiers.Contains($tierKey)) {
                    $sortedTierLevels = @($tierMap[$tierKey] | Sort-Object { $_.Key })
                    if ($group.Key -eq $sortedTierLevels[-1].Key) {
                        [void]$emittedTiers.Add($tierKey)
                        # Filter unique findings tagged with this tier; avoids L1/L2 double-counting
                        $colLabel     = $fwDef.label
                        $tierPattern  = "\[$tierKey-"
                        $tierFindings = @($sortedFindings | Where-Object {
                            $_.$colLabel -match $tierPattern -and $_.Status -ne 'Info'
                        })
                        if ($tierFindings.Count -gt 0) {
                            $cPass     = @($tierFindings | Where-Object Status -eq 'Pass').Count
                            $cFail     = @($tierFindings | Where-Object Status -eq 'Fail').Count
                            $cWarn     = @($tierFindings | Where-Object Status -eq 'Warning').Count
                            $cReview   = @($tierFindings | Where-Object Status -eq 'Review').Count
                            $cRate     = [math]::Round(($cPass / $tierFindings.Count) * 100, 1)
                            $levelKeys = @($sortedTierLevels | ForEach-Object { ($_.Key -split '-')[-1] }) -join '+'
                            $summaryExpanded.Add([PSCustomObject][ordered]@{
                                Framework      = "    $tierKey Combined ($levelKeys)"
                                'Total Mapped' = $tierFindings.Count
                                Pass           = $cPass
                                Fail           = $cFail
                                Warning        = $cWarn
                                Review         = $cReview
                                'Pass Rate %'  = $cRate
                            })
                        }
                    }
                }
            }
        }
    }
    else {
        # maturity-level: CMMC is already cumulative per level, emit groups as-is
        foreach ($group in $grpResult.Groups) {
            if ($group.IsGap) { continue }
            # #802: strict denominator -- Pass / (Pass + Fail + Warning).
            $subDenom = $group.Passed + $group.Failed + $group.Warning
            $subRate = if ($subDenom -gt 0) { [math]::Round(($group.Passed / $subDenom) * 100, 1) } else { 0 }
            $summaryExpanded.Add([PSCustomObject][ordered]@{
                Framework      = "    $($group.Key) — $($group.Label)"
                'Total Mapped' = $group.Mapped
                Pass           = $group.Passed
                Fail           = $group.Failed
                Warning        = $group.Warning
                Review         = $group.Review
                'Pass Rate %'  = $subRate
            })
        }
    }
}

# ------------------------------------------------------------------
# Export to XLSX
# ------------------------------------------------------------------
$outputFile = Join-Path -Path $AssessmentFolder -ChildPath "_Compliance-Matrix_$TenantName.xlsx"

# Remove existing file to avoid append issues
if (Test-Path -Path $outputFile) {
    Remove-Item -Path $outputFile -Force
}

# Build Prepared By header value for white-label mode
$preparedByHeader = ''
if ($CustomBranding) {
    $prepBy  = if ($CustomBranding.ContainsKey('CompanyName')) { $CustomBranding.CompanyName } else { '' }
    $prepFor = if ($CustomBranding.ContainsKey('ClientName'))  { $CustomBranding.ClientName }  else { $TenantName }
    $today   = Get-Date -Format 'MMMM d, yyyy'
    $parts   = @()
    if ($prepBy)  { $parts += "Prepared By: $prepBy" }
    if ($prepFor) { $parts += "Prepared For: $prepFor" }
    $parts += $today
    $preparedByHeader = $parts -join ' | '
}

# Issue #867: always emit a provenance Title row so the XLSX carries the
# tool version + timestamp regardless of whether Prepared By/For was supplied.
$assessmentVersion = ''
try {
    $manifestPath = Join-Path -Path $PSScriptRoot -ChildPath '..\M365-Assess.psd1'
    if (Test-Path -Path $manifestPath) {
        $assessmentVersion = (Import-PowerShellDataFile -Path $manifestPath).ModuleVersion
    }
}
catch {
    Write-Verbose "Could not read M365-Assess.psd1 ModuleVersion: $($_.Exception.Message)"
}
$provenanceLine = "M365-Assess v$assessmentVersion | Generated $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC"
$titleHeader = if ($preparedByHeader) { "$preparedByHeader | $provenanceLine" } else { $provenanceLine }

# Sheet 1 - Compliance Matrix
$matrixParams = @{
    Path          = $outputFile
    WorksheetName = 'Compliance Matrix'
    AutoSize      = $true
    AutoFilter    = $true
    FreezeTopRow  = $true
    BoldTopRow    = $false  # title row above provides bold context
    TableStyle    = 'Medium2'
    Title                = $titleHeader
    TitleBold            = $true
    TitleSize            = 11
    TitleBackgroundColor = [System.Drawing.Color]::FromArgb(219, 234, 254)
}
# Issue #840: project Horizon → Sequence at export time, marking Pass rows as 'Done'
# so no cell is empty. The source object's Horizon property stays untouched —
# downstream consumers (Roadmap sheet line 566, Export-M365Remediation) still
# read $_.Horizon, where Pass remains '' and Roadmap correctly excludes it.
$matrixCols = foreach ($propName in $sortedFindings[0].PSObject.Properties.Name) {
    if ($propName -eq 'Horizon') {
        @{ Name = 'Sequence'; Expression = { if ($_.Status -eq 'Pass') { 'Done' } else { $_.Horizon } }.GetNewClosure() }
    } else {
        $propName
    }
}
$sortedFindings | Select-Object -Property $matrixCols | Export-Excel @matrixParams

# Sheet 2 - Summary (with profile/maturity sub-rows for CIS and CMMC)
$summaryParams = @{
    Path          = $outputFile
    WorksheetName = 'Summary'
    AutoSize      = $true
    FreezeTopRow  = $true
    BoldTopRow    = $true
    TableStyle    = 'Medium6'
}
$summaryExpanded | Export-Excel @summaryParams

# Sheet 3 - Grouped by Profile (CIS M365 profile-compliance breakdown)
$cisFw = $allFrameworks | Where-Object { $_.frameworkId -like 'cis-m365-*' } | Select-Object -First 1
if ($cisFw -and $null -ne $catalogFindings) {
    $groupedResult = if ($groupedByFwCache.ContainsKey($cisFw.frameworkId)) {
        $groupedByFwCache[$cisFw.frameworkId]
    }
    else {
        Export-FrameworkCatalog -Findings $catalogFindings -Framework $cisFw -ControlRegistry $controlRegistry -Mode Grouped -WarningAction SilentlyContinue
    }
    if ($groupedResult -and $groupedResult.Groups) {
        $groupedRows = [System.Collections.Generic.List[PSCustomObject]]::new()
        $sheet3TierMap = @{}
        foreach ($grp in $groupedResult.Groups) {
            if ($grp.IsGap) { continue }
            if ($grp.Key -match '^(.+)-L\d+$') {
                $tk = $Matches[1]
                if (-not $sheet3TierMap.ContainsKey($tk)) { $sheet3TierMap[$tk] = [System.Collections.Generic.List[hashtable]]::new() }
                $sheet3TierMap[$tk].Add($grp)
            }
        }
        $sheet3EmittedTiers = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($group in $groupedResult.Groups) {
            if ($group.IsGap) { continue }
            $grpPassRate = if ($group.Mapped -gt 0) { [math]::Round(($group.Passed / $group.Mapped) * 100, 1) } else { 0 }
            $groupedRows.Add([PSCustomObject][ordered]@{
                Profile      = $group.Key
                Label        = $group.Label
                Total        = if ($group.Total -gt 0) { $group.Total } else { $group.Mapped }
                Mapped       = $group.Mapped
                Passed       = $group.Passed
                Failed       = $group.Failed
                Warning      = $group.Warning
                Review       = $group.Review
                'Pass Rate %' = $grpPassRate
            })
            if ($group.Key -match '^(.+)-L\d+$') {
                $tierKey = $Matches[1]
                if ($sheet3TierMap.ContainsKey($tierKey) -and -not $sheet3EmittedTiers.Contains($tierKey)) {
                    $sortedTierLevels = @($sheet3TierMap[$tierKey] | Sort-Object { $_.Key })
                    if ($group.Key -eq $sortedTierLevels[-1].Key) {
                        [void]$sheet3EmittedTiers.Add($tierKey)
                        $colLabel     = $cisFw.label
                        $tierPattern  = "\[$tierKey-"
                        $tierFindings = @($sortedFindings | Where-Object {
                            $_.$colLabel -match $tierPattern -and $_.Status -ne 'Info'
                        })
                        if ($tierFindings.Count -gt 0) {
                            $cPass     = @($tierFindings | Where-Object Status -eq 'Pass').Count
                            $cFail     = @($tierFindings | Where-Object Status -eq 'Fail').Count
                            $cWarn     = @($tierFindings | Where-Object Status -eq 'Warning').Count
                            $cReview   = @($tierFindings | Where-Object Status -eq 'Review').Count
                            $cRate     = [math]::Round(($cPass / $tierFindings.Count) * 100, 1)
                            $levelKeys = @($sortedTierLevels | ForEach-Object { ($_.Key -split '-')[-1] }) -join '+'
                            $combinedTotal = ($sortedTierLevels | Measure-Object { $_.Total } -Sum).Sum
                            $groupedRows.Add([PSCustomObject][ordered]@{
                                Profile      = "$tierKey Combined ($levelKeys)"
                                Label        = "All $tierKey controls (L1 + L2)"
                                Total        = if ($combinedTotal -gt 0) { $combinedTotal } else { $tierFindings.Count }
                                Mapped       = $tierFindings.Count
                                Passed       = $cPass
                                Failed       = $cFail
                                Warning      = $cWarn
                                Review       = $cReview
                                'Pass Rate %' = $cRate
                            })
                        }
                    }
                }
            }
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
# Remediation Roadmap sheet (issue #715)
# Mirrors the HTML report's Roadmap: one row per actionable finding,
# grouped by Now/Next/Later, sorted within each group by severity.
# ------------------------------------------------------------------
$severityOrder = @{ 'critical' = 0; 'high' = 1; 'medium' = 2; 'low' = 3; 'info' = 4; 'none' = 5 }
$horizonOrder  = @{ 'now' = 0; 'soon' = 1; 'later' = 2 }
$roadmapRows = $sortedFindings | Where-Object { $_.Horizon } | ForEach-Object {
    [PSCustomObject]@{
        Horizon       = switch ($_.Horizon) { 'now' { 'Now' } 'soon' { 'Next' } 'later' { 'Later' } default { $_.Horizon } }
        CheckId       = $_.CheckId
        Setting       = $_.Setting
        Severity      = $_.RiskSeverity
        Effort        = $_.Effort
        Status        = $_.Status
        Remediation   = $_.Remediation
        _hOrder       = $horizonOrder[$_.Horizon]
        _sOrder       = if ($severityOrder.ContainsKey(($_.RiskSeverity).ToLower())) { $severityOrder[($_.RiskSeverity).ToLower()] } else { 99 }
    }
} | Sort-Object -Property _hOrder, _sOrder, CheckId | Select-Object Horizon, CheckId, Setting, Severity, Effort, Status, Remediation

if ($roadmapRows -and @($roadmapRows).Count -gt 0) {
    $roadmapParams = @{
        Path          = $outputFile
        WorksheetName = 'Remediation Roadmap'
        AutoSize      = $true
        FreezeTopRow  = $true
        BoldTopRow    = $true
        TableStyle    = 'Medium4'
    }
    $roadmapRows | Export-Excel @roadmapParams
}

# ------------------------------------------------------------------
# Drift sheet (if a baseline comparison was run)
# ------------------------------------------------------------------
if ($DriftReport -and $DriftReport.Count -gt 0) {
    $driftRows = $DriftReport | ForEach-Object {
        [PSCustomObject]@{
            CheckId       = $_.CheckId
            Setting       = $_.Setting
            Section       = $_.Section
            Category      = $_.Category
            ChangeType    = $_.ChangeType
            PreviousStatus = $_.PreviousStatus
            CurrentStatus  = $_.CurrentStatus
            PreviousValue  = $_.PreviousValue
            CurrentValue   = $_.CurrentValue
        }
    }
    $driftParams = @{
        Path          = $outputFile
        WorksheetName = 'Drift'
        AutoSize      = $true
        FreezeTopRow  = $true
        BoldTopRow    = $true
        TableStyle    = 'Medium2'
    }
    $driftRows | Export-Excel @driftParams
}

# ------------------------------------------------------------------
# Sheet - Evidence Details (D1 #785)
# One row per finding with at least one structured evidence field populated.
# Kept on a dedicated sheet so the main Compliance Matrix stays scannable for
# compliance leaders who only need CheckId/Status/framework mappings.
# ------------------------------------------------------------------
if ($evidenceRows -and @($evidenceRows).Count -gt 0) {
    $evidenceParams = @{
        Path          = $outputFile
        WorksheetName = 'Evidence Details'
        AutoSize      = $true
        AutoFilter    = $true
        FreezeTopRow  = $true
        BoldTopRow    = $true
        TableStyle    = 'Medium3'
    }
    $evidenceRows | Export-Excel @evidenceParams
}

# ------------------------------------------------------------------
# Apply conditional formatting
# ------------------------------------------------------------------
$pkg = Open-ExcelPackage -Path $outputFile

# Matrix sheet - color-code Status, Sequence, RiskSeverity, and ImpactSeverity columns
$matrixSheet = $pkg.Workbook.Worksheets['Compliance Matrix']
$statusCol      = 4   # Column D = Status
$sequenceCol    = 5   # Column E = Sequence (issue #715, renamed in #840)
$riskSevCol     = 6   # Column F = RiskSeverity
$impactSevCol   = 7   # Column G = ImpactSeverity
$lastRow = $matrixSheet.Dimension.End.Row

for ($r = 2; $r -le $lastRow; $r++) {
    $val = $matrixSheet.Cells[$r, $statusCol].Value
    switch ($val) {
        'Pass'          { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(21, 128, 61));   $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(220, 252, 231)) }
        'Fail'          { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(185, 28, 28));   $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 226, 226)) }
        'Warning'       { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(146, 64, 14));   $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 243, 199)) }
        'Review'        { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(30, 64, 175));   $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(219, 234, 254)) }
        'Info'          { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(107, 114, 128)); $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(243, 244, 246)) }
        # New v2.9.0 statuses -- see docs/CHECK-STATUS-MODEL.md
        'Skipped'       { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(75, 85, 99));    $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(229, 231, 235)) }
        'Unknown'       { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(133, 77, 14));   $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 249, 195)) }
        'NotApplicable' { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(107, 114, 128)); $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(249, 250, 251)) }
        'NotLicensed'   { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(109, 40, 217));  $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(237, 233, 254)) }
    }

    # Issue #715: color the Sequence cell so consultants can scan Now/Next/Later/Done visually
    # Issue #840: 'Done' added (Pass rows) using the same green palette as the Pass status cell
    $sequenceVal = $matrixSheet.Cells[$r, $sequenceCol].Value
    switch ($sequenceVal) {
        'now'   { $matrixSheet.Cells[$r, $sequenceCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(185, 28, 28));  $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 226, 226)) }
        'soon'  { $matrixSheet.Cells[$r, $sequenceCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(146, 64, 14));  $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(254, 243, 199)) }
        'later' { $matrixSheet.Cells[$r, $sequenceCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(30, 64, 175));  $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(219, 234, 254)) }
        'Done'  { $matrixSheet.Cells[$r, $sequenceCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(21, 128, 61));   $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $sequenceCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(220, 252, 231)) }
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

# Drift sheet - color-code ChangeType column
$driftSheet = $pkg.Workbook.Worksheets['Drift']
if ($driftSheet -and $driftSheet.Dimension) {
    $changeTypeCol = 5  # Column E = ChangeType
    $driftLastRow  = $driftSheet.Dimension.End.Row
    for ($r = 2; $r -le $driftLastRow; $r++) {
        $ct = $driftSheet.Cells[$r, $changeTypeCol].Value
        $fg = $null; $bg = $null
        switch ($ct) {
            'Regressed'    { $fg = [System.Drawing.Color]::FromArgb(185, 28, 28);  $bg = [System.Drawing.Color]::FromArgb(254, 226, 226) }
            'Improved'     { $fg = [System.Drawing.Color]::FromArgb(21, 128, 61);  $bg = [System.Drawing.Color]::FromArgb(220, 252, 231) }
            'Modified'     { $fg = [System.Drawing.Color]::FromArgb(146, 64, 14);  $bg = [System.Drawing.Color]::FromArgb(254, 243, 199) }
            'New'          { $fg = [System.Drawing.Color]::FromArgb(30, 64, 175);  $bg = [System.Drawing.Color]::FromArgb(219, 234, 254) }
            'Removed'      { $fg = [System.Drawing.Color]::FromArgb(107, 114, 128);$bg = [System.Drawing.Color]::FromArgb(243, 244, 246) }
            'SchemaNew'    { $fg = [System.Drawing.Color]::FromArgb(30, 64, 175);  $bg = [System.Drawing.Color]::FromArgb(219, 234, 254) }
            'SchemaRemoved'{ $fg = [System.Drawing.Color]::FromArgb(107, 114, 128);$bg = [System.Drawing.Color]::FromArgb(243, 244, 246) }
        }
        if ($fg) {
            $driftSheet.Cells[$r, $changeTypeCol].Style.Font.Color.SetColor($fg)
            $driftSheet.Cells[$r, $changeTypeCol].Style.Fill.PatternType = 'Solid'
            $driftSheet.Cells[$r, $changeTypeCol].Style.Fill.BackgroundColor.SetColor($bg)
        }
    }
}

Close-ExcelPackage $pkg

Write-Host "  Compliance matrix exported: $outputFile" -ForegroundColor Green
