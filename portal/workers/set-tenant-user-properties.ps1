<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 bulk user property patch.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or planned rows directly),
    applies the patches live against Graph via Set-TenantUserBulkProperties,
    and emits the per-row results as JSON on stdout. Stdout is the response
    transport; user objects are never mirrored to disk. The supervisor connects
    Graph in this child process after materializing the tenant credential
    (T-0011) before invoking this script, so no secret handling lives here.
    -Preview returns each diff with no tenant write.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER PatchesJson
    Planned rows as a JSON array of { userId, properties }.
.PARAMETER Preview
    Return each diff without writing to the tenant.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/set-tenant-user-properties.ps1 -JobFile './run/user-patch-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/set-tenant-user-properties.ps1 -TenantId 'tenant-a' -PatchesJson '[{"userId":"user-1","properties":{"department":"Finance"}}]' -Preview
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
    [string]$PatchesJson,

    [Parameter()]
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-TenantUserProperties.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-TenantUserPatchJob -Path $JobFile
    $TenantId = $job['TenantId']
    if (-not $PSBoundParameters.ContainsKey('Preview')) {
        $Preview = [bool]$job['Preview']
    }
    $patches = @($job['Patches'])
}
else {
    $patches = @($PatchesJson | ConvertFrom-Json)
}

$result = Set-TenantUserBulkProperties -TenantId $TenantId -Patches $patches -DryRun:$Preview
$result | ConvertTo-Json -Depth 6 -Compress
