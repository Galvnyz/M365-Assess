<#
.SYNOPSIS
    Worker entrypoint for EPIC-012 Temporary Access Pass creation.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant and user directly),
    creates the pass via New-TemporaryAccessPass, and emits the result as JSON
    on stdout. Stdout is the response transport: the pass value it carries is
    shown once by the caller and never mirrored to disk. The supervisor
    connects Graph in this child process after materializing the tenant
    credential (T-0011) before invoking this script, so no secret handling
    lives here.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserId
    The user the pass is issued for.
.PARAMETER LifetimeMinutes
    Pass lifetime in minutes (10 to 43200).
.PARAMETER OneTime
    The pass is usable once. Defaults to true.
.PARAMETER StartTime
    Optional ISO-8601 start time. Empty means effective immediately.
.PARAMETER DryRun
    Report the intended pass metadata without writing.
.PARAMETER Confirmed
    Explicit confirmation for issuing a credential.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/new-temporary-access-pass.ps1 -JobFile './run/tap-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/new-temporary-access-pass.ps1 -TenantId 'tenant-a' -UserId 'user-1' -DryRun
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
    [ValidateRange(10, 43200)]
    [int]$LifetimeMinutes = 60,

    [Parameter()]
    [bool]$OneTime = $true,

    [Parameter()]
    [string]$StartTime = '',

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/New-TemporaryAccessPass.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-TapJob -Path $JobFile
        $TenantId = $job['TenantId']
        $UserId = $job['UserId']
        foreach ($name in @('LifetimeMinutes', 'OneTime', 'StartTime')) {
            if (-not $PSBoundParameters.ContainsKey($name)) {
                Set-Variable -Name $name -Value $job[$name]
            }
        }
        if (-not $PSBoundParameters.ContainsKey('DryRun') -and $job['DryRun']) {
            $DryRun = [switch]$true
        }
        if (-not $PSBoundParameters.ContainsKey('Confirmed') -and $job['Confirmed']) {
            $Confirmed = [switch]$true
        }
    }

    $invokeParams = @{
        TenantId        = $TenantId
        UserId          = $UserId
        LifetimeMinutes = $LifetimeMinutes
        OneTime         = $OneTime
        StartTime       = $StartTime
    }
    if ($DryRun) {
        $invokeParams['DryRun'] = $true
    }
    if ($Confirmed) {
        $invokeParams['Confirmed'] = $true
    }

    $result = New-TemporaryAccessPass @invokeParams
    $result | ConvertTo-Json -Depth 5 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
