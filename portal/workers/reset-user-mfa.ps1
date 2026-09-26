<#
.SYNOPSIS
    Worker entrypoint for the EPIC-012 MFA reset.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant and user directly),
    removes the user's authentication methods via Invoke-MfaReset, and emits
    the result with the post-reset method state as JSON on stdout. Stdout is
    the response transport; user data is never mirrored to disk. The supervisor
    connects Graph in this child process after materializing the tenant
    credential (T-0011) before invoking this script, so no secret handling
    lives here.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserId
    The user whose methods are removed.
.PARAMETER DryRun
    Report the methods that would be removed without writing.
.PARAMETER Confirmed
    Explicit confirmation for this destructive action.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/reset-user-mfa.ps1 -JobFile './run/mfa-reset-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/reset-user-mfa.ps1 -TenantId 'tenant-a' -UserId 'user-1' -DryRun
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

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Reset-UserMfa.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-MfaResetJob -Path $JobFile
    $TenantId = $job['TenantId']
    $UserId = $job['UserId']
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
}
if ($DryRun) {
    $invokeParams['DryRun'] = $true
}
if ($Confirmed) {
    $invokeParams['Confirmed'] = $true
}

$result = Invoke-MfaReset @invokeParams
$result | ConvertTo-Json -Depth 5 -Compress
