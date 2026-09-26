# Get-IntunePolicies.ps1 — EPIC-016 Intune policy list worker (SPEC §3.1, §6; T-0301).
#
# Read-only. Issues only GET requests via Invoke-MgGraphRequest.
# Supports kind: "configuration" (deviceManagement/configurationPolicies) and
#                "compliance"    (deviceManagement/deviceCompliancePolicies)
# Other kinds are rejected with a structured error.
#
# The worker rehydrates the EPIC-001 RunContext from a job envelope JSON file,
# calls Graph, and returns a paged result.

function Read-IntunePoliciesJob {
    <#
    .SYNOPSIS
        Parses a job envelope JSON for Get-IntunePolicies.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $raw  = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json

    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }

    if (-not $json.kind) {
        throw "job envelope '$Path' is missing mandatory 'kind'"
    }

    $validKinds = @('configuration', 'compliance', 'app-protection')
    if ($validKinds -notcontains $json.kind) {
        throw "job envelope '$Path' has unknown kind '$($json.kind)'; valid: $($validKinds -join ', ')"
    }

    return @{
        TenantId     = [string]$json.tenantId
        Kind         = [string]$json.kind
        Platform     = if ($json.platform) { [string]$json.platform } else { '' }
        PolicyType   = if ($json.policyType) { [string]$json.policyType } else { '' }
        Search       = if ($json.search) { [string]$json.search } else { '' }
        ModifiedDate = if ($json.modifiedDate) { [string]$json.modifiedDate } else { '' }
        Top          = if ($json.top) { [int]$json.top } else { 100 }
        SkipToken    = if ($json.skipToken) { [string]$json.skipToken } else { '' }
    }
}

# Map policy kind to Graph resource and supported platforms.
$script:KindRegistry = @{
    'configuration' = @{
        GraphResource = 'v1.0/deviceManagement/configurationPolicies'
        Supported     = $true
    }
    'compliance' = @{
        GraphResource = 'v1.0/deviceManagement/deviceCompliancePolicies'
        Supported     = $true
    }
    'app-protection' = @{
        GraphResource = $null
        Supported     = $false
    }
}

function ConvertTo-IntunePolicyRow {
    <#
    .SYNOPSIS
        Normalises a Graph policy object into the portal row shape.
    #>
    param(
        [object]$Policy,
        [string]$Kind
    )

    $policyId          = if ($Policy.id) { [string]$Policy.id } else { '' }
    $displayName       = if ($Policy.name) { [string]$Policy.name }
                         elseif ($Policy.displayName) { [string]$Policy.displayName }
                         else { '' }
    $lastModified      = if ($Policy.lastModifiedDateTime) { [string]$Policy.lastModifiedDateTime }
                         elseif ($Policy.modifiedDateTime) { [string]$Policy.modifiedDateTime }
                         else { $null }
    $modifiedBy        = if ($Policy.createdBy -and $Policy.createdBy.userPrincipalName) {
                             [string]$Policy.createdBy.userPrincipalName
                         } elseif ($Policy.lastModifiedBy -and $Policy.lastModifiedBy.userPrincipalName) {
                             [string]$Policy.lastModifiedBy.userPrincipalName
                         } else { $null }

    # Platform
    $platform = 'windows'
    if ($Policy.platforms) { $platform = [string]$Policy.platforms }
    elseif ($Policy.platform) { $platform = [string]$Policy.platform }

    # Policy type label
    $policyType = 'Configuration Policy'
    if ($Kind -eq 'compliance') { $policyType = 'Compliance Policy' }

    # Assignments — may already be expanded or may need separate call.
    # Worker treats assignments as an array if present on the object.
    $assignments     = @()
    $assignedToCount = 0
    if ($Policy.assignments -and $Policy.assignments.Count -gt 0) {
        foreach ($a in $Policy.assignments) {
            $targetType = if ($a.target -and $a.target.'@odata.type') {
                [string]$a.target.'@odata.type' -replace '#microsoft.graph.', ''
            } else { 'unknown' }
            $targetName = if ($a.target -and $a.target.groupId) {
                "GroupId:$($a.target.groupId)"
            } elseif ($a.target -and $a.target.'@odata.type' -like '*allDevices*') {
                'All Devices'
            } elseif ($a.target -and $a.target.'@odata.type' -like '*allLicensed*') {
                'All Users'
            } else { $targetType }

            $assignments += @{
                id         = if ($a.id) { [string]$a.id } else { '' }
                target     = $targetName
                targetType = $targetType
            }
        }
        $assignedToCount = $assignments.Count
    }

    return @{
        id                   = $policyId
        name                 = $displayName
        displayName          = $displayName
        platform             = $platform
        policyType           = $policyType
        assignedToCount      = $assignedToCount
        assignments          = $assignments
        lastModifiedDateTime = $lastModified
        modifiedBy           = $modifiedBy
    }
}

function Get-IntunePolicies {
    <#
    .SYNOPSIS
        Lists Intune policies for a tenant by kind.
    .PARAMETER TenantId
        Tenant GUID or domain.
    .PARAMETER Kind
        Policy kind: 'configuration', 'compliance', or 'app-protection'.
    .PARAMETER Top
        Maximum number of policies to return (default 100).
    .PARAMETER Search
        Optional display-name substring filter (applied client-side).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('configuration', 'compliance', 'app-protection')]
        [string]$Kind,

        [int]$Top = 100,

        [string]$Search = ''
    )

    $entry = $script:KindRegistry[$Kind]
    if (-not $entry) {
        return @{
            error      = 'intune.kind.unknown'
            message    = "Unknown Intune policy kind '$Kind'"
            statusCode = 400
        }
    }

    if (-not $entry.Supported) {
        return @{
            error      = 'intune.kind.unsupported'
            message    = "Intune policy kind '$Kind' is not yet supported in v1"
            statusCode = 501
        }
    }

    $resource = $entry.GraphResource
    $uri      = "/$resource`?`$top=$Top&`$expand=assignments"

    $response = Invoke-MgGraphRequest -Method GET -Uri $uri
    $rawItems = if ($response.value) { @($response.value) } else { @() }

    # Client-side search filter
    if (-not [string]::IsNullOrWhiteSpace($Search)) {
        $rawItems = $rawItems | Where-Object {
            $name = if ($_.name) { $_.name } elseif ($_.displayName) { $_.displayName } else { '' }
            $name -like "*$Search*"
        }
    }

    $rows = @()
    foreach ($item in $rawItems) {
        $rows += ConvertTo-IntunePolicyRow -Policy $item -Kind $Kind
    }

    return @{
        tenantId    = $TenantId
        kind        = $Kind
        totalCount  = $rows.Count
        items       = $rows
        nextCursor  = $null
    }
}
