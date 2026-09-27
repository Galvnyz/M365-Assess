<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 user lifecycle actions.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant, user, and action
    directly), executes the action live against Graph via
    Invoke-TenantUserAction, and emits the result as JSON on stdout. Stdout is
    the response transport; a one-time password is returned in that transport
    only and is never written to disk or logged. The supervisor connects Graph
    in this child process after materializing the tenant credential (T-0011)
    before invoking this script, so no secret handling lives here. -DryRun
    plans the action with no tenant write; destructive and session-breaking
    actions additionally require -Confirm.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserId
    Direct target user id for runs without a job envelope.
.PARAMETER Action
    Lifecycle action: resetPassword, requirePasswordChange, revokeSessions,
    disable, enable, or restore.
.PARAMETER OneTimeSecret
    Caller-supplied password value for resetPassword. A one-time value is
    generated when omitted.
.PARAMETER DryRun
    Report the intended change without writing to the tenant.
.PARAMETER Confirm
    Explicit confirmation for destructive and session-breaking actions.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-user-action.ps1 -JobFile './run/user-action-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-user-action.ps1 -TenantId 'tenant-a' -UserId 'user-1' -Action 'disable' -Confirm -DryRun
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$UserId,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$Action,

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$OneTimeSecret = '',

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirm
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-UserAction.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-UserActionJob -Path $JobFile
        $TenantId = $job['TenantId']
        $UserId = $job['UserId']
        $Action = $job['Action']
        $OneTimeSecret = $job['OneTimeSecret']
        if (-not $PSBoundParameters.ContainsKey('DryRun')) {
            $DryRun = [bool]$job['DryRun']
        }
        if (-not $PSBoundParameters.ContainsKey('Confirm')) {
            $Confirm = [bool]$job['Confirmed']
        }
    }

    $result = Invoke-TenantUserAction -TenantId $TenantId -UserId $UserId -Action $Action -OneTimeSecret $OneTimeSecret -DryRun:$DryRun -Confirmed:$Confirm
    $result | ConvertTo-Json -Depth 6 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
