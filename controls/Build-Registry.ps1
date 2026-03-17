<#
.SYNOPSIS
    Builds the master control registry (registry.json) from framework mappings and check-ID mappings.

.DESCRIPTION
    Reads two CSV sources and produces controls/registry.json — the canonical registry
    mapping every CIS check to all its framework memberships including SOC 2.

    Source 1: Common/framework-mappings.csv  (CIS controls + framework cross-references)
    Source 2: controls/check-id-mapping.csv  (check IDs, collectors, areas)

    The script also derives SOC 2 Trust Services Criteria (CC) mappings from the
    NIST 800-53 control families present on each check.

.PARAMETER OutputPath
    Path to write the JSON registry. Defaults to controls/registry.json relative to
    the repository root.

.NOTES
    Version:  1.0.0
    Author:   M365-Assess contributors

.EXAMPLE
    .\controls\Build-Registry.ps1
    Generates controls/registry.json from the default CSV sources.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [switch]$CheckOnly
)

# Resolve repo root (parent of this script's directory)
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $OutputPath) {
    $OutputPath = Join-Path $repoRoot 'controls' 'registry.json'
}

$frameworkCsvPath = Join-Path $repoRoot 'Common' 'framework-mappings.csv'
$checkIdCsvPath   = Join-Path $repoRoot 'controls' 'check-id-mapping.csv'

if ($CheckOnly) {
    if (-not (Test-Path -Path $OutputPath)) {
        Write-Warning "Registry not found at $OutputPath - rebuild required."
        return $false
    }
    $registryTime = (Get-Item -Path $OutputPath).LastWriteTime
    $sourceFiles = @($frameworkCsvPath, $checkIdCsvPath)
    $staleSource = $sourceFiles | Where-Object { (Get-Item -Path $_).LastWriteTime -gt $registryTime }
    if ($staleSource) {
        $names = ($staleSource | ForEach-Object { Split-Path -Leaf $_ }) -join ', '
        Write-Warning "Registry is stale - $names updated after last build."
        return $false
    }
    Write-Host "Registry is up to date."
    return $true
}

# --- Load CSVs ---
$frameworkRows = Import-Csv -Path $frameworkCsvPath
$checkIdRows   = Import-Csv -Path $checkIdCsvPath

# Index check-ID rows by CisControl
$checkIdMap = @{}
foreach ($row in $checkIdRows) {
    $checkIdMap[$row.CisControl] = $row
}

# --- SOC 2 mapping from NIST 800-53 control family prefixes ---
# Each key is a regex pattern matched against individual NIST control IDs.
# Order matters: more specific patterns are checked first.
$soc2MappingRules = [ordered]@{
    '^AC-2'      = 'CC6.1;CC6.2;CC6.3'
    '^AC-3'      = 'CC6.1;CC6.2;CC6.3'
    '^AC-6'      = 'CC6.1;CC6.3'
    '^AC-11'     = 'CC6.1'
    '^AC-12'     = 'CC6.1'
    '^AU-'       = 'CC7.1;CC7.2'
    '^IA-'       = 'CC6.1'
    '^CM-'       = 'CC5;CC8.1'
    '^SC-'       = 'CC6.1;CC6.7'
    '^SI-3'      = 'CC6.8;CC7.1'
    '^SI-8'      = 'CC6.8;CC7.1'
    '^SI-4'      = 'CC7.1;CC7.2'
    '^SI-'       = 'CC7.1'
}

function Get-Soc2CriteriaFromNist {
    [CmdletBinding()]
    param([string]$NistControlIds)

    if ([string]::IsNullOrWhiteSpace($NistControlIds)) { return $null }

    $allCriteria = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $nistParts = $NistControlIds -split ';'

    foreach ($nistId in $nistParts) {
        $nistId = $nistId.Trim()
        if ([string]::IsNullOrWhiteSpace($nistId)) { continue }

        foreach ($pattern in $soc2MappingRules.Keys) {
            if ($nistId -match $pattern) {
                foreach ($cc in ($soc2MappingRules[$pattern] -split ';')) {
                    [void]$allCriteria.Add($cc.Trim())
                }
                break  # first matching rule wins for this NIST ID
            }
        }
    }

    if ($allCriteria.Count -eq 0) { return $null }

    # Sort criteria for consistent output
    $sorted = $allCriteria | Sort-Object {
        if ($_ -match 'CC(\d+)(?:\.(\d+))?') {
            [int]$Matches[1] * 100 + [int]($Matches[2] ?? 0)
        } else { 9999 }
    }
    return ($sorted -join ';')
}

# --- Framework column to JSON key mapping ---
$frameworkColumnMap = [ordered]@{
    'NistCsf'   = 'nist-csf'
    'Nist80053'  = 'nist-800-53'
    'Iso27001'  = 'iso-27001'
    'Stig'      = 'stig'
    'PciDss'    = 'pci-dss'
    'Cmmc'      = 'cmmc'
    'Hipaa'     = 'hipaa'
    'CisaScuba' = 'cisa-scuba'
}

# --- Build checks array ---
$checks = [System.Collections.Generic.List[object]]::new()

foreach ($fwRow in $frameworkRows) {
    $cisControl = $fwRow.CisControl
    $cidRow = $checkIdMap[$cisControl]

    if (-not $cidRow) {
        Write-Warning "No check-ID mapping found for CIS control $cisControl — skipping."
        continue
    }

    # Determine CIS profiles
    $profiles = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($fwRow.CisE3L1)) { $profiles.Add('E3-L1') }
    if (-not [string]::IsNullOrWhiteSpace($fwRow.CisE3L2)) { $profiles.Add('E3-L2') }
    if (-not [string]::IsNullOrWhiteSpace($fwRow.CisE5L1)) { $profiles.Add('E5-L1') }
    if (-not [string]::IsNullOrWhiteSpace($fwRow.CisE5L2)) { $profiles.Add('E5-L2') }

    # Licensing: E5 only if no E3 profiles
    $hasE3 = (-not [string]::IsNullOrWhiteSpace($fwRow.CisE3L1)) -or
             (-not [string]::IsNullOrWhiteSpace($fwRow.CisE3L2))
    $minimumLicense = if ($hasE3) { 'E3' } else { 'E5' }

    # hasAutomatedCheck
    $checkId = $cidRow.CheckId
    $hasAutomated = -not ($checkId -like 'MANUAL-*')

    # Category and collector
    $category  = if ([string]::IsNullOrWhiteSpace($cidRow.Area)) { '' } else { $cidRow.Area }
    $collector = if ([string]::IsNullOrWhiteSpace($cidRow.Collector)) { '' } else { $cidRow.Collector }

    # Build frameworks object — start with CIS
    $frameworks = [ordered]@{
        'cis-m365-v6' = [ordered]@{
            controlId = $cisControl
            title     = $fwRow.CisTitle
            profiles  = @($profiles)
        }
    }

    # Add other frameworks
    foreach ($colName in $frameworkColumnMap.Keys) {
        $jsonKey = $frameworkColumnMap[$colName]
        $value = $fwRow.$colName
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $frameworks[$jsonKey] = [ordered]@{
                controlId = $value.Trim()
            }
        }
    }

    # Add SOC 2 derived from NIST 800-53
    $nist80053Value = $fwRow.Nist80053
    $soc2Criteria = Get-Soc2CriteriaFromNist -NistControlIds $nist80053Value
    if ($soc2Criteria) {
        $frameworks['soc2'] = [ordered]@{
            controlId    = $soc2Criteria
            evidenceType = 'config-export'
        }
    }

    $checkObj = [ordered]@{
        checkId           = $checkId
        name              = $fwRow.CisTitle
        category          = $category
        collector         = $collector
        hasAutomatedCheck = $hasAutomated
        licensing         = [ordered]@{ minimum = $minimumLicense }
        frameworks        = $frameworks
    }

    $checks.Add($checkObj)
}

# Sort by CIS control ID (numerical sort on each dotted segment)
$checks = $checks | Sort-Object {
    $parts = $_.frameworks['cis-m365-v6'].controlId -split '\.'
    # Zero-pad each segment to 4 digits for proper lexicographic sort
    ($parts | ForEach-Object { $_.PadLeft(4, '0') }) -join '.'
}

# Build final registry object
$registry = [ordered]@{
    version       = '1.0.0'
    generatedFrom = 'Common/framework-mappings.csv + controls/check-id-mapping.csv'
    checks        = @($checks)
}

# Write JSON (UTF-8 no BOM)
$jsonText = $registry | ConvertTo-Json -Depth 10
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutputPath, $jsonText, $utf8NoBom)

Write-Host "Registry written to: $OutputPath"
Write-Host "Total checks:     $($checks.Count)"
Write-Host "Automated checks: $(($checks | Where-Object { $_.hasAutomatedCheck }).Count)"
Write-Host "Manual checks:    $(($checks | Where-Object { -not $_.hasAutomatedCheck }).Count)"
Write-Host "SOC 2 mappings:   $(($checks | Where-Object { $_.frameworks.Contains('soc2') }).Count)"
