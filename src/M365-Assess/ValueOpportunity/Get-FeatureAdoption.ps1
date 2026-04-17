<#
.SYNOPSIS
    Scores feature adoption from assessment signals and license data.
.DESCRIPTION
    For each feature in sku-feature-map.json, determines adoption state by
    cross-referencing signals accumulated by Add-SecuritySetting against
    the feature's detectionChecks. Reads sibling License Utilization CSV for
    license gating. Zero new API calls.
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

function Get-FeatureAdoption {
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$AdoptionSignals,

        [Parameter(Mandatory)]
        [PSCustomObject[]]$LicenseUtilization,

        [Parameter(Mandatory)]
        $FeatureMap,

        [Parameter(Mandatory)]
        [string]$AssessmentFolder,

        [Parameter()]
        [string]$OutputPath
    )

    $licenseLookup = @{}
    foreach ($lic in $LicenseUtilization) {
        $licenseLookup[$lic.FeatureId] = $lic.IsLicensed
    }

    $results = foreach ($entry in $FeatureMap.featureGroups.PSObject.Properties) {
        $featureId = $entry.Name
        $feature   = $entry.Value
        $isLicensed = $false
        if ($licenseLookup.ContainsKey($featureId)) {
            $isLicensed = $licenseLookup[$featureId]
        }

        if (-not $isLicensed) {
            [PSCustomObject]@{
                FeatureId     = $featureId
                FeatureName   = $feature.displayName
                Category      = $feature.category
                AdoptionState = 'NotLicensed'
                AdoptionScore = 0
                PassedChecks  = 0
                TotalChecks   = 0
                DepthMetric   = ''
            }
            continue
        }

        $passedCount = 0
        $totalCount = 0

        foreach ($baseId in $feature.detectionChecks) {
            $prefix = "$baseId."
            foreach ($signalKey in $AdoptionSignals.Keys) {
                if ($signalKey.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $totalCount++
                    if ($AdoptionSignals[$signalKey].Status -eq 'Pass') {
                        $passedCount++
                    }
                }
            }
        }

        if ($totalCount -eq 0) {
            $adoptionState = 'Unknown'
            $adoptionScore = 0
        }
        elseif ($passedCount -eq $totalCount) {
            $adoptionState = 'Adopted'
            $adoptionScore = 100
        }
        elseif ($passedCount -eq 0) {
            $adoptionState = 'NotAdopted'
            $adoptionScore = 0
        }
        else {
            $adoptionState = 'Partial'
            $adoptionScore = [math]::Round(($passedCount / $totalCount) * 100)
        }

        $depthMetric = ''
        $csvSignals = $feature.csvSignals
        if ($null -ne $csvSignals -and @($csvSignals).Count -gt 0) {
            $depthParts = @()
            foreach ($csvDef in $csvSignals) {
                try {
                    $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $csvDef.file
                    if (-not (Test-Path -Path $csvFile)) { continue }
                    $csvData = Import-Csv -Path $csvFile -Encoding UTF8

                    if ($csvDef.metric -eq 'passRate') {
                        $column = $csvDef.column
                        $pattern = $csvDef.pattern
                        $matching = $csvData | Where-Object { $_.$column -match $pattern }
                        $matchTotal = @($matching).Count
                        $matchPass = @($matching | Where-Object { $_.Status -eq 'Pass' }).Count
                        if ($matchTotal -gt 0) {
                            $rate = [math]::Round(($matchPass / $matchTotal) * 100)
                            $depthParts += "$($csvDef.label): $rate% ($matchPass/$matchTotal)"
                        }
                    }
                    elseif ($csvDef.metric -eq 'count') {
                        $column = $csvDef.column
                        $pattern = $csvDef.pattern
                        $matching = $csvData | Where-Object { $_.$column -match $pattern }
                        $depthParts += "$($csvDef.label): $(@($matching).Count)"
                    }
                }
                catch {
                    Write-Verbose "CSV signal parsing failed for $($csvDef.file): $_"
                }
            }
            $depthMetric = $depthParts -join '; '
        }

        [PSCustomObject]@{
            FeatureId     = $featureId
            FeatureName   = $feature.displayName
            Category      = $feature.category
            AdoptionState = $adoptionState
            AdoptionScore = $adoptionScore
            PassedChecks  = $passedCount
            TotalChecks   = $totalCount
            DepthMetric   = $depthMetric
        }
    }

    if ($OutputPath) {
        $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported feature adoption ($($results.Count) features) to $OutputPath"
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

    $signals = @{}
    if (Get-Command -Name Get-AdoptionSignals -ErrorAction SilentlyContinue) {
        $signals = Get-AdoptionSignals
    }
    elseif ($global:AdoptionSignals) {
        $signals = $global:AdoptionSignals.Clone()
    }

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

    Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $licenseData -FeatureMap $featureMap -AssessmentFolder $AssessmentFolder
}
