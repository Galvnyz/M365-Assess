<#
.SYNOPSIS
    Cross-references tenant licenses against the feature map.
.DESCRIPTION
    For each feature in sku-feature-map.json, checks if the tenant has any
    of the required service plans. Outputs per-feature license status.
    Called by the orchestrator as a data collector (with -ProjectRoot param)
    or dot-sourced by tests to access the Get-LicenseUtilization function.
.PARAMETER ProjectRoot
    Path to the module root (contains controls/). When provided, runs as
    a self-contained script.
.PARAMETER AssessmentFolder
    Path to the assessment output folder. Passed by the orchestrator via PassProjectContext.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot,

    [Parameter()]
    [string]$AssessmentFolder
)

function Get-LicenseUtilization {
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter(Mandatory)]
        [hashtable]$TenantLicenses,

        [Parameter(Mandatory)]
        $FeatureMap,

        [Parameter()]
        [string]$OutputPath
    )

    $results = foreach ($entry in $FeatureMap.featureGroups.PSObject.Properties) {
        $featureId = $entry.Name
        $feature   = $entry.Value
        $isLicensed = $false
        $sourceSkus = @()

        foreach ($plan in $feature.servicePlans) {
            if ($TenantLicenses.ActiveServicePlans.Contains($plan)) {
                $isLicensed = $true
                $sourceSkus += $plan
            }
        }

        [PSCustomObject]@{
            FeatureId   = $featureId
            FeatureName = $feature.displayName
            Category    = $feature.category
            IsLicensed  = $isLicensed
            SourcePlans = ($sourceSkus -join ', ')
            EffortTier  = $feature.effortTier
            LearnUrl    = $feature.learnUrl
        }
    }

    if ($OutputPath) {
        $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported license utilization ($($results.Count) features) to $OutputPath"
    }
    else {
        Write-Output $results
    }
}

# --- Script entry point (called by orchestrator with -ProjectRoot) ---
if ($ProjectRoot) {
    $featureMapPath = Join-Path -Path $ProjectRoot -ChildPath 'controls\sku-feature-map.json'
    if (-not (Test-Path -Path $featureMapPath)) {
        Write-Warning "sku-feature-map.json not found at $featureMapPath"
        return
    }
    $featureMap = Get-Content -Path $featureMapPath -Raw | ConvertFrom-Json

    $resolverPath = Join-Path -Path $ProjectRoot -ChildPath 'Common\Resolve-TenantLicenses.ps1'
    if (-not (Test-Path -Path $resolverPath)) {
        Write-Warning "Resolve-TenantLicenses.ps1 not found"
        return
    }
    . $resolverPath
    $tenantLicenses = Resolve-TenantLicenses

    Get-LicenseUtilization -TenantLicenses $tenantLicenses -FeatureMap $featureMap
}
