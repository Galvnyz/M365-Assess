<#
.SYNOPSIS
    Loads assessment section data and builds the findings list for the React report engine.
.DESCRIPTION
    Dot-sourced by Export-AssessmentReport.ps1. Reads completed collector CSVs from the
    assessment folder and produces two shared-scope variables:

      $allCisFindings — List[PSCustomObject] of enriched check rows (CheckId, Status,
                        RiskSeverity, Frameworks, etc.) used by Build-ReportDataJson and
                        Export-ComplianceMatrix.

      $sectionData    — Hashtable keyed by section name (tenant, users, mfa, score,
                        admin-roles, ca, licenses, dns) containing raw Import-Csv rows
                        for the REPORT_DATA sidebar tables.

    Also invokes Export-ComplianceMatrix.ps1 to produce the companion XLSX file.

    Caller scope must provide: $AssessmentFolder, $summary, $controlRegistry,
    $allFrameworks, $cisFrameworkId, $reportDomainPrefix, $WhiteLabel, $DriftReport.
.NOTES
    Author: Daren9m
#>
# Variables set here are consumed by Export-AssessmentReport.ps1 via shared scope.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

# ------------------------------------------------------------------
# 1. Load named section CSVs for REPORT_DATA sidebar tables
# ------------------------------------------------------------------
$loadCsv = {
    param([string]$FileName)
    $csvPath = Join-Path -Path $AssessmentFolder -ChildPath $FileName
    if (Test-Path -Path $csvPath) { @(Import-Csv -Path $csvPath) } else { @() }
}

$dnsCsvRaw = & $loadCsv '12-DNS-Email-Authentication.csv'

$sectionData = @{
    'tenant'      = & $loadCsv '01-Tenant-Info.csv'
    'users'       = & $loadCsv '02-User-Summary.csv'
    'mfa'         = & $loadCsv '03-MFA-Report.csv'
    'admin-roles' = & $loadCsv '04-Admin-Roles.csv'
    'ca'          = & $loadCsv '05-Conditional-Access.csv'
    'licenses'    = & $loadCsv '08-License-Summary.csv'
    'score'            = & $loadCsv '16-Secure-Score.csv'
    'dns'              = @($dnsCsvRaw | Where-Object { $_.Domain -notmatch '\.onmicrosoft\.com$' })
    'mailbox-summary'  = & $loadCsv '09-Mailbox-Summary.csv'
    'mailflow'         = & $loadCsv '10-Mail-Flow.csv'
    'device-summary'   = & $loadCsv '13-Device-Summary.csv'
    'sharepoint-config'= & $loadCsv '20b-SharePoint-Security-Config.csv'
    'ad-hybrid'        = & $loadCsv '23-Hybrid-Sync.csv'
    'ad-security'      = & $loadCsv '26-AD-Security.csv'
}

# ------------------------------------------------------------------
# 2. Build allCisFindings from all completed collector CSVs
# ------------------------------------------------------------------
$allCisFindings = [System.Collections.Generic.List[PSCustomObject]]::new()

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
        $fw    = if ($entry) { $entry.frameworks } else { @{} }

        $fwHash = @{}
        foreach ($fwDef in $allFrameworks) {
            $fwData = $fw.($fwDef.frameworkId)
            if ($fwData) {
                $fwHash[$fwDef.frameworkId] = @{ controlId = $fwData.controlId }
                if ($fwData.profiles) { $fwHash[$fwDef.frameworkId].profiles = @($fwData.profiles) }
            }
        }

        $allCisFindings.Add([PSCustomObject]@{
            CheckId         = $row.CheckId
            CisControl      = if ($fwHash[$cisFrameworkId]) { $fwHash[$cisFrameworkId].controlId } else { '' }
            Category        = $row.Category
            Setting         = $row.Setting
            CurrentValue    = $row.CurrentValue
            RecommendedValue = $row.RecommendedValue
            Status          = $row.Status
            Remediation     = $row.Remediation
            Section         = $c.Section
            Source          = $c.Collector
            RiskSeverity    = if ($entry) { $entry.riskSeverity } else { 'Medium' }
            ImpactRationale = if ($entry -and $entry.impactRating -and $entry.impactRating.rationale) { $entry.impactRating.rationale } else { '' }
            Frameworks      = $fwHash
        })
    }
}

# ------------------------------------------------------------------
# 3. Export Compliance Matrix XLSX (requires ImportExcel module)
# ------------------------------------------------------------------
try {
    $xlsxScript = Join-Path -Path $PSScriptRoot -ChildPath 'Export-ComplianceMatrix.ps1'
    if (Test-Path -Path $xlsxScript) {
        $xlsxParams = @{ AssessmentFolder = $AssessmentFolder; TenantName = $reportDomainPrefix }
        if ($DriftReport -and $DriftReport.Count -gt 0) { $xlsxParams['DriftReport'] = $DriftReport }
        & $xlsxScript @xlsxParams
    }
} catch {
    Write-Warning "XLSX compliance matrix export failed: $($_.Exception.Message)"
}
