<#
.SYNOPSIS
    Evaluates whether privileged admin accounts are separated from daily-use
    accounts by checking for Exchange Online mailbox plans on admin accounts.
.DESCRIPTION
    Queries role assignments for high-privilege Entra ID roles (Global Admin,
    Privileged Role Admin, Security Admin, Exchange Admin, SharePoint Admin)
    then checks each assigned user's license details for Exchange Online service
    plans. An admin account with an Exchange mailbox is likely used for daily
    work, violating user/system management separation. Satisfies CMMC SC.L2-3.13.3.

    Requires an active Microsoft Graph connection with
    RoleManagement.Read.Directory and Directory.Read.All permissions.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Entra\Get-EntraAdminRoleSeparationConfig.ps1

    Displays admin role separation evaluation results.
.EXAMPLE
    PS> .\Entra\Get-EntraAdminRoleSeparationConfig.ps1 -OutputPath '.\entra-adminrole-separation.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    SC.L2-3.13.3 — Separate user functionality from system management
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
# Well-known role template IDs for high-privilege roles
# ------------------------------------------------------------------
$privilegedRoleIds = @(
    '62e90394-69f5-4237-9190-012177145e10'  # Global Administrator
    'e8611ab8-c189-46e8-94e1-60213ab1f814'  # Privileged Role Administrator
    '194ae4cb-b126-40b2-bd5b-6091b380977d'  # Security Administrator
    '29232cdf-9323-42fd-aeaf-7d3bbd031fae'  # Exchange Administrator
    'f28a1f50-f6e7-4571-818b-6a12f2af6b6c'  # SharePoint Administrator
)

# Exchange Online service plan GUIDs (Plan 1 and Plan 2)
$exchangePlanIds = @(
    'efb87545-963c-4e0d-99df-69c6916d9eb0'  # Exchange Online Plan 1
    '19ec0d23-8335-4cbd-94ac-6050e30712fa'  # Exchange Online Plan 2
)

# ------------------------------------------------------------------
# 1. Collect unique user IDs assigned to any high-privilege role
# ------------------------------------------------------------------
try {
    $adminUserIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($roleId in $privilegedRoleIds) {
        Write-Verbose "Checking assignments for role $roleId..."
        try {
            $assignParams = @{
                Method      = 'GET'
                Uri         = "/v1.0/roleManagement/directory/roleAssignments?`$filter=roleDefinitionId eq '$roleId'&`$top=999"
                ErrorAction = 'Stop'
            }
            $assignments = Invoke-MgGraphRequest @assignParams
            if ($assignments -and $assignments['value']) {
                foreach ($a in @($assignments['value'])) {
                    $principalId = $a['principalId']
                    if ($principalId) { [void]$adminUserIds.Add($principalId) }
                }
            }
        }
        catch {
            if ("$_" -match '404|ResourceNotFound|Not Found') {
                Write-Verbose "Role $roleId not present in this tenant — skipping."
            }
            else {
                throw
            }
        }
    }

    if ($adminUserIds.Count -eq 0) {
        $settingParams = @{
            Category         = 'Admin Role Separation'
            Setting          = 'Privileged Account vs Daily-Use Account Separation'
            CurrentValue     = 'No privileged role assignments found'
            RecommendedValue = 'Admin accounts must not have Exchange mailbox service plans'
            Status           = 'Pass'
            CheckId          = 'ENTRA-ADMINROLE-SEPARATION-001'
            Remediation      = 'Assign at least one user to Global Administrator or other privileged roles.'
        }
        Add-Setting @settingParams
        Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra Admin Role Separation'
        return
    }

    # ------------------------------------------------------------------
    # 2. Check each admin user for Exchange Online service plans
    # ------------------------------------------------------------------
    $mixedAccounts = @()

    foreach ($userId in $adminUserIds) {
        Write-Verbose "Checking license details for user $userId..."
        $licParams = @{
            Method      = 'GET'
            Uri         = "/v1.0/users/$userId/licenseDetails"
            ErrorAction = 'Stop'
        }
        try {
            $licDetails = Invoke-MgGraphRequest @licParams
        }
        catch {
            # 404 = service principal or deleted user assigned to the role — skip
            if ("$_" -match '404|ResourceNotFound|Not Found') {
                Write-Verbose "Principal $userId not a user object or no longer exists — skipping license check."
                continue
            }
            throw
        }
        if (-not $licDetails -or -not $licDetails['value']) { continue }

        foreach ($sku in @($licDetails['value'])) {
            $planIds = @($sku['servicePlans'] | ForEach-Object { $_['servicePlanId'] })
            $hasExchange = $planIds | Where-Object { $exchangePlanIds -contains $_ }
            if ($hasExchange) {
                $mixedAccounts += $userId
                break
            }
        }
    }

    $adminCount = $adminUserIds.Count
    if ($mixedAccounts.Count -eq 0) {
        $currentValue = "Admin accounts checked: $adminCount — none have Exchange Online plans"
        $status = 'Pass'
    }
    else {
        $currentValue = "$($mixedAccounts.Count) of $adminCount admin account(s) have Exchange Online mailbox plans"
        $status = 'Fail'
    }

    $settingParams = @{
        Category         = 'Admin Role Separation'
        Setting          = 'Privileged Account vs Daily-Use Account Separation'
        CurrentValue     = $currentValue
        RecommendedValue = 'Admin accounts must not have Exchange mailbox service plans'
        Status           = $status
        CheckId          = 'ENTRA-ADMINROLE-SEPARATION-001'
        Remediation      = 'Create separate cloud-only admin accounts without Exchange Online licenses. Remove mailbox service plan assignments from privileged role accounts. Entra admin center > Users > select admin user > Licenses.'
    }
    Add-Setting @settingParams
}
catch {
    if ("$_" -match '403|Forbidden|Authorization|Ensure the required|service is connected|Access_Denied|Authorization_RequestDenied') {
        $settingParams = @{
            Category         = 'Admin Role Separation'
            Setting          = 'Privileged Account vs Daily-Use Account Separation'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'Admin accounts must not have Exchange mailbox service plans'
            Status           = 'Review'
            CheckId          = 'ENTRA-ADMINROLE-SEPARATION-001'
            Remediation      = 'Requires RoleManagement.Read.Directory and Directory.Read.All permissions. Grant via Entra admin center or reconnect with additional scopes.'
        }
        Add-Setting @settingParams
        Write-Host ''
        Write-Host "    $([char]0x26A0) Missing permission for Admin Role Separation check:" -ForegroundColor Yellow
        Write-Host '      Identity: RoleManagement.Read.Directory' -ForegroundColor Yellow
        Write-Host '    To fix: add the missing permission to your app registration, then grant admin consent.' -ForegroundColor DarkGray
        Write-Host '    Entra ID > App registrations > [your app] > API permissions >' -ForegroundColor DarkGray
        Write-Host '      Add a permission > Microsoft Graph > Application permissions' -ForegroundColor DarkGray
        Write-Host "    Then click 'Grant admin consent for [tenant]' and re-run." -ForegroundColor DarkGray
        Write-Host ''
    }
    else {
        Write-Warning "Could not check admin role separation: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra Admin Role Separation'
