function Get-FeatureAdoption {
    <#
    .SYNOPSIS
        Scores feature adoption from assessment signals and license data.
    .DESCRIPTION
        For each feature in the sku-feature-map, determines adoption state by
        cross-referencing assessment signals (collected by Add-SecuritySetting)
        against the feature's checkIds. License utilization data gates whether
        a feature is even available to the tenant.

        Adoption states: Adopted (100), Partial (1-99), NotAdopted (0),
        NotLicensed (unlicensed), Unknown (licensed but no signals).
    .PARAMETER AdoptionSignals
        Hashtable keyed by sub-check IDs (e.g. ENTRA-PIM-001.1) with Status,
        Setting, CurrentValue, and Category properties. Populated by the
        AdoptionAccumulator during assessment collection.
    .PARAMETER LicenseUtilization
        Array of PSCustomObject from Get-LicenseUtilization with FeatureId
        and IsLicensed properties.
    .PARAMETER FeatureMap
        Parsed sku-feature-map.json object containing features and categories.
    .PARAMETER AssessmentFolder
        Path to the assessment output folder for optional CSV signal parsing.
    .PARAMETER OutputPath
        Optional CSV output path for the adoption results.
    .EXAMPLE
        Get-FeatureAdoption -AdoptionSignals $signals -LicenseUtilization $license -FeatureMap $map -AssessmentFolder 'C:\output'
        Returns per-feature adoption scores based on assessment signals.
    #>
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

    # Build category lookup
    $categories = @{}
    foreach ($cat in $FeatureMap.categories) {
        $categories[$cat.id] = $cat.name
    }

    # Build license lookup
    $licenseLookup = @{}
    foreach ($lic in $LicenseUtilization) {
        $licenseLookup[$lic.FeatureId] = $lic.IsLicensed
    }

    $results = foreach ($feature in $FeatureMap.features) {
        $featureId = $feature.featureId
        $isLicensed = $false
        if ($licenseLookup.ContainsKey($featureId)) {
            $isLicensed = $licenseLookup[$featureId]
        }

        # Not licensed -- skip signal matching
        if (-not $isLicensed) {
            [PSCustomObject]@{
                FeatureId    = $featureId
                FeatureName  = $feature.name
                Category     = $categories[$feature.category]
                AdoptionState = 'NotLicensed'
                AdoptionScore = 0
                PassedChecks = 0
                TotalChecks  = 0
                DepthMetric  = ''
            }
            continue
        }

        # Match signals by base CheckId prefix
        $passedCount = 0
        $totalCount = 0

        foreach ($baseId in $feature.checkIds) {
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

        # Determine adoption state
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

        # Optional CSV depth metrics
        $depthMetric = ''
        $csvSignals = $feature.csvSignals
        if ($null -ne $csvSignals -and $csvSignals.Count -gt 0) {
            $depthParts = @()
            foreach ($csvDef in $csvSignals) {
                try {
                    $csvFile = Join-Path -Path $AssessmentFolder -ChildPath $csvDef.file
                    if (-not (Test-Path -Path $csvFile)) {
                        continue
                    }
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
                        $matchCount = @($matching).Count
                        $depthParts += "$($csvDef.label): $matchCount"
                    }
                }
                catch {
                    Write-Verbose "Get-FeatureAdoption: CSV signal parsing failed for $($csvDef.file): $_"
                }
            }
            $depthMetric = $depthParts -join '; '
        }

        [PSCustomObject]@{
            FeatureId     = $featureId
            FeatureName   = $feature.name
            Category      = $categories[$feature.category]
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
