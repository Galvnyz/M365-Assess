<#
.SYNOPSIS
    Checks prerequisites for non-adopted features.
.DESCRIPTION
    For each feature in sku-feature-map.json, determines readiness state
    (Ready/Blocked/NotLicensed) by checking license status and prerequisite
    adoption. Reads sibling CSVs from the assessment folder. Zero API calls.
.PARAMETER ProjectRoot
    Path to the module root (contains controls/).
.PARAMETER AssessmentFolder
    Path to the assessment output folder (contains sibling CSVs).
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot,

    [Parameter()]
    [string]$AssessmentFolder
)

function Get-FeatureReadiness {
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject[]]$LicenseUtilization,

        [Parameter(Mandatory)]
        [PSCustomObject[]]$FeatureAdoption,

        [Parameter(Mandatory)]
        $FeatureMap,

        [Parameter()]
        [string]$OutputPath
    )

    $licenseLookup = @{}
    foreach ($lic in $LicenseUtilization) { $licenseLookup[$lic.FeatureId] = $lic }

    $adoptionLookup = @{}
    foreach ($adp in $FeatureAdoption) { $adoptionLookup[$adp.FeatureId] = $adp }

    $featureNameLookup = @{}
    foreach ($entry in $FeatureMap.featureGroups.PSObject.Properties) {
        $featureNameLookup[$entry.Name] = $entry.Value.displayName
    }

    $results = foreach ($entry in $FeatureMap.featureGroups.PSObject.Properties) {
        $featureId = $entry.Name
        $feature   = $entry.Value
        $lic = $licenseLookup[$featureId]
        $blockers = @()

        if (-not $lic -or -not $lic.IsLicensed) {
            $planNames = $feature.servicePlans -join ', '
            [PSCustomObject]@{
                FeatureId      = $featureId
                FeatureName    = $feature.displayName
                Category       = $feature.category
                ReadinessState = 'NotLicensed'
                Blockers       = "Requires $planNames"
                EffortTier     = $feature.effortTier
                LearnUrl       = $feature.learnUrl
            }
            continue
        }

        foreach ($prereqId in $feature.prerequisites) {
            $prereqAdoption = $adoptionLookup[$prereqId]
            if (-not $prereqAdoption -or $prereqAdoption.AdoptionState -notin @('Adopted', 'Partial')) {
                $prereqName = $featureNameLookup[$prereqId]
                if (-not $prereqName) { $prereqName = $prereqId }
                $blockers += "Requires $prereqName"
            }
        }

        $state = if ($blockers.Count -gt 0) { 'Blocked' } else { 'Ready' }

        [PSCustomObject]@{
            FeatureId      = $featureId
            FeatureName    = $feature.displayName
            Category       = $feature.category
            ReadinessState = $state
            Blockers       = ($blockers -join '; ')
            EffortTier     = $feature.effortTier
            LearnUrl       = $feature.learnUrl
        }
    }

    if ($OutputPath) {
        $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported feature readiness ($($results.Count) features) to $OutputPath"
    }
    else {
        Write-Output $results
    }
}

# --- Script entry point (called by orchestrator with -ProjectRoot) ---
if ($ProjectRoot -and $AssessmentFolder) {
    $featureMapPath = Join-Path -Path $ProjectRoot -ChildPath 'controls\sku-feature-map.json'
    if (-not (Test-Path -Path $featureMapPath)) {
        Write-Warning "sku-feature-map.json not found at $featureMapPath"
        return
    }
    $featureMap = Get-Content -Path $featureMapPath -Raw | ConvertFrom-Json

    $licCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '40-License-Utilization.csv'
    $licenseData = @()
    if (Test-Path -Path $licCsvPath) {
        $licenseData = @(Import-Csv -Path $licCsvPath -Encoding UTF8 | ForEach-Object {
            [PSCustomObject]@{
                FeatureId  = $_.FeatureId
                IsLicensed = ($_.IsLicensed -eq 'True')
            }
        })
    }

    $adpCsvPath = Join-Path -Path $AssessmentFolder -ChildPath '41-Feature-Adoption.csv'
    $adoptionData = @()
    if (Test-Path -Path $adpCsvPath) {
        $adoptionData = @(Import-Csv -Path $adpCsvPath -Encoding UTF8)
    }

    Get-FeatureReadiness -LicenseUtilization $licenseData -FeatureAdoption $adoptionData -FeatureMap $featureMap
}
