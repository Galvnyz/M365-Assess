# New-JitGrant.ps1 — EPIC-013 JIT admin grants (SPEC §3.4, §4.4, §5, §11.2; T-0246).
#
# Grants bounded, expiring eligible or active role assignments for JIT admin.
# Revoke ends the grant early; extend adjusts the window within maximum duration.
# Advisory first: JIT never removes or mutates an unrelated permanent role assignment.

function ConvertTo-JitIsoTime {
    <#
    .SYNOPSIS
        Returns a job time as a UTC ISO 8601 string. ConvertFrom-Json turns ISO
        strings into DateTime values, which [string] would render in local format.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value -or [string]$Value -eq '') {
        return ''
    }
    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    return [string]$Value
}

function Read-NewJitGrantJob {
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
    if (-not $json.userId) {
        throw "job envelope '$Path' is missing mandatory 'userId'"
    }
    if (-not $json.roleId) {
        throw "job envelope '$Path' is missing mandatory 'roleId'"
    }

    return @{
        TenantId         = [string]$json.tenantId
        UserId           = [string]$json.userId
        RoleId           = [string]$json.roleId
        Action           = if ($json.action) { [string]$json.action } else { 'grant' }
        AssignmentType   = if ($json.assignmentType) { [string]$json.assignmentType } else { 'eligible' }
        DurationHours    = if ($json.durationHours) { [int]$json.durationHours } else { 8 }
        MaxDurationHours = if ($json.maxDurationHours) { [int]$json.maxDurationHours } else { 24 }
        Justification    = if ($json.justification) { [string]$json.justification } else { 'JIT admin grant' }
        GrantId          = if ($json.grantId) { [string]$json.grantId } else { '' }
        AdditionalHours  = if ($json.additionalHours) { [int]$json.additionalHours } else { 4 }
        NewEndsAt        = ConvertTo-JitIsoTime -Value $json.newEndsAt
    }
}

function New-JitGrant {
    <#
    .SYNOPSIS
        Creates a bounded eligible or active role assignment for JIT admin.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RoleId,

        [Parameter()]
        [ValidateSet('eligible', 'active')]
        [string]$AssignmentType = 'eligible',

        [Parameter()]
        [ValidateRange(1, 72)]
        [int]$DurationHours = 8,

        [Parameter()]
        [ValidateRange(1, 48)]
        [int]$MaxDurationHours = 24,

        [Parameter()]
        [string]$Justification = 'JIT Admin Grant'
    )

    if ($DurationHours -gt $MaxDurationHours) {
        throw "requested duration ($DurationHours hours) exceeds maximum allowed duration ($MaxDurationHours hours)"
    }

    $startTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $endTime = (Get-Date).AddHours($DurationHours).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

    $graphAction = if ($AssignmentType -eq 'active') { 'AdminAssign' } else { 'AdminAssign' }

    $body = @{
        action           = $graphAction
        principalId      = $UserId
        roleDefinitionId = $RoleId
        directoryScopeId = '/'
        justification    = $Justification
        scheduleInfo     = @{
            startDateTime = $startTime
            expiration    = @{
                type     = 'AfterDuration'
                duration = "PT${DurationHours}H"
            }
        }
    }

    $uri = if ($AssignmentType -eq 'active') {
        "/v1.0/roleManagement/directory/roleAssignmentScheduleRequests"
    } else {
        "/v1.0/roleManagement/directory/roleEligibilityScheduleRequests"
    }

    $resp = Invoke-MgGraphRequest -Method POST -Uri $uri -Body ($body | ConvertTo-Json -Depth 5)

    $grantId = if ($resp -and $resp.id) { [string]$resp.id } else { [System.Guid]::NewGuid().ToString() }

    return [pscustomobject]@{
        id               = $grantId
        tenantId         = $TenantId
        userId           = $UserId
        roleId           = $RoleId
        assignmentType   = $AssignmentType
        startsAt         = $startTime
        endsAt           = $endTime
        durationHours    = $DurationHours
        maxDurationHours = $MaxDurationHours
        state            = 'active'
        justification    = $Justification
    }
}

function Revoke-JitGrant {
    <#
    .SYNOPSIS
        Revokes a JIT grant early. Never touches permanent assignments.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RoleId,

        [Parameter()]
        [ValidateSet('eligible', 'active')]
        [string]$AssignmentType = 'eligible'
    )

    $body = @{
        action           = 'AdminRemove'
        principalId      = $UserId
        roleDefinitionId = $RoleId
        directoryScopeId = '/'
        justification    = 'JIT grant revoked early'
    }

    $uri = if ($AssignmentType -eq 'active') {
        "/v1.0/roleManagement/directory/roleAssignmentScheduleRequests"
    } else {
        "/v1.0/roleManagement/directory/roleEligibilityScheduleRequests"
    }

    Invoke-MgGraphRequest -Method POST -Uri $uri -Body ($body | ConvertTo-Json -Depth 5)

    return [pscustomobject]@{
        tenantId       = $TenantId
        userId         = $UserId
        roleId         = $RoleId
        assignmentType = $AssignmentType
        state          = 'revoked'
        revokedAt      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
}

function Extend-JitGrant {
    <#
    .SYNOPSIS
        Extends a JIT grant within the allowed maximum duration.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RoleId,

        [Parameter(Mandatory)]
        [int]$AdditionalHours,

        [Parameter()]
        [int]$CurrentDurationHours = 8,

        [Parameter()]
        [int]$MaxDurationHours = 24,

        [Parameter()]
        [ValidateSet('eligible', 'active')]
        [string]$AssignmentType = 'eligible',

        # The exact new end (ISO 8601). Without it the grant is extended to
        # CurrentDurationHours + AdditionalHours counted from now.
        [Parameter()]
        [string]$NewEndsAt = ''
    )

    $newTotal = $CurrentDurationHours + $AdditionalHours
    if ($newTotal -gt $MaxDurationHours) {
        throw "extended duration ($newTotal hours) exceeds maximum allowed duration ($MaxDurationHours hours)"
    }

    $body = @{
        action           = 'AdminExtend'
        principalId      = $UserId
        roleDefinitionId = $RoleId
        directoryScopeId = '/'
        justification    = 'JIT grant extended'
        scheduleInfo     = @{
            expiration = if ($NewEndsAt) {
                @{
                    type        = 'AfterDateTime'
                    endDateTime = $NewEndsAt
                }
            }
            else {
                @{
                    type     = 'AfterDuration'
                    duration = "PT${newTotal}H"
                }
            }
        }
    }

    $uri = if ($AssignmentType -eq 'active') {
        "/v1.0/roleManagement/directory/roleAssignmentScheduleRequests"
    } else {
        "/v1.0/roleManagement/directory/roleEligibilityScheduleRequests"
    }

    Invoke-MgGraphRequest -Method POST -Uri $uri -Body ($body | ConvertTo-Json -Depth 5)

    return [pscustomobject]@{
        tenantId       = $TenantId
        userId         = $UserId
        roleId         = $RoleId
        durationHours  = $newTotal
        state          = 'extended'
        endsAt         = if ($NewEndsAt) { $NewEndsAt } else { (Get-Date).AddHours($newTotal).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
    }
}
