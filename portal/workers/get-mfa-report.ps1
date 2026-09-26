<#
.SYNOPSIS
    Worker entrypoint for the EPIC-012 MFA report read.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or a tenant id directly),
    builds the MFA report live from Graph via Get-MfaReport, and emits the
    filtered cursor page as JSON on stdout. Stdout is the response transport;
    user method data is never mirrored to disk. The supervisor connects Graph
    in this child process after materializing the tenant credential (T-0011)
    before invoking this script, so no secret handling lives here.
.PARAMETER JobFile
    Path to the job envelope JSON the supervisor wrote for this run.
.PARAMETER TenantId
    Direct tenant id for runs without a job envelope.
.PARAMETER Registered
    Filter by registration: registered or notRegistered.
.PARAMETER Method
    Filter by canonical method id.
.PARAMETER PhishingResistant
    Filter by phishing-resistant, not-phishing-resistant, or unknown.
.PARAMETER License
    licensed keeps users with at least one license, unlicensed the rest.
.PARAMETER AdminRole
    'true' keeps admin-role holders, 'false' the rest, empty both.
.PARAMETER Top
    Page size.
.PARAMETER Cursor
    Opaque page cursor from a previous result.
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/get-mfa-report.ps1 -JobFile './run/mfa-report-job.json'
.EXAMPLE
    PS> pwsh -NoProfile -File portal/workers/get-mfa-report.ps1 -TenantId 'tenant-a' -Method 'fido2'
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
    [ValidateSet('', 'registered', 'notRegistered')]
    [string]$Registered = '',

    [Parameter()]
    [string]$Method = '',

    [Parameter()]
    [ValidateSet('', 'phishing-resistant', 'not-phishing-resistant', 'unknown')]
    [string]$PhishingResistant = '',

    [Parameter()]
    [ValidateSet('', 'licensed', 'unlicensed')]
    [string]$License = '',

    [Parameter()]
    [string]$AdminRole = '',

    [Parameter()]
    [ValidateRange(1, 999)]
    [int]$Top = 100,

    [Parameter()]
    [string]$Cursor = ''
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-MfaReport.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-MfaReportJob -Path $JobFile
    $TenantId = $job['TenantId']
    foreach ($name in @('Registered', 'Method', 'PhishingResistant', 'License', 'AdminRole', 'Top', 'Cursor')) {
        if (-not $PSBoundParameters.ContainsKey($name)) {
            Set-Variable -Name $name -Value $job[$name]
        }
    }
}

$invokeParams = @{
    TenantId          = $TenantId
    Registered        = $Registered
    Method            = $Method
    PhishingResistant = $PhishingResistant
    License           = $License
    AdminRole         = $AdminRole
    Top               = $Top
    Cursor            = $Cursor
}

$result = Get-MfaReport @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
