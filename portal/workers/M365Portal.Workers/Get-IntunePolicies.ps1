# Get-IntunePolicies.ps1 - EPIC-016 Intune policy list worker (SPEC section 3.1, section 6; T-0301).
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
        # 'true' / 'false' / '' (no filter); the BFF sends a boolean.
        Assigned     = if ($null -ne $json.assigned) { ([string]$json.assigned).ToLowerInvariant() } else { '' }
        # Set for a single-policy detail read (compare, T-0820) instead of a list.
        PolicyId     = if ($json.policyId) { [string]$json.policyId } else { '' }
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

    # Assignments - may already be expanded or may need separate call.
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

function Get-IntunePolicyDetail {
    <#
    .SYNOPSIS
        Reads one policy with its full configuration and assignments.
    .DESCRIPTION
        Returns the policy body (Graph properties minus identity/metadata fields, plus the
        settings-catalog `settings` for configuration policies) and its raw Graph
        assignments, for structural compare (T-0310/T-0820). Returns $null when the
        policy does not exist.
    .PARAMETER Kind
        configuration or compliance.
    .PARAMETER PolicyId
        The policy id.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('configuration', 'compliance')]
        [string]$Kind,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$PolicyId
    )

    $resource = $script:KindRegistry[$Kind].GraphResource
    $expand = if ($Kind -eq 'configuration') { 'settings,assignments' } else { 'assignments' }
    try {
        $policy = Invoke-MgGraphRequest -Method GET -Uri "/$resource/$([uri]::EscapeDataString($PolicyId))?`$expand=$expand"
    }
    catch {
        if ($_.Exception.Message -match '404|NotFound|ResourceNotFound') { return $null }
        throw
    }
    if ($null -eq $policy) { return $null }

    $row = ConvertTo-IntunePolicyRow -Policy $policy -Kind $Kind
    $skip = @('id', 'assignments', 'createdDateTime', 'lastModifiedDateTime', 'modifiedDateTime', 'version', '@odata.context', 'settings@odata.context', 'assignments@odata.context')
    $body = @{}
    $keys = if ($policy -is [System.Collections.IDictionary]) { $policy.Keys } else { $policy.PSObject.Properties.Name }
    foreach ($key in $keys) {
        if ($skip -notcontains $key) { $body[[string]$key] = $policy.$key }
    }
    return @{
        id          = $row.id
        displayName = $row.displayName
        platform    = $row.platform
        body        = $body
        assignments = @($policy.assignments)
    }
}

function Select-IntunePolicyRow {
    <#
    .SYNOPSIS
        Applies the SPEC section 3.1 list filters to converted policy rows.
    .DESCRIPTION
        Platform matches by prefix so 'windows' covers 'windows10'; policyType matches
        exactly; assigned compares assignedToCount with zero; modifiedDate keeps rows
        modified on or after that day; search is a case-insensitive name substring.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [object[]]$Row = @(),
        [string]$Platform = '',
        [string]$PolicyType = '',
        [ValidateSet('', 'true', 'false')]
        [string]$Assigned = '',
        [string]$ModifiedDate = '',
        [string]$Search = ''
    )

    $since = $null
    if ($ModifiedDate) {
        $parsed = [datetime]::MinValue
        $styles = [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
        if (-not [datetime]::TryParse($ModifiedDate, [cultureinfo]::InvariantCulture, $styles, [ref]$parsed)) {
            throw "modifiedDate '$ModifiedDate' is not a valid date"
        }
        $since = $parsed.Date
    }

    $selected = foreach ($r in $Row) {
        if ($Platform -and -not ([string]$r.platform).StartsWith($Platform, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($PolicyType -and -not ([string]$r.policyType).Equals($PolicyType, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($Assigned -eq 'true' -and [int]$r.assignedToCount -le 0) { continue }
        if ($Assigned -eq 'false' -and [int]$r.assignedToCount -gt 0) { continue }
        if ($since) {
            $modified = [datetime]::MinValue
            $styles = [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
            if (-not $r.lastModifiedDateTime -or -not [datetime]::TryParse([string]$r.lastModifiedDateTime, [cultureinfo]::InvariantCulture, $styles, [ref]$modified)) { continue }
            if ($modified -lt $since) { continue }
        }
        if ($Search -and ([string]$r.displayName).IndexOf($Search, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        $r
    }
    return @($selected)
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
        Page size (default 100). Paging applies after filtering.
    .PARAMETER Cursor
        Offset cursor from a previous page's nextCursor.
    .PARAMETER Search
        Optional display-name substring filter.
    .PARAMETER Platform
        Optional platform prefix filter (windows, android, ios, macos).
    .PARAMETER PolicyType
        Optional policy type label filter, e.g. 'Compliance Policy'.
    .PARAMETER Assigned
        'true' for assigned policies only, 'false' for unassigned only.
    .PARAMETER ModifiedDate
        Optional date; keeps policies modified on or after it.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('configuration', 'compliance', 'app-protection')]
        [string]$Kind,

        [int]$Top = 100,

        [string]$Cursor = '',

        [string]$Search = '',

        [string]$Platform = '',

        [string]$PolicyType = '',

        [ValidateSet('', 'true', 'false')]
        [string]$Assigned = '',

        [string]$ModifiedDate = ''
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

    # Read every Graph page: filters apply to the whole set, so paging must come after them.
    $uri = "/$($entry.GraphResource)?`$expand=assignments"
    $rawItems = [System.Collections.Generic.List[object]]::new()
    while ($uri) {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        $page = if ($response -is [System.Collections.IDictionary]) { $response['value'] } else { $response.value }
        foreach ($item in @($page)) { if ($null -ne $item) { $rawItems.Add($item) } }
        $uri = if ($response -is [System.Collections.IDictionary]) { $response['@odata.nextLink'] } else { $response.'@odata.nextLink' }
    }

    $rows = @(foreach ($item in $rawItems) { ConvertTo-IntunePolicyRow -Policy $item -Kind $Kind })
    $filterParams = @{
        Row          = $rows
        Platform     = $Platform
        PolicyType   = $PolicyType
        Assigned     = $Assigned
        ModifiedDate = $ModifiedDate
        Search       = $Search
    }
    $filtered = @(Select-IntunePolicyRow @filterParams)

    $offset = 0
    if ($Cursor -and -not [int]::TryParse($Cursor, [ref]$offset)) {
        throw "cursor '$Cursor' is not valid"
    }
    $pageSize = [Math]::Max(1, $Top)
    $pageItems = @($filtered | Select-Object -Skip $offset -First $pageSize)
    $next = if ($offset + $pageSize -lt $filtered.Count) { [string]($offset + $pageSize) } else { $null }

    return @{
        tenantId    = $TenantId
        kind        = $Kind
        totalCount  = $filtered.Count
        items       = $pageItems
        nextCursor  = $next
    }
}
