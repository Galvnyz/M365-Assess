<#
.SYNOPSIS
    Worker entrypoint for EPIC-012 MFA push and default-method actions.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant, user, and action
    directly), dispatches through Invoke-MfaAction, and emits the result as
    JSON on stdout. Stdout is the response transport; user data is never
    mirrored to disk. The supervisor connects Graph in this child process
    after materializing the tenant credential (T-0011) before invoking this
    script, so no secret handling lives here.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserId
    The user id.
.PARAMETER Action
    push or defaultMethod.
.PARAMETER Method
    Canonical method id for defaultMethod.
.PARAMETER DryRun
    Report the intended change without writing.
.PARAMETER Confirmed
    Explicit confirmation for the tenant write.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-mfa-action.ps1 -JobFile './run/mfa-action-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-mfa-action.ps1 -TenantId 'tenant-a' -UserId 'user-1' -Action 'push' -DryRun
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
    [ValidateSet('push', 'defaultMethod')]
    [string]$Action,

    [Parameter()]
    [string]$Method = '',

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-MfaAction.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-MfaActionJob -Path $JobFile
        $TenantId = $job['TenantId']
        $UserId = $job['UserId']
        $Action = $job['Action']
        if (-not $PSBoundParameters.ContainsKey('Method')) {
            $Method = $job['Method']
        }
        if (-not $PSBoundParameters.ContainsKey('DryRun') -and $job['DryRun']) {
            $DryRun = [switch]$true
        }
        if (-not $PSBoundParameters.ContainsKey('Confirmed') -and $job['Confirmed']) {
            $Confirmed = [switch]$true
        }
    }

    $invokeParams = @{
        TenantId = $TenantId
        UserId   = $UserId
        Action   = $Action
    }
    if ($Method.Trim().Length -gt 0) {
        $invokeParams['Method'] = $Method.Trim()
    }
    if ($DryRun) {
        $invokeParams['DryRun'] = $true
    }
    if ($Confirmed) {
        $invokeParams['Confirmed'] = $true
    }

    $result = Invoke-MfaAction @invokeParams
    $result | ConvertTo-Json -Depth 5 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
