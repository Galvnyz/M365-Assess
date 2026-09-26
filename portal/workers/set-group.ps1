<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 group CRUD.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    executes or previews group CRUD operations via Invoke-SetGroup,
    and emits the JSON envelope on stdout.
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
    [ValidateSet('create', 'edit', 'delete', 'convert')]
    [string]$Action,

    [Parameter()]
    [string]$GroupId = '',

    [Parameter()]
    [string]$DisplayName = '',

    [Parameter()]
    [ValidateSet('', 'm365', 'security', 'distribution', 'dynamic')]
    [string]$GroupType = 'security',

    [Parameter()]
    [string]$MailNickname = '',

    [Parameter()]
    [string]$Description = '',

    [Parameter()]
    [string]$DynamicRule = '',

    [Parameter()]
    [string]$ConfirmName = '',

    [Parameter()]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-Group.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-SetGroupJob -Path $JobFile
    $TenantId     = $job['TenantId']
    $Action       = $job['Action']
    $GroupId      = $job['GroupId']
    $DisplayName  = $job['DisplayName']
    $GroupType    = $job['GroupType']
    $MailNickname = $job['MailNickname']
    $Description  = $job['Description']
    $DynamicRule  = $job['DynamicRule']
    $ConfirmName  = $job['ConfirmName']
    $DryRun       = [bool]$job['DryRun']
}

$invokeParams = @{
    TenantId     = $TenantId
    Action       = $Action
    GroupId      = $GroupId
    DisplayName  = $DisplayName
    GroupType    = $GroupType
    MailNickname = $MailNickname
    Description  = $Description
    DynamicRule  = $DynamicRule
    ConfirmName  = $ConfirmName
    DryRun       = [bool]$DryRun
}

$result = Invoke-SetGroup @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
