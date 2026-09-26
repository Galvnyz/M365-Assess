<#
.SYNOPSIS
    Worker entrypoint for the EPIC-011 tenant user create.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a planned user directly),
    applies the planned creates live against Graph via New-TenantUserBulk, and
    emits the per-row results as JSON on stdout. Stdout is the response
    transport; a generated one-time password is returned in that transport
    only and is never written to disk or logged. The supervisor connects Graph
    in this child process after materializing the tenant credential (T-0011)
    before invoking this script, so no secret handling lives here. -DryRun
    plans each row with no tenant write.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER UserJson
    Single planned user as a JSON object (direct mode).
.PARAMETER UsersJson
    Planned users as a JSON array (direct bulk mode).
.PARAMETER DryRun
    Report each intended change without writing to the tenant.
.PARAMETER DefaultUsageLocation
    Tenant default applied when a row omits usageLocation.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/new-tenant-user.ps1 -JobFile './run/user-create-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/new-tenant-user.ps1 -TenantId 'tenant-a' -UserJson '{"userPrincipalName":"new.user@example.invalid","displayName":"New User","usageLocation":"US"}' -DryRun
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
    [string]$UserJson = '',

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$UsersJson = '',

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [string]$DefaultUsageLocation = '',

    [Parameter()]
    [string[]]$KnownLicenses = @()
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/New-TenantUser.ps1')

function ConvertTo-CreateUser {
    param(
        [Parameter(Mandatory)]
        [object]$Entry,

        [Parameter()]
        [string]$DefaultUsageLocation = ''
    )

    $user = [pscustomobject]@{
        userPrincipalName = [string]$Entry.userPrincipalName
        displayName       = [string]$Entry.displayName
        givenName         = [string]$Entry.givenName
        surname           = [string]$Entry.surname
        usageLocation     = [string]$Entry.usageLocation
        licenses          = @($Entry.licenses)
        groups            = @($Entry.groups)
        password          = [string]$Entry.password
    }
    if ([string]::IsNullOrWhiteSpace($user.usageLocation) -and $DefaultUsageLocation.Trim().Length -gt 0) {
        $user.usageLocation = $DefaultUsageLocation.Trim()
    }
    return $user
}

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-TenantUserCreateJob -Path $JobFile
    $TenantId = $job['TenantId']
    if (-not $PSBoundParameters.ContainsKey('DryRun')) {
        $DryRun = [bool]$job['DryRun']
    }
    if ($DefaultUsageLocation.Trim().Length -eq 0) {
        $DefaultUsageLocation = [string]$job['DefaultUsageLocation']
    }
    if ($KnownLicenses.Count -eq 0) {
        $KnownLicenses = @($job['KnownLicenses'])
    }
    $users = foreach ($entry in @($job['Users'])) {
        ConvertTo-CreateUser -Entry $entry -DefaultUsageLocation $DefaultUsageLocation
    }
}
else {
    $users = [System.Collections.Generic.List[object]]::new()
    if ($UserJson.Trim().Length -gt 0) {
        $users.Add((ConvertTo-CreateUser -Entry ($UserJson | ConvertFrom-Json) -DefaultUsageLocation $DefaultUsageLocation))
    }
    if ($UsersJson.Trim().Length -gt 0) {
        foreach ($entry in @($UsersJson | ConvertFrom-Json)) {
            $users.Add((ConvertTo-CreateUser -Entry $entry -DefaultUsageLocation $DefaultUsageLocation))
        }
    }
    if ($users.Count -eq 0) {
        throw 'Tenant user create needs -UserJson or -UsersJson in direct mode.'
    }
    $users = @($users)
}

$result = New-TenantUserBulk -TenantId $TenantId -Users $users -DryRun:$DryRun -KnownLicenses $KnownLicenses
$result | ConvertTo-Json -Depth 6 -Compress
