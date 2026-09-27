<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 offboarding run.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a job plan directly), runs
    the plan steps sequentially via Invoke-UserOffboarding, and emits the job
    result as JSON on stdout. With -RerunOrder (or a payload rerunOrder) only
    that plan step runs, through Invoke-OffboardingStepRerun, without touching
    already-applied steps. Progress events go to stderr so stdout stays the
    result transport. The supervisor connects Graph in this child process after
    materializing the tenant credential (T-0011) before invoking this script,
    so no secret handling lives here. -DryRun plans each step with no tenant
    write.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER JobId
    Direct offboarding job id for runs without a job envelope.
.PARAMETER UserIdsJson
    Target user ids as a JSON array for runs without a job envelope.
.PARAMETER StepsJson
    Plan steps as a JSON array of { order, action } for runs without a job envelope.
.PARAMETER RerunOrder
    Re-run only this plan order instead of the full plan.
.PARAMETER DryRun
    Report each intended change without writing to the tenant.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-user-offboarding.ps1 -JobFile './run/offboarding-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/invoke-user-offboarding.ps1 -TenantId 'tenant-a' -JobId 'job-1' -UserIdsJson '["user-1"]' -StepsJson '[{"order":1,"action":"disable-sign-in"}]' -DryRun
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$JobId = 'job-direct',

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$UserIdsJson = '[]',

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$StepsJson = '[]',

    [Parameter()]
    [int]$RerunOrder = 0,

    [Parameter()]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-UserOffboarding.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Rerun-OffboardingStep.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph, ExchangeOnline
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-OffboardingJob -Path $JobFile
        $TenantId = $job['TenantId']
        $JobId = [string]$job['JobId']
        if ($JobId.Trim().Length -eq 0) {
            $JobId = 'job-direct'
        }
        $UserIds = @($job['UserIds'])
        $Steps = @($job['Steps'])
        $MailboxAccess = $job['MailboxAccess']
        if (-not $PSBoundParameters.ContainsKey('DryRun')) {
            $DryRun = [bool]$job['DryRun']
        }
        if ($RerunOrder -eq 0) {
            $RerunOrder = [int]$job['RerunOrder']
        }
    }
    else {
        $UserIds = @($UserIdsJson | ConvertFrom-Json)
        $Steps = @($StepsJson | ConvertFrom-Json)
        $MailboxAccess = @{ mode = 'full'; automap = $false }
    }

    if ($RerunOrder -gt 0) {
        $result = Invoke-OffboardingStepRerun -TenantId $TenantId -JobId $JobId -UserIds $UserIds -Steps $Steps -Order $RerunOrder -MailboxAccess $MailboxAccess -DryRun:$DryRun
    }
    else {
        $result = Invoke-UserOffboarding -TenantId $TenantId -JobId $JobId -UserIds $UserIds -Steps $Steps -MailboxAccess $MailboxAccess -DryRun:$DryRun
    }
    $result | ConvertTo-Json -Depth 8 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
