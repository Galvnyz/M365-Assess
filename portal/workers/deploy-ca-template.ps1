<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 CA template deployment.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    executes or previews template deployment, and emits JSON on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$TemplateId = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$TemplateJson = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyState = 'enabledForReportingButNotEnforced',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$GroupUserHandling = 'all',

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$CreateGroups,

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$Overwrite,

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$DisableSecurityDefaults,

    [Parameter(ParameterSetName = 'ByParams')]
    [string[]]$BreakGlassExclusions = @(),

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Deploy-CaTemplate.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-DeployCaTemplateJob -Path $JobFile
        $TenantId                = $job['TenantId']
        $TemplateId              = $job['TemplateId']
        $TemplateJson            = $job['TemplateJson']
        $PolicyName              = $job['PolicyName']
        $PolicyState             = $job['PolicyState']
        $GroupUserHandling       = $job['GroupUserHandling']
        $CreateGroups            = [bool]$job['CreateGroups']
        $Overwrite               = [bool]$job['Overwrite']
        $DisableSecurityDefaults = [bool]$job['DisableSecurityDefaults']
        $BreakGlassExclusions    = @($job['BreakGlassExclusions'])
        $DryRun                  = [bool]$job['DryRun']
    }

    $invokeParams = @{
        TenantId                = $TenantId
        TemplateId              = $TemplateId
        TemplateJson            = $TemplateJson
        PolicyName              = $PolicyName
        PolicyState             = $PolicyState
        GroupUserHandling       = $GroupUserHandling
        CreateGroups            = [bool]$CreateGroups
        Overwrite               = [bool]$Overwrite
        DisableSecurityDefaults = [bool]$DisableSecurityDefaults
        BreakGlassExclusions    = $BreakGlassExclusions
        DryRun                  = [bool]$DryRun
    }

    $result = Invoke-DeployCaTemplate @invokeParams
    $result | ConvertTo-Json -Depth 10 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
