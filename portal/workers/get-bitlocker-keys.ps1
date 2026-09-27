# get-bitlocker-keys.ps1 - worker entrypoint for BitLocker key retrieval.
#
# Emits the Get-BitLockerKeys response object as JSON on stdout; stdout is the response transport,
# so key material is not persisted anywhere by this script. The BFF runs it with -JobFile
# (tenantId, deviceId, and the credential block for Connect-WorkerTenant, T-0826);
# -TenantId/-DeviceId remain for manual runs that manage their own session.

[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string] $JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateNotNullOrEmpty()]
    [string] $TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateNotNullOrEmpty()]
    [string] $DeviceId
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-BitLockerKeys.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
    $TenantId = [string]$job.tenantId
    $DeviceId = [string]$job.deviceId
    if (-not $DeviceId) { throw "job envelope '$JobFile' is missing 'deviceId'" }
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    $result = Get-BitLockerKeys -TenantId $TenantId -DeviceId $DeviceId
    $result | ConvertTo-Json -Depth 5 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
