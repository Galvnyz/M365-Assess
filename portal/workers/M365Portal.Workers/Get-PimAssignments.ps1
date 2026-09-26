# Get-PimAssignments.ps1 — EPIC-013 PIM assignments & P2 gate (SPEC §3.1, §9, §11.4; T-0242).
#
# Reads PIM eligible and active role assignments from Graph.
# When Entra ID P2 is unavailable, returns a structured gate payload (license-missing)
# rather than throwing an error. Worker is strictly read-only: only GET is called.

function Read-PimAssignmentsJob {
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

function ConvertTo-PimCursor {
    param([int]$Offset)
    if ($Offset -le 0) { return '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("pim_offset:$Offset")
    return [System.Convert]::ToBase64String($bytes)
}

function ConvertFrom-PimCursor {
    param([string]$Cursor)
    if ([string]::IsNullOrWhiteSpace($Cursor)) { return 0 }
    try {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Cursor))
        if ($decoded -match '^pim_offset:(\d+)$') {
            return [int]$Matches[1]
        }
        return 0
    }
    catch {
        return 0
    }
}

function Test-PimAssignmentFilter {
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

function Get-PimAssignments {
    <#
    .SYNOPSIS
        Queries PIM eligible and active role assignments or returns license gate when P2 is missing.
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
        [ValidateSet('', 'eligible', 'active')]
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

    # 1. Fetch role definitions
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
        # Fall back if role definitions fail
    }

    $rawEligible = [System.Collections.Generic.List[object]]::new()
    $rawActive = [System.Collections.Generic.List[object]]::new()
    $p2Unavailable = $false

    # 2. Query PIM eligibility schedule instances
    try {
        $uriEligible = '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$expand=principal,roleDefinition&$top=999'
        do {
            try {
                $resp = Invoke-MgGraphRequest -Method GET -Uri $uriEligible
            }
            catch {
                if ($uriEligible -match '\$expand') {
                    $uriEligible = '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$top=999'
                    $resp = Invoke-MgGraphRequest -Method GET -Uri $uriEligible
                }
                else {
                    throw
                }
            }
            foreach ($item in @($resp.value)) {
                if ($null -ne $item) {
                    $rawEligible.Add($item)
                }
            }
            $uriEligible = $resp.'@odata.nextLink'
        } while ($uriEligible)
    }
    catch {
        $errStr = $_.ToString()
        if ($errStr -match 'P2|P1|license|NotSupported|Denied|Forbidden|403|404|RoleManagementPolicy') {
            $p2Unavailable = $true
        } else {
            throw
        }
    }

    # 3. Query PIM active assignment schedule instances if P2 not marked unavailable
    if (-not $p2Unavailable) {
        try {
            $uriActive = '/v1.0/roleManagement/directory/roleAssignmentScheduleInstances?$expand=principal,roleDefinition&$top=999'
            do {
                try {
                    $resp = Invoke-MgGraphRequest -Method GET -Uri $uriActive
                }
                catch {
                    if ($uriActive -match '\$expand') {
                        $uriActive = '/v1.0/roleManagement/directory/roleAssignmentScheduleInstances?$top=999'
                        $resp = Invoke-MgGraphRequest -Method GET -Uri $uriActive
                    }
                    else {
                        throw
                    }
                }
                foreach ($item in @($resp.value)) {
                    if ($null -ne $item) {
                        $rawActive.Add($item)
                    }
                }
                $uriActive = $resp.'@odata.nextLink'
            } while ($uriActive)
        }
        catch {
            $errStr = $_.ToString()
            if ($errStr -match 'P2|P1|license|NotSupported|Denied|Forbidden|403|404|RoleManagementPolicy') {
                $p2Unavailable = $true
            } else {
                throw
            }
        }
    }

    if ($p2Unavailable) {
        return [pscustomobject]@{
            tenantId   = $TenantId
            gate       = [pscustomobject]@{
                supported       = $false
                status          = 'license-missing'
                requiredLicense = 'Entra ID P2'
                message         = 'Privileged Identity Management (PIM) requires Microsoft Entra ID P2 (or Microsoft 365 E5) licenses. Without Entra ID P2, eligible role assignments and just-in-time activations cannot be configured for this tenant.'
            }
            totalCount = 0
            items      = @()
            nextCursor = $null
        }
    }

    $rows = [System.Collections.Generic.List[object]]::new()

    # Process eligible assignments
    foreach ($item in $rawEligible) {
        $roleDefId = [string]$item.roleDefinitionId
        $roleName = if ($item.roleDefinition -and $item.roleDefinition.displayName) {
            [string]$item.roleDefinition.displayName
        } elseif ($roleDefMap.ContainsKey($roleDefId)) {
            [string]$roleDefMap[$roleDefId]
        } else {
            $roleDefId
        }

        $principalId = [string]$item.principalId
        $pName = if ($item.principal -and $item.principal.displayName) {
            [string]$item.principal.displayName
        } else {
            $principalId
        }
        $pEmail = if ($item.principal -and $item.principal.userPrincipalName) {
            [string]$item.principal.userPrincipalName
        } elseif ($item.principal -and $item.principal.mail) {
            [string]$item.principal.mail
        } else {
            $null
        }

        $pType = 'user'
        if ($item.principal -and $item.principal.'@odata.type') {
            $t = [string]$item.principal.'@odata.type'
            if ($t -match 'servicePrincipal') { $pType = 'servicePrincipal' }
            elseif ($t -match 'group') { $pType = 'group' }
        }

        $scopeVal = if ($item.directoryScopeId) { [string]$item.directoryScopeId } else { '/' }

        $row = [pscustomobject]@{
            id                   = [string]$item.id
            roleDefinitionId     = $roleDefId
            roleName             = $roleName
            principalId          = $principalId
            principalDisplayName = $pName
            principalEmail       = $pEmail
            principalType        = $pType
            assignmentType       = 'eligible'
            directoryScopeId     = $scopeVal
            scope                = $scopeVal
            startDateTime        = if ($item.startDateTime) { [string]$item.startDateTime } else { $null }
            endDateTime          = if ($item.endDateTime) { [string]$item.endDateTime } else { $null }
            status               = 'eligible'
        }

        if (Test-PimAssignmentFilter -Row $row -Role $Role -PrincipalType $PrincipalType -AssignmentType $AssignmentType -Scope $Scope -Search $Search) {
            $rows.Add($row)
        }
    }

    # Process active schedule assignments
    foreach ($item in $rawActive) {
        $roleDefId = [string]$item.roleDefinitionId
        $roleName = if ($item.roleDefinition -and $item.roleDefinition.displayName) {
            [string]$item.roleDefinition.displayName
        } elseif ($roleDefMap.ContainsKey($roleDefId)) {
            [string]$roleDefMap[$roleDefId]
        } else {
            $roleDefId
        }

        $principalId = [string]$item.principalId
        $pName = if ($item.principal -and $item.principal.displayName) {
            [string]$item.principal.displayName
        } else {
            $principalId
        }
        $pEmail = if ($item.principal -and $item.principal.userPrincipalName) {
            [string]$item.principal.userPrincipalName
        } elseif ($item.principal -and $item.principal.mail) {
            [string]$item.principal.mail
        } else {
            $null
        }

        $pType = 'user'
        if ($item.principal -and $item.principal.'@odata.type') {
            $t = [string]$item.principal.'@odata.type'
            if ($t -match 'servicePrincipal') { $pType = 'servicePrincipal' }
            elseif ($t -match 'group') { $pType = 'group' }
        }

        $scopeVal = if ($item.directoryScopeId) { [string]$item.directoryScopeId } else { '/' }

        $row = [pscustomobject]@{
            id                   = [string]$item.id
            roleDefinitionId     = $roleDefId
            roleName             = $roleName
            principalId          = $principalId
            principalDisplayName = $pName
            principalEmail       = $pEmail
            principalType        = $pType
            assignmentType       = 'active'
            directoryScopeId     = $scopeVal
            scope                = $scopeVal
            startDateTime        = if ($item.startDateTime) { [string]$item.startDateTime } else { $null }
            endDateTime          = if ($item.endDateTime) { [string]$item.endDateTime } else { $null }
            status               = 'active'
        }

        if (Test-PimAssignmentFilter -Row $row -Role $Role -PrincipalType $PrincipalType -AssignmentType $AssignmentType -Scope $Scope -Search $Search) {
            $rows.Add($row)
        }
    }

    # Pagination
    $offset = ConvertFrom-PimCursor -Cursor $Cursor
    $page = @($rows | Select-Object -Skip $offset -First $Top)
    $nextOffset = $offset + $page.Count
    $nextCursor = $null
    if ($nextOffset -lt $rows.Count) {
        $nextCursor = ConvertTo-PimCursor -Offset $nextOffset
    }

    return [pscustomobject]@{
        tenantId   = $TenantId
        gate       = [pscustomobject]@{
            supported       = $true
            status          = 'licensed'
            requiredLicense = 'Entra ID P2'
            message         = $null
        }
        totalCount = $rows.Count
        items      = @($page)
        nextCursor = $nextCursor
    }
}
