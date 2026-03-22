<#
.SYNOPSIS
    Loads the control registry and builds lookup tables for the report layer.
.DESCRIPTION
    Loads check data from the local controls/registry.json file (synced from
    CheckID via CI). Returns a hashtable keyed by CheckId with framework
    mappings and risk severity.

    Also builds a reverse lookup from CIS control IDs to CheckIds (stored
    under the special key '__cisReverseLookup') for backward compatibility
    with CSVs that still use the CisControl column.
.PARAMETER ControlsPath
    Path to the controls/ directory containing registry.json and
    risk-severity.json (local overlay).
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
    Write-Verbose "Loaded $($checks.Count) checks from local registry.json"

    # Build hashtable keyed by CheckId
    $lookup = @{}
    $cisReverse = @{}

    foreach ($check in $checks) {
        $entry = @{
            checkId           = $check.checkId
            name              = $check.name
            category          = $check.category
            collector         = $check.collector
            hasAutomatedCheck = $check.hasAutomatedCheck
            licensing         = $check.licensing
            frameworks        = @{}
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

    return $lookup
}
