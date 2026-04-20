<#
.SYNOPSIS
    Loads the control registry and builds lookup tables for the report layer.
.DESCRIPTION
    Loads check data from the local controls/registry.json file (synced from
    CheckID via CI). Returns a hashtable keyed by CheckId with framework
    mappings and risk severity.

    Supports both CheckID schema versions:
    - v1.x: licensing.requiredServicePlans (array of plan IDs)
    - v2.0.0: licensing.minimum ("E3" or "E5") normalized via licensing-overlay.json

    Also builds a reverse lookup from CIS control IDs to CheckIds (stored
    under the special key '__cisReverseLookup') for backward compatibility
    with CSVs that still use the CisControl column.
.PARAMETER ControlsPath
    Path to the controls/ directory containing registry.json,
    risk-severity.json, and licensing-overlay.json.
.PARAMETER CisFrameworkId
    Framework ID for the active CIS benchmark version, used for the reverse
    lookup. Defaults to 'cis-m365-v6'.
.OUTPUTS
    [hashtable] - Keys are CheckIds, values are registry entry objects.
    Special key '__cisReverseLookup' maps CIS control IDs to CheckIds.
#>
function Import-ControlRegistry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ControlsPath,

        [Parameter()]
        [string]$CisFrameworkId = 'cis-m365-v6'
    )

    $registryPath = Join-Path -Path $ControlsPath -ChildPath 'registry.json'
    if (-not (Test-Path -Path $registryPath)) {
        Write-Warning "Control registry not found: $registryPath"
        return @{}
    }

    $raw = Get-Content -Path $registryPath -Raw | ConvertFrom-Json
    $checks = @($raw.checks)
    $schemaVersion = if ($raw.PSObject.Properties.Name -contains 'schemaVersion') { $raw.schemaVersion } else { '1.x' }
    Write-Verbose "Loaded $($checks.Count) checks from registry.json (schema $schemaVersion, data $($raw.dataVersion))"

    # Load licensing overlay (M365-Assess-specific service plan gating)
    $licensingOverlay = @{}
    $overlayPath = Join-Path -Path $ControlsPath -ChildPath 'licensing-overlay.json'
    if (Test-Path -Path $overlayPath) {
        $overlayData = Get-Content -Path $overlayPath -Raw | ConvertFrom-Json
        foreach ($prop in $overlayData.checks.PSObject.Properties) {
            $licensingOverlay[$prop.Name] = @($prop.Value)
        }
        Write-Verbose "Loaded $($licensingOverlay.Count) licensing overrides from licensing-overlay.json"
    }

    # Build hashtable keyed by CheckId
    $lookup = @{}
    $cisReverse = @{}

    foreach ($check in $checks) {
        # Normalize licensing across schema versions:
        # v1.x: { requiredServicePlans: [...] }  — pass through
        # v2.0.0: { minimum: "E3"|"E5" }         — resolved via licensing-overlay.json
        # Initialize to empty array; only populated if overlay or v1.x data matches.
        # Note: $requiredPlans must be declared with @() before conditional mutation —
        # assigning @() via an if/else expression returns $null in PowerShell because
        # an empty array emits nothing to the pipeline in that context.
        $requiredPlans = @()
        if ($licensingOverlay.ContainsKey($check.checkId)) {
            $requiredPlans = $licensingOverlay[$check.checkId]
        } elseif ($check.licensing -and $check.licensing.PSObject.Properties.Name -contains 'requiredServicePlans') {
            $requiredPlans = @($check.licensing.requiredServicePlans)
        }

        $entry = @{
            checkId           = $check.checkId
            name              = $check.name
            category          = $check.category
            collector         = $check.collector
            hasAutomatedCheck = $check.hasAutomatedCheck
            licensing         = @{ requiredServicePlans = $requiredPlans }
            frameworks        = @{}
            scf               = $check.scf           # PSCustomObject from CheckID v2.0.0; $null for local extensions
            impactRating      = $check.impactRating   # PSCustomObject from CheckID v2.0.0; $null for local extensions
            remediation       = if ($check.remediation) { [string]$check.remediation } else { '' }  # empty string not $null
        }

        # Convert framework PSCustomObject properties to hashtable
        foreach ($prop in $check.frameworks.PSObject.Properties) {
            $entry.frameworks[$prop.Name] = $prop.Value
        }

        $entry.riskSeverity = 'Medium'  # default, overridden from risk-severity.json below
        $lookup[$check.checkId] = $entry

        # Build CIS reverse lookup (parameterized for version upgrades)
        $cisMapping = $check.frameworks.$CisFrameworkId
        if ($cisMapping -and $cisMapping.controlId) {
            $cisReverse[$cisMapping.controlId] = $check.checkId
        }
    }

    $lookup['__cisReverseLookup'] = $cisReverse

    # Load risk severity overlay (local to M365-Assess, not in CheckID)
    $severityPath = Join-Path -Path $ControlsPath -ChildPath 'risk-severity.json'
    if (Test-Path -Path $severityPath) {
        $severityData = Get-Content -Path $severityPath -Raw | ConvertFrom-Json
        foreach ($prop in $severityData.checks.PSObject.Properties) {
            if ($lookup.ContainsKey($prop.Name)) {
                $lookup[$prop.Name].riskSeverity = $prop.Value
            }
        }
    }

    # Load learnMore overlay (local to M365-Assess, not in CheckID)
    $learnMorePath = Join-Path -Path $ControlsPath -ChildPath 'learn-more.json'
    if (Test-Path -Path $learnMorePath) {
        $learnMoreData = Get-Content -Path $learnMorePath -Raw | ConvertFrom-Json
        foreach ($prop in $learnMoreData.checks.PSObject.Properties) {
            if ($lookup.ContainsKey($prop.Name)) {
                $lookup[$prop.Name].learnMore = $prop.Value
            }
        }
    }

    return $lookup
}
