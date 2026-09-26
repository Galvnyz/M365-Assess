# New-PimRequest.ps1 — EPIC-013 PIM role schedule requests (SPEC §3.3, §4.3, §5; T-0245).
#
# Submits an activation or assignment request for a window.
# Justification is strictly mandatory. When approval is configured, the request
# enters a pending state; otherwise it activates directly.

function Read-PimRequestJob {
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
    if (-not $json.principalId) {
        throw "job envelope '$Path' is missing mandatory 'principalId'"
    }
    if (-not $json.roleId) {
        throw "job envelope '$Path' is missing mandatory 'roleId'"
    }

    return @{
        TenantId         = [string]$json.tenantId
        PrincipalId      = [string]$json.principalId
        RoleId           = [string]$json.roleId
        Action           = if ($json.action) { [string]$json.action } else { 'activate' }
        Justification    = [string]$json.justification
        DurationHours    = if ($json.durationHours) { [int]$json.durationHours } else { 8 }
        ApprovalRequired = [bool]($json.approvalRequired -eq $true)
        TicketNumber     = if ($json.ticketNumber) { [string]$json.ticketNumber } else { $null }
    }
}

function New-PimRequest {
    <#
    .SYNOPSIS
        Submits a PIM schedule/activation request to Graph with mandatory justification.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$PrincipalId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RoleId,

        [Parameter()]
        [ValidateSet('activate', 'extend', 'assign', 'deactivate')]
        [string]$Action = 'activate',

        [Parameter()]
        [string]$Justification = '',

        [Parameter()]
        [ValidateRange(1, 24)]
        [int]$DurationHours = 8,

        [Parameter()]
        [switch]$ApprovalRequired,

        [Parameter()]
        [string]$TicketNumber = ''
    )

    if ([string]::IsNullOrWhiteSpace($Justification)) {
        throw "justification is required for PIM schedule request"
    }

    $actionMap = @{
        'activate'   = 'SelfActivate'
        'extend'     = 'AdminExtend'
        'assign'     = 'AdminAssign'
        'deactivate' = 'SelfDeactivate'
    }
    $graphAction = $actionMap[$Action]

    $startTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $endTime = (Get-Date).AddHours($DurationHours).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

    $body = @{
        action           = $graphAction
        principalId      = $PrincipalId
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

    if (-not [string]::IsNullOrWhiteSpace($TicketNumber)) {
        $body['ticketInfo'] = @{
            ticketNumber = $TicketNumber
            ticketSystem = 'ServiceDesk'
        }
    }

    $uri = "/v1.0/roleManagement/directory/roleAssignmentScheduleRequests"
    $resp = Invoke-MgGraphRequest -Method POST -Uri $uri -Body ($body | ConvertTo-Json -Depth 5)

    $state = if ($ApprovalRequired -or ($resp -and $resp.status -eq 'PendingApproval')) {
        'pending'
    } else {
        'active'
    }

    $requestId = if ($resp -and $resp.id) { [string]$resp.id } else { [System.Guid]::NewGuid().ToString() }

    return [pscustomobject]@{
        id            = $requestId
        tenantId      = $TenantId
        principalId   = $PrincipalId
        roleId        = $RoleId
        action        = $Action
        state         = $state
        justification = $Justification
        durationHours = $DurationHours
        ticketNumber  = $TicketNumber
        startsAt      = if ($state -eq 'active') { $startTime } else { $null }
        endsAt        = if ($state -eq 'active') { $endTime } else { $null }
    }
}
