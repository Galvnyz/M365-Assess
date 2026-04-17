function Measure-ValueOpportunity {
    <#
    .SYNOPSIS
        Merges license utilization, feature adoption, and readiness into a unified analysis.
    .DESCRIPTION
        Produces overall adoption percentage, category breakdown, phased roadmap,
        and gap matrix from the three Value Opportunity collector outputs.
    .PARAMETER LicenseUtilization
        Array of PSCustomObjects from Get-LicenseUtilization.
    .PARAMETER FeatureAdoption
        Array of PSCustomObjects from Get-FeatureAdoption.
    .PARAMETER FeatureReadiness
        Array of PSCustomObjects from Get-FeatureReadiness.
    .PARAMETER FeatureMap
        Parsed sku-feature-map.json object.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject[]]$LicenseUtilization,

        [Parameter(Mandatory)]
        [PSCustomObject[]]$FeatureAdoption,

        [Parameter(Mandatory)]
        [PSCustomObject[]]$FeatureReadiness,

        [Parameter(Mandatory)]
        $FeatureMap
    )

    # Build lookup tables keyed by FeatureId
    $licenseLookup = @{}
    foreach ($item in $LicenseUtilization) {
        $licenseLookup[$item.FeatureId] = $item
    }

    $adoptionLookup = @{}
    foreach ($item in $FeatureAdoption) {
        $adoptionLookup[$item.FeatureId] = $item
    }

    $readinessLookup = @{}
    foreach ($item in $FeatureReadiness) {
        $readinessLookup[$item.FeatureId] = $item
    }

    $featureMapLookup = @{}
    foreach ($entry in $FeatureMap.featureGroups.PSObject.Properties) {
        $featureMapLookup[$entry.Name] = $entry.Value
    }

    # Identify licensed feature IDs
    $licensedFeatureIds = @($LicenseUtilization | Where-Object { $_.IsLicensed -eq $true } | ForEach-Object { $_.FeatureId })
    $licensedFeatureCount = $licensedFeatureIds.Count

    # Count adopted and partial among licensed features
    $adoptedFeatureCount = 0
    $partialFeatureCount = 0
    $gapCount = 0

    foreach ($featureId in $licensedFeatureIds) {
        $adoption = $adoptionLookup[$featureId]
        if ($adoption) {
            switch ($adoption.AdoptionState) {
                'Adopted'    { $adoptedFeatureCount++ }
                'Partial'    { $partialFeatureCount++ }
                default      { $gapCount++ }
            }
        } else {
            $gapCount++
        }
    }

    # Overall adoption percentage
    if ($licensedFeatureCount -eq 0) {
        $overallAdoptionPct = 0
    } else {
        $overallAdoptionPct = [int][Math]::Round(($adoptedFeatureCount + $partialFeatureCount) / $licensedFeatureCount * 100, 0, [MidpointRounding]::AwayFromZero)
    }

    # Category breakdown - group by Category from FeatureAdoption
    $categoryGroups = @{}
    foreach ($adoption in $FeatureAdoption) {
        $category = $adoption.Category
        if (-not $categoryGroups.ContainsKey($category)) {
            $categoryGroups[$category] = @{
                Category   = $category
                Licensed   = 0
                Adopted    = 0
                Partial    = 0
                NotAdopted = 0
                Unknown    = 0
            }
        }

        $featureId = $adoption.FeatureId
        $license = $licenseLookup[$featureId]
        $isLicensed = $license -and $license.IsLicensed -eq $true

        if ($isLicensed) {
            $categoryGroups[$category].Licensed++
            switch ($adoption.AdoptionState) {
                'Adopted'    { $categoryGroups[$category].Adopted++ }
                'Partial'    { $categoryGroups[$category].Partial++ }
                'NotAdopted' { $categoryGroups[$category].NotAdopted++ }
                'Unknown'    { $categoryGroups[$category].Unknown++ }
                default      { $categoryGroups[$category].Unknown++ }
            }
        }
    }

    # Compute per-category percentage
    $categoryBreakdown = @()
    foreach ($entry in $categoryGroups.Values) {
        if ($entry.Licensed -eq 0) {
            $entry['Pct'] = 0
        } else {
            $entry['Pct'] = [int][Math]::Round(($entry.Adopted + $entry.Partial) / $entry.Licensed * 100, 0, [MidpointRounding]::AwayFromZero)
        }
        $categoryBreakdown += $entry
    }

    # Sort category breakdown by name for deterministic output
    $categoryBreakdown = @($categoryBreakdown | Sort-Object { $_.Category })

    # Roadmap - licensed features with AdoptionState NotAdopted or Unknown, grouped by EffortTier
    $roadmap = @{
        'Quick Win'  = @()
        'Medium'     = @()
        'Strategic'  = @()
    }

    foreach ($featureId in $licensedFeatureIds) {
        $adoption = $adoptionLookup[$featureId]
        if (-not $adoption) { continue }

        if ($adoption.AdoptionState -in @('NotAdopted', 'Unknown')) {
            $readiness = $readinessLookup[$featureId]

            $effortTier = if ($readiness) { $readiness.EffortTier } else { 'Strategic' }
            $mergedObj = [PSCustomObject]@{
                FeatureId      = $featureId
                FeatureName    = if ($adoption.FeatureName) { $adoption.FeatureName } else { '' }
                Category       = if ($adoption.Category) { $adoption.Category } else { '' }
                AdoptionScore  = if ($adoption.AdoptionScore) { $adoption.AdoptionScore } else { 0 }
                ReadinessState = if ($readiness) { $readiness.ReadinessState } else { 'Unknown' }
                Blockers       = if ($readiness) { $readiness.Blockers } else { '' }
                EffortTier     = $effortTier
                LearnUrl       = if ($readiness) { $readiness.LearnUrl } else { '' }
            }

            if ($roadmap.ContainsKey($effortTier)) {
                $roadmap[$effortTier] += @($mergedObj)
            } else {
                $roadmap[$effortTier] = @($mergedObj)
            }
        }
    }

    # Gap matrix - same as category breakdown but without Pct
    $gapMatrix = @()
    foreach ($entry in $categoryBreakdown) {
        $gapMatrix += @{
            Category   = $entry.Category
            Adopted    = $entry.Adopted
            Partial    = $entry.Partial
            NotAdopted = $entry.NotAdopted
            Unknown    = $entry.Unknown
        }
    }

    # Not-licensed features
    $notLicensedFeatures = @()
    foreach ($item in $LicenseUtilization) {
        if ($item.IsLicensed -eq $false) {
            $featureId = $item.FeatureId
            $adoption = $adoptionLookup[$featureId]
            $readiness = $readinessLookup[$featureId]
            $mapEntry = $featureMapLookup[$featureId]

            $notLicensedFeatures += [PSCustomObject]@{
                FeatureId            = $featureId
                FeatureName          = if ($adoption) { $adoption.FeatureName } else { '' }
                Category             = if ($adoption) { $adoption.Category } else { '' }
                EffortTier           = if ($readiness) { $readiness.EffortTier } else { '' }
                RequiredServicePlans = if ($mapEntry) { $mapEntry.servicePlans } else { @() }
            }
        }
    }

    return @{
        OverallAdoptionPct   = $overallAdoptionPct
        LicensedFeatureCount = $licensedFeatureCount
        AdoptedFeatureCount  = $adoptedFeatureCount
        PartialFeatureCount  = $partialFeatureCount
        GapCount             = $gapCount
        CategoryBreakdown    = $categoryBreakdown
        Roadmap              = $roadmap
        GapMatrix            = $gapMatrix
        NotLicensedFeatures  = $notLicensedFeatures
    }
}
