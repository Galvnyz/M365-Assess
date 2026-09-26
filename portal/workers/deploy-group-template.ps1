<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 group template deploy.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    plans or deploys a group template via Invoke-DeployGroupTemplate,
    and emits the JSON envelope on stdout.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [object]$Template,

    [Parameter()]
    [hashtable]$Variables = @{},

    [Parameter()]
    [string]$CreatedBy = 'system',

    [Parameter()]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Deploy-GroupTemplate.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-DeployGroupTemplateJob -Path $JobFile
    $TenantId  = $job['TenantId']
    $Template  = $job['Template']
    $Variables = $job['Variables']
    $CreatedBy = $job['CreatedBy']
    $DryRun    = [bool]$job['DryRun']
}

$invokeParams = @{
    TenantId  = $TenantId
    Template  = $Template
    Variables = $Variables
    CreatedBy = $CreatedBy
    DryRun    = [bool]$DryRun
}

$result = Invoke-DeployGroupTemplate @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
