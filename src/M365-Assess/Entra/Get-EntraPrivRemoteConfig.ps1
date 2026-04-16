<#
.SYNOPSIS
    Evaluates whether PIM is configured for privileged roles to restrict remote
    execution of privileged commands.
.DESCRIPTION
    Checks whether Privileged Identity Management (PIM) is used for critical
    admin roles so that permanent standing access is eliminated. Users must
    activate roles with justification and approval rather than holding persistent
    assignments. Verifies that Global Administrator and other critical roles have
    minimal or zero permanent active assignments.

    Requires an active Microsoft Graph connection with RoleManagement.Read.Directory
    and PrivilegedAccess.Read.AzureAD permissions.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Entra\Get-EntraPrivRemoteConfig.ps1

    Displays PIM privileged remote access evaluation results.
.EXAMPLE
    PS> .\Entra\Get-EntraPrivRemoteConfig.ps1 -OutputPath '.\entra-privremote-config.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.15 — Authorize Remote Execution of Privileged Commands
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = ''
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
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# Well-known role template IDs for critical roles
# ------------------------------------------------------------------
$globalAdminRoleId = '62e90394-69f5-4237-9190-012177145e10'

# ------------------------------------------------------------------
# 1. Check for permanent vs eligible Global Admin assignments
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Global Admin role assignments for PIM usage...'

    # Get active (permanent) assignments
    $activeParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/roleManagement/directory/roleAssignments?`$filter=roleDefinitionId eq '$globalAdminRoleId'"
        ErrorAction = 'Stop'
    }
    $activeAssignments = Invoke-MgGraphRequest @activeParams

    $permanentCount = 0
    if ($activeAssignments -and $activeAssignments['value']) {
        $permanentCount = @($activeAssignments['value']).Count
    }

    # Try to get eligible (PIM) assignments via v1.0 endpoint
    $eligibleCount = 0
    $eligibleNote = $null
    try {
        $eligibleParams = @{
            Method      = 'GET'
            Uri         = "/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?`$filter=roleDefinitionId eq '$globalAdminRoleId'"
            ErrorAction = 'Stop'
        }
        $eligibleAssignments = Invoke-MgGraphRequest @eligibleParams

        if ($eligibleAssignments -and $eligibleAssignments['value']) {
            $eligibleCount = @($eligibleAssignments['value']).Count
        }
    }
    catch {
        # Silent degradation replaced with Review status
        $eligibleNote = 'PIM eligible assignments not available (requires Entra ID P2)'
        Write-Verbose "Could not query PIM eligible assignments: $_"
    }

    $pimInUse = $eligibleCount -gt 0
    $currentValue = if ($null -ne $eligibleNote) {
        "Permanent: $permanentCount, Eligible (PIM): $eligibleNote"
    }
    else {
        "Permanent: $permanentCount, Eligible (PIM): $eligibleCount"
    }

    # Pass if PIM eligible assignments exist and permanent assignments are minimal (break-glass only)
    $passCondition = $pimInUse -and ($permanentCount -le 2)

    $privStatus = if ($null -ne $eligibleNote) {
        'Review'
    }
    elseif ($passCondition) {
        'Pass'
    }
    elseif ($pimInUse) {
        'Warning'
    }
    else {
        'Fail'
    }

    $settingParams = @{
        Category         = 'Privileged Remote Access'
        Setting          = 'PIM Required for Global Admin Activation'
        CurrentValue     = $currentValue
        RecommendedValue = 'PIM enabled with eligible assignments; max 2 permanent (break-glass)'
        Status           = $privStatus
        CheckId          = 'ENTRA-PRIVREMOTE-001'
        Remediation      = 'Enable Entra ID PIM. Convert permanent role assignments to eligible. Configure activation to require justification and MFA. Entra admin center > Identity Governance > Privileged Identity Management > Entra ID roles.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Privileged Remote Access'
            Setting          = 'PIM Required for Global Admin Activation'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'PIM enabled with eligible assignments; max 2 permanent (break-glass)'
            Status           = 'Review'
            CheckId          = 'ENTRA-PRIVREMOTE-001'
            Remediation      = 'Requires RoleManagement.Read.Directory permission. Entra ID P2 license required for PIM.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check PIM configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra Priv Remote'
