<#
.SYNOPSIS
    Worker entrypoint for the EPIC-012 auth-methods policy apply.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or tenant and policy JSON directly),
    applies the authentication-methods policy via Invoke-AuthMethodsPolicyApply,
    and emits the JSON result on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON.
.PARAMETER TenantId
    Direct tenant id.
.PARAMETER PolicyJson
    JSON string representing the policy shape.
.PARAMETER DryRun
    Report diff without applying.
.PARAMETER Confirmed
    Explicit confirmation for applying policy changes.
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
    [string]$PolicyJson,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-AuthMethodsPolicy.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-AuthMethodsPolicyJob -Path $JobFile
        $TenantId = $job['TenantId']
        $policy = $job['Policy']
        if (-not $PSBoundParameters.ContainsKey('DryRun') -and $job['DryRun']) {
            $DryRun = [switch]$true
        }
        if (-not $PSBoundParameters.ContainsKey('Confirmed') -and $job['Confirmed']) {
            $Confirmed = [switch]$true
        }
    } else {
        $policy = $PolicyJson | ConvertFrom-Json
    }

    $invokeParams = @{
        TenantId = $TenantId
        Policy   = $policy
    }
    if ($DryRun) {
        $invokeParams['DryRun'] = $true
    }
    if ($Confirmed) {
        $invokeParams['Confirmed'] = $true
    }

    $result = Invoke-AuthMethodsPolicyApply @invokeParams
    $result | ConvertTo-Json -Depth 6 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
