# Invoke-GroupMembershipBulk.ps1 — EPIC-014 Bulk membership and owners (SPEC §3.3, §4.3, §6, §8; T-0268).
#
# Supports preview diff without writing, batch apply, per-row results (added, removed, skipped, failed),
# and per-change audit records.
# Shares handler for both 'members' and 'owners'.

function Read-GroupMembershipBulkJob {
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
    if (-not $json.groupId) {
        throw "job envelope '$Path' is missing mandatory 'groupId'"
    }

    $users = @()
    if ($json.users) {
        $users = @($json.users)
    }

    return @{
        TenantId  = [string]$json.tenantId
        GroupId   = [string]$json.groupId
        Role      = if ($json.role) { [string]$json.role } else { 'members' }
        Operation = if ($json.operation) { [string]$json.operation } else { 'add' }
        Users     = $users
        DryRun    = [bool]($json.dryRun -eq $true)
    }
}

function Invoke-GroupMembershipBulk {
    <#
    .SYNOPSIS
        Performs bulk add/remove of members or owners with preview diff and per-row results.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$GroupId,

        [Parameter()]
        [ValidateSet('members', 'owners')]
        [string]$Role = 'members',

        [Parameter(Mandatory)]
        [ValidateSet('add', 'remove')]
        [string]$Operation,

        [Parameter(Mandatory)]
        [array]$Users,

        [Parameter()]
        [bool]$DryRun = $false
    )

    # 1. Fetch existing group members or owners
    $existing = [System.Collections.Generic.List[object]]::new()
    try {
        $uri = "/v1.0/groups/$GroupId/${Role}?`$select=id,userPrincipalName,displayName&`$top=999"
        do {
            $resp = Invoke-MgGraphRequest -Method GET -Uri $uri
            if ($resp -and $resp.value) {
                foreach ($item in @($resp.value)) {
                    $existing.Add($item)
                }
            }
            $uri = if ($resp.'@odata.nextLink') { $resp.'@odata.nextLink' } else { $null }
        } while ($uri)
    }
    catch {
        throw "Failed to fetch existing $Role for group '$GroupId': $_"
    }

    $existingIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $existingUpns = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $idByUpn = @{}

    foreach ($item in $existing) {
        if ($item.id) {
            $null = $existingIds.Add($item.id)
        }
        if ($item.userPrincipalName) {
            $null = $existingUpns.Add($item.userPrincipalName)
            $idByUpn[$item.userPrincipalName.ToLowerInvariant()] = $item.id
        }
    }

    $diff = [System.Collections.Generic.List[string]]::new()
    $plannedRows = [System.Collections.Generic.List[object]]::new()

    foreach ($userRef in $Users) {
        $userStr = [string]$userRef
        $isExisting = $existingIds.Contains($userStr) -or $existingUpns.Contains($userStr)

        if ($Operation -eq 'add') {
            if ($isExisting) {
                $plannedRows.Add([pscustomobject]@{
                    user   = $userStr
                    action = 'skip'
                    reason = "Already in $Role"
                })
            }
            else {
                $diff.Add("Add $userStr to $Role")
                $plannedRows.Add([pscustomobject]@{
                    user   = $userStr
                    action = 'add'
                    reason = "Will add to $Role"
                })
            }
        }
        elseif ($Operation -eq 'remove') {
            if ($isExisting) {
                $diff.Add("Remove $userStr from $Role")
                $plannedRows.Add([pscustomobject]@{
                    user   = $userStr
                    action = 'remove'
                    reason = "Will remove from $Role"
                })
            }
            else {
                $plannedRows.Add([pscustomobject]@{
                    user   = $userStr
                    action = 'skip'
                    reason = "Not in $Role"
                })
            }
        }
    }

    $previewPlan = [pscustomobject]@{
        tenantId  = $TenantId
        groupId   = $GroupId
        role      = $Role
        operation = $Operation
        total     = $Users.Count
        toAdd     = @($plannedRows | Where-Object { $_.action -eq 'add' }).Count
        toRemove  = @($plannedRows | Where-Object { $_.action -eq 'remove' }).Count
        toSkip    = @($plannedRows | Where-Object { $_.action -eq 'skip' }).Count
        diff      = @($diff)
        planRows  = @($plannedRows)
        dryRun    = $DryRun
    }

    if ($DryRun) {
        return $previewPlan
    }

    # Apply changes live with per-row results and per-change audit records
    $results = [System.Collections.Generic.List[object]]::new()
    $auditEvents = [System.Collections.Generic.List[object]]::new()
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    foreach ($planRow in $plannedRows) {
        $u = $planRow.user
        if ($planRow.action -eq 'skip') {
            $results.Add([pscustomobject]@{
                user   = $u
                status = 'skipped'
                reason = $planRow.reason
            })
            continue
        }

        # Resolve user ID (if upn was given, or use directly)
        $userId = $u
        if ($idByUpn.ContainsKey($u.ToLowerInvariant())) {
            $userId = $idByUpn[$u.ToLowerInvariant()]
        }

        if ($planRow.action -eq 'add') {
            try {
                $body = @{
                    "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$userId"
                }
                Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups/$GroupId/$Role/`$ref" -Body ($body | ConvertTo-Json)
                $results.Add([pscustomobject]@{
                    user   = $u
                    status = 'added'
                })
                $auditEvents.Add([pscustomobject]@{
                    id         = [guid]::NewGuid().ToString()
                    tenantId   = $TenantId
                    action     = "group.$Role.add"
                    targetId   = $GroupId
                    principalId = $userId
                    timestamp  = $now
                })
            }
            catch {
                $results.Add([pscustomobject]@{
                    user   = $u
                    status = 'failed'
                    error  = $_.ToString()
                })
            }
        }
        elseif ($planRow.action -eq 'remove') {
            try {
                Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/groups/$GroupId/$Role/$userId/`$ref"
                $results.Add([pscustomobject]@{
                    user   = $u
                    status = 'removed'
                })
                $auditEvents.Add([pscustomobject]@{
                    id         = [guid]::NewGuid().ToString()
                    tenantId   = $TenantId
                    action     = "group.$Role.remove"
                    targetId   = $GroupId
                    principalId = $userId
                    timestamp  = $now
                })
            }
            catch {
                $results.Add([pscustomobject]@{
                    user   = $u
                    status = 'failed'
                    error  = $_.ToString()
                })
            }
        }
    }

    return [pscustomobject]@{
        plan        = $previewPlan
        results     = @($results)
        auditEvents = @($auditEvents)
        success     = $true
    }
}
