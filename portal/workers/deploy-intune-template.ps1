<#
.SYNOPSIS
    Worker entrypoint for EPIC-016 Intune template deployment (T-0306).
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly), plans or
    applies the template deploy for one target tenant, and emits JSON on stdout.
    The BFF runs one job per target tenant.
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

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateNotNullOrEmpty()]
    [string]$TemplateJson,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$AssignmentMode = 'template',

    [Parameter(ParameterSetName = 'ByParams')]
    [string[]]$Groups = @(),

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyState = 'enabled',

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$Overwrite,

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$CreateGroups,

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Deploy-IntuneTemplate.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-DeployIntuneTemplateJob -Path $JobFile
        $TenantId       = $job['TenantId']
        $TemplateJson   = $job['TemplateJson']
        $PolicyName     = $job['PolicyName']
        $AssignmentMode = $job['AssignmentMode']
        $Groups         = @($job['Groups'])
        $PolicyState    = $job['PolicyState']
        $Overwrite      = [bool]$job['Overwrite']
        $CreateGroups   = [bool]$job['CreateGroups']
        $DryRun         = [bool]$job['DryRun']
    }

    $invokeParams = @{
        TenantId       = $TenantId
        TemplateJson   = $TemplateJson
        PolicyName     = $PolicyName
        AssignmentMode = $AssignmentMode
        Groups         = $Groups
        PolicyState    = $PolicyState
        Overwrite      = [bool]$Overwrite
        CreateGroups   = [bool]$CreateGroups
        DryRun         = [bool]$DryRun
    }

    $result = Invoke-DeployIntuneTemplate @invokeParams
    $result | ConvertTo-Json -Depth 20 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
