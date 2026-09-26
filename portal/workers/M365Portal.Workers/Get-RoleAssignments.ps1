# Get-RoleAssignments.ps1 — EPIC-013 directory role assignments read (SPEC §3.1, §4.1, §6).
#
# Reads directory role assignments from Graph, maps principal, role, assignment type
# (permanent, eligible, active), scope, start, end, and status with filters and cursor pagination.
# The worker is read-only: only GET requests are issued.

function Read-RoleAssignmentsJob {
    <#
    .SYNOPSIS
        Parses a job envelope JSON for Get-RoleAssignments.
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

    $raw = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }

    $result = @{
        TenantId       = [string]$json.tenantId
        Role           = if ($json.role) { [string]$json.role } else { '' }
        PrincipalType  = if ($json.principalType) { [string]$json.principalType } else { '' }
        AssignmentType = if ($json.assignmentType) { [string]$json.assignmentType } else { '' }
        Scope          = if ($json.scope) { [string]$json.scope } else { '' }
        Search         = if ($json.search) { [string]$json.search } else { '' }
        Top            = if ($json.top) { [int]$json.top } else { 100 }
        Cursor         = if ($json.cursor) { [string]$json.cursor } else { '' }
    }
    return $result
}

function ConvertTo-RoleAssignmentsCursor {
    param([int]$Offset)
    if ($Offset -le 0) { return '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("offset:$Offset")
    return [System.Convert]::ToBase64String($bytes)
}

function ConvertFrom-RoleAssignmentsCursor {
    param([string]$Cursor)
    if ([string]::IsNullOrWhiteSpace($Cursor)) { return 0 }
    try {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Cursor))
        if ($decoded -match '^offset:(\d+)$') {
            return [int]$Matches[1]
        }
        return 0
    }
    catch {
        return 0
    }
}

function Test-RoleAssignmentFilter {
    param(
        [pscustomobject]$Row,
        [string]$Role,
        [string]$PrincipalType,
        [string]$AssignmentType,
        [string]$Scope,
        [string]$Search
    )

    if (-not [string]::IsNullOrWhiteSpace($Role)) {
        $roleMatch = ($Row.roleName -and $Row.roleName -like "*$Role*") -or
                     ($Row.roleDefinitionId -and $Row.roleDefinitionId -eq $Role)
        if (-not $roleMatch) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($PrincipalType)) {
        if ($Row.principalType -ne $PrincipalType) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($AssignmentType)) {
        if ($Row.assignmentType -ne $AssignmentType) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($Scope)) {
        if ($Row.directoryScopeId -ne $Scope -and $Row.scope -ne $Scope) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($Search)) {
        $s = $Search.ToLowerInvariant()
        $matched = ($Row.roleName -and $Row.roleName.ToLowerInvariant().Contains($s)) -or
                   ($Row.principalDisplayName -and $Row.principalDisplayName.ToLowerInvariant().Contains($s)) -or
                   ($Row.principalEmail -and $Row.principalEmail.ToLowerInvariant().Contains($s))
        if (-not $matched) { return $false }
    }

    return $true
}

function Get-RoleAssignments {
    <#
    .SYNOPSIS
        Queries directory role assignments and optional PIM schedules from Microsoft Graph.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [string]$Role = '',

        [Parameter()]
        [ValidateSet('', 'user', 'group', 'servicePrincipal')]
        [string]$PrincipalType = '',

        [Parameter()]
        [ValidateSet('', 'permanent', 'eligible', 'active')]
        [string]$AssignmentType = '',

        [Parameter()]
        [string]$Scope = '',

        [Parameter()]
        [string]$Search = '',

        [Parameter()]
        [ValidateRange(1, 1000)]
        [int]$Top = 100,

        [Parameter()]
        [string]$Cursor = ''
    )

    # 1. Fetch role definitions to resolve IDs to display names
    $roleDefMap = @{}
    try {
        $uriDefs = '/v1.0/roleManagement/directory/roleDefinitions?$top=999'
        do {
            $defResp = Invoke-MgGraphRequest -Method GET -Uri $uriDefs
            foreach ($def in @($defResp.value)) {
                if ($def.id) {
                    $roleDefMap[$def.id] = $def.displayName
                }
            }
            $uriDefs = $defResp.'@odata.nextLink'
        } while ($uriDefs)
    }
    catch {
        # Fall back gracefully if role definitions fail
    }

    # 2. Fetch standard directory role assignments
    $rawAssignments = [System.Collections.Generic.List[object]]::new()
    try {
        $uriAssignments = '/v1.0/roleManagement/directory/roleAssignments?$expand=principal,roleDefinition&$top=999'
        do {
            try {
                $assignResp = Invoke-MgGraphRequest -Method GET -Uri $uriAssignments
            }
            catch {
                if ($uriAssignments -match '\$expand') {
                    # Retry without expand if expand is not supported
                    $uriAssignments = '/v1.0/roleManagement/directory/roleAssignments?$top=999'
                    $assignResp = Invoke-MgGraphRequest -Method GET -Uri $uriAssignments
                }
                else {
                    throw
                }
            }
            foreach ($item in @($assignResp.value)) {
                if ($null -ne $item) {
                    $rawAssignments.Add($item)
                }
            }
            $uriAssignments = $assignResp.'@odata.nextLink'
        } while ($uriAssignments)
    }
    catch {
        # Log or throw depending on failure
        throw
    }

    # 3. Attempt to fetch PIM role eligibility schedules and active assignments if P2 is available
    $pimEligible = [System.Collections.Generic.List[object]]::new()
    try {
        $pimUri = '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$expand=principal,roleDefinition&$top=999'
        $pimResp = Invoke-MgGraphRequest -Method GET -Uri $pimUri
        foreach ($p in @($pimResp.value)) {
            if ($null -ne $p) {
                $pimEligible.Add($p)
            }
        }
    }
    catch {
        # PIM / P2 may not be licensed or available; ignore gracefully
    }

    # 4. Map to standard output rows
    $rows = [System.Collections.Generic.List[object]]::new()
    $seenKeys = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($assign in $rawAssignments) {
        $roleDefId = [string]$assign.roleDefinitionId
        $roleName = if ($assign.roleDefinition -and $assign.roleDefinition.displayName) {
            [string]$assign.roleDefinition.displayName
        } elseif ($roleDefMap.ContainsKey($roleDefId)) {
            [string]$roleDefMap[$roleDefId]
        } else {
            $roleDefId
        }

        $principalId = [string]$assign.principalId
        $pName = if ($assign.principal -and $assign.principal.displayName) {
            [string]$assign.principal.displayName
        } else {
            $principalId
        }
        $pEmail = if ($assign.principal -and $assign.principal.userPrincipalName) {
            [string]$assign.principal.userPrincipalName
        } elseif ($assign.principal -and $assign.principal.mail) {
            [string]$assign.principal.mail
        } else {
            $null
        }

        $pType = 'user'
        if ($assign.principal -and $assign.principal.'@odata.type') {
            $t = [string]$assign.principal.'@odata.type'
            if ($t -match 'servicePrincipal') { $pType = 'servicePrincipal' }
            elseif ($t -match 'group') { $pType = 'group' }
        }

        $scopeVal = if ($assign.directoryScopeId) { [string]$assign.directoryScopeId } else { '/' }
        $assignKey = "$principalId|$roleDefId|$scopeVal"
        $seenKeys.Add($assignKey) | Out-Null

        $row = [pscustomobject]@{
            id                   = [string]$assign.id
            roleDefinitionId     = $roleDefId
            roleName             = $roleName
            principalId          = $principalId
            principalDisplayName = $pName
            principalEmail       = $pEmail
            principalType        = $pType
            assignmentType       = 'permanent'
            directoryScopeId     = $scopeVal
            scope                = $scopeVal
            startDateTime        = $null
            endDateTime          = $null
            status               = 'active'
        }

        if (Test-RoleAssignmentFilter -Row $row -Role $Role -PrincipalType $PrincipalType -AssignmentType $AssignmentType -Scope $Scope -Search $Search) {
            $rows.Add($row)
        }
    }

    # Add PIM eligible rows
    foreach ($p in $pimEligible) {
        $roleDefId = [string]$p.roleDefinitionId
        $roleName = if ($p.roleDefinition -and $p.roleDefinition.displayName) {
            [string]$p.roleDefinition.displayName
        } elseif ($roleDefMap.ContainsKey($roleDefId)) {
            [string]$roleDefMap[$roleDefId]
        } else {
            $roleDefId
        }

        $principalId = [string]$p.principalId
        $pName = if ($p.principal -and $p.principal.displayName) {
            [string]$p.principal.displayName
        } else {
            $principalId
        }
        $pEmail = if ($p.principal -and $p.principal.userPrincipalName) {
            [string]$p.principal.userPrincipalName
        } else {
            $null
        }

        $pType = 'user'
        if ($p.principal -and $p.principal.'@odata.type') {
            $t = [string]$p.principal.'@odata.type'
            if ($t -match 'servicePrincipal') { $pType = 'servicePrincipal' }
            elseif ($t -match 'group') { $pType = 'group' }
        }

        $scopeVal = if ($p.directoryScopeId) { [string]$p.directoryScopeId } else { '/' }
        $assignKey = "pim|$principalId|$roleDefId|$scopeVal"
        if (-not $seenKeys.Add($assignKey)) {
            continue
        }

        $start = if ($p.startDateTime) { [string]$p.startDateTime } else { $null }
        $end = if ($p.endDateTime) { [string]$p.endDateTime } else { $null }

        $row = [pscustomobject]@{
            id                   = [string]$p.id
            roleDefinitionId     = $roleDefId
            roleName             = $roleName
            principalId          = $principalId
            principalDisplayName = $pName
            principalEmail       = $pEmail
            principalType        = $pType
            assignmentType       = 'eligible'
            directoryScopeId     = $scopeVal
            scope                = $scopeVal
            startDateTime        = $start
            endDateTime          = $end
            status               = 'eligible'
        }

        if (Test-RoleAssignmentFilter -Row $row -Role $Role -PrincipalType $PrincipalType -AssignmentType $AssignmentType -Scope $Scope -Search $Search) {
            $rows.Add($row)
        }
    }

    # Pagination
    $offset = ConvertFrom-RoleAssignmentsCursor -Cursor $Cursor
    $page = @($rows | Select-Object -Skip $offset -First $Top)
    $nextOffset = $offset + $page.Count
    $nextCursor = $null
    if ($nextOffset -lt $rows.Count) {
        $nextCursor = ConvertTo-RoleAssignmentsCursor -Offset $nextOffset
    }

    return [pscustomobject]@{
        tenantId   = $TenantId
        totalCount = $rows.Count
        items      = @($page)
        nextCursor = $nextCursor
    }
}
