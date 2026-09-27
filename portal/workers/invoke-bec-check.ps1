<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 BEC compromise review.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant and user directly),
    runs the 11-check review live against Graph via Invoke-BecCheck, and emits
    the outcomes as JSON on stdout. Stdout is the response transport; user
    objects are never mirrored to disk. With -Action (or a payload action) one
    automated per-finding remediation runs instead, after explicit
    confirmation. The supervisor connects Graph in this child process after
    materializing the tenant credential (T-0011) before invoking this script,
    so no secret handling lives here. The check itself never writes to the
    tenant.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserId
    Direct target user id for runs without a job envelope.
.PARAMETER Action
    Optional automated remediation (removeInboxRule, revokeSessions) for
    single-finding mode.
.PARAMETER Target
    Action target, e.g. the inbox rule id for removeInboxRule.
.PARAMETER Check
    BEC check the finding came from, for single-finding mode.
.PARAMETER Confirm
    Explicit per-finding approval for single-finding mode.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-bec-check.ps1 -JobFile './run/bec-check-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-bec-check.ps1 -TenantId 'tenant-a' -UserId 'user-1'
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
    [string]$Action = '',

    [Parameter()]
    [string]$Target = '',

    [Parameter()]
    [string]$Check = '',

    [Parameter()]
    [switch]$Confirm
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-BecCheck.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph, ExchangeOnline
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-BecCheckJob -Path $JobFile
        $TenantId = $job['TenantId']
        $UserId = $job['UserId']
        if ($Action.Trim().Length -eq 0) {
            $Action = $job['Action']
        }
        if ($Target.Trim().Length -eq 0) {
            $Target = $job['Target']
        }
        if ($Check.Trim().Length -eq 0) {
            $Check = $job['Check']
        }
        if (-not $PSBoundParameters.ContainsKey('Confirm')) {
            $Confirm = [bool]$job['Confirmed']
        }
    }

    if ($Action.Trim().Length -gt 0) {
        $result = Invoke-BecFindingRemediation -TenantId $TenantId -UserId $UserId -Check $Check -Action $Action -Target $Target -Confirmed:$Confirm
    }
    else {
        $result = Invoke-BecCheck -TenantId $TenantId -UserId $UserId
    }
    $result | ConvertTo-Json -Depth 8 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
