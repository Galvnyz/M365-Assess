<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 tenant user directory read.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant id directly),
    lists the tenant users live from Graph via Get-TenantUsers, and emits the
    filtered cursor page as JSON on stdout. Stdout is the response transport;
    user objects are never mirrored to disk. The supervisor connects Graph in
    this child process after materializing the tenant credential (T-0011)
    before invoking this script, so no secret handling lives here.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER Search
    Case-insensitive substring match against display name and UPN.
.PARAMETER Status
    Filter by account state: enabled or disabled.
.PARAMETER UserType
    Filter by directory type: member or guest.
.PARAMETER License
    licensed keeps users with at least one assigned license, unlicensed the rest.
.PARAMETER MfaState
    Filter by MFA registration: registered, notRegistered, or unknown.
.PARAMETER Department
    Case-insensitive exact match against department.
.PARAMETER InactiveDays
    Keeps users whose last sign-in is older than this many days, or never signed in.
.PARAMETER Top
    Page size.
.PARAMETER Cursor
    Opaque page cursor from a previous result.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/get-tenant-users.ps1 -JobFile './run/users-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/get-tenant-users.ps1 -TenantId 'tenant-a' -UserType 'guest'
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter()]
    [string]$Search = '',

    [Parameter()]
    [ValidateSet('', 'enabled', 'disabled')]
    [string]$Status = '',

    [Parameter()]
    [ValidateSet('', 'member', 'guest')]
    [string]$UserType = '',

    [Parameter()]
    [ValidateSet('', 'licensed', 'unlicensed')]
    [string]$License = '',

    [Parameter()]
    [ValidateSet('', 'registered', 'notRegistered', 'unknown')]
    [string]$MfaState = '',

    [Parameter()]
    [string]$Department = '',

    [Parameter()]
    [ValidateRange(0, 3650)]
    [int]$InactiveDays = 0,

    [Parameter()]
    [ValidateRange(1, 999)]
    [int]$Top = 100,

    [Parameter()]
    [string]$Cursor = ''
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-TenantUsers.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-TenantUsersJob -Path $JobFile
        $TenantId = $job['TenantId']
        foreach ($name in @('Search', 'Status', 'UserType', 'License', 'MfaState', 'Department', 'InactiveDays', 'Top', 'Cursor')) {
            if (-not $PSBoundParameters.ContainsKey($name)) {
                Set-Variable -Name $name -Value $job[$name]
            }
        }
    }

    $invokeParams = @{
        TenantId     = $TenantId
        Search       = $Search
        Status       = $Status
        UserType     = $UserType
        License      = $License
        MfaState     = $MfaState
        Department   = $Department
        InactiveDays = $InactiveDays
        Top          = $Top
        Cursor       = $Cursor
    }

    $result = Get-TenantUsers @invokeParams
    $result | ConvertTo-Json -Depth 5 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
