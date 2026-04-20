[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
<#
.SYNOPSIS
    Collects Entra ID security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Microsoft Graph for security-relevant Entra ID configuration settings
    including user consent policies, admin consent workflow, application registration
    policies, self-service password reset, password protection, and global admin counts.
    Returns a structured inventory of settings with current values and recommendations.

    Requires Microsoft.Graph.Identity.DirectoryManagement and
    Microsoft.Graph.Identity.SignIns modules and the following permissions:
    Policy.Read.All, User.Read.All, RoleManagement.Read.Directory, Directory.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Policy.Read.All','User.Read.All','RoleManagement.Read.Directory'
    PS> .\Entra\Get-EntraSecurityConfig.ps1

    Displays Entra ID security configuration settings.
.EXAMPLE
    PS> .\Entra\Get-EntraSecurityConfig.ps1 -OutputPath '.\entra-security-config.csv'

    Exports the security configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Continue on errors: non-critical checks should not block remaining assessments.
$ErrorActionPreference = 'Continue'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }
$context = Get-MgContext

Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction SilentlyContinue
Import-Module -Name Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue

# Load shared security-config helpers
$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue,
        [ValidateSet('Pass', 'Fail', 'Warning', 'Review', 'Info', 'Skipped', 'Unknown')]
        [string]$Status,
        [string]$CheckId = '', [string]$Remediation = '',
        [PSCustomObject]$Evidence = $null
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
        Evidence         = $Evidence
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# Shared data queries used by multiple helper files
# ------------------------------------------------------------------

# Authorization policy -- used by UserGroupChecks and AdminRoleChecks
$authPolicy = $null
try {
    Write-Verbose "Checking authorization policy..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/authorizationPolicy'
        ErrorAction = 'Stop'
    }
    $authPolicy = Invoke-MgGraphRequest @graphParams
}
catch {
    Write-Warning "Could not retrieve authorization policy: $_"
}

# $sspr -- populated by EntraPasswordAuthChecks.ps1 section 7, used by sections 7b, 7c, 20, 21
$sspr = $null

# $orgSettings -- populated by EntraUserGroupChecks.ps1 section 14, used by section 27
$orgSettings = $null

# $pwSettings -- populated by EntraPasswordAuthChecks.ps1 section 8, used by section 27
$pwSettings = $null

# ------------------------------------------------------------------
# Dot-source helper files (run in shared scope)
# ------------------------------------------------------------------
. (Join-Path -Path $_scriptDir -ChildPath 'EntraHelpers.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'EntraPasswordAuthChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'EntraAdminRoleChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'EntraConditionalAccessChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'EntraUserGroupChecks.ps1')

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra ID'
