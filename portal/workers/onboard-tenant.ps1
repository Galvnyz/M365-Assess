<#
.SYNOPSIS
    Worker entrypoint for EPIC-002 direct tenant onboarding (T-0822).
.DESCRIPTION
    Reads a job envelope from -JobFile and runs Invoke-TenantOnboarding, which wraps
    Grant-M365AssessConsent. Onboarding is a high-impact setup write: the envelope must
    carry confirmed = true or the worker refuses. Emits the result as JSON on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON written by the BFF.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-TenantOnboarding.ps1')

$job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
if (-not $job.tenantId) { throw "job envelope '$JobFile' is missing 'tenantId'" }

$onboardParams = @{
    TenantId  = [string]$job.tenantId
    Confirmed = [bool]($job.confirmed -eq $true)
    CreateNew = [bool]($job.createNew -eq $true)
}
$optional = @{
    AdminUpn              = $job.adminUpn
    AppDisplayName        = $job.appDisplayName
    ClientId              = $job.clientId
    CertificateThumbprint = $job.certificateThumbprint
}
foreach ($field in $optional.Keys) {
    if ($optional[$field]) { $onboardParams[$field] = [string]$optional[$field] }
}

Invoke-TenantOnboarding @onboardParams | ConvertTo-Json -Depth 6 -Compress
