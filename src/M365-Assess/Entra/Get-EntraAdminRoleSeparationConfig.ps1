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
. (Join-Path -Path $PSScriptRoot -ChildPath '../Common/Invoke-SafeGraphRequest.ps1')


$ErrorActionPreference = 'Stop'

$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings


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

    # Enumerate once: filtering an uninstantiated role can return 404. Expand
    # principals so service principals and groups are not queried as users.
    $assignments = Invoke-SafeGraphRequest -ExpectCollection -Method GET -Uri '/v1.0/roleManagement/directory/roleAssignments?$expand=principal&$top=999'
    foreach ($assignment in $assignments.value) {
        if (-not $assignment.roleDefinitionId) { throw 'Role assignment is missing its role definition.' }
        if ($assignment.roleDefinitionId -notin $privilegedRoleIds) { continue }
        $principal = $assignment.principal
        if (-not $principal.id) { throw 'Privileged role principal could not be resolved.' }
        switch ($principal.'@odata.type') {
            '#microsoft.graph.user' { [void]$adminUserIds.Add($principal.id) }
            '#microsoft.graph.servicePrincipal' { continue }
            '#microsoft.graph.group' {
                $members = Invoke-SafeGraphRequest -ExpectCollection -Method GET -Uri "/v1.0/groups/$($principal.id)/transitiveMembers"
                foreach ($member in $members.value) {
                    if (-not $member.id) { throw 'Privileged group member could not be resolved.' }
                    if ($member.'@odata.type' -eq '#microsoft.graph.user') { [void]$adminUserIds.Add($member.id) }
                    elseif ($member.'@odata.type' -notin @('#microsoft.graph.group', '#microsoft.graph.servicePrincipal', '#microsoft.graph.device')) {
                        throw 'Privileged group member type could not be verified.'
                    }
                }
            }
            default { throw 'Privileged role principal type could not be verified.' }
        }
    }

    if ($adminUserIds.Count -eq 0) {
        $settingParams = @{
            Category         = 'Admin Role Separation'
            Setting          = 'Privileged Account vs Daily-Use Account Separation'
            CurrentValue     = 'No privileged user assignments found'
            RecommendedValue = 'Admin accounts must not have Exchange mailbox service plans'
            Status           = 'Review'
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
        # A failure for a confirmed user is unavailable evidence, never a safe skip.
        $licDetails = Invoke-SafeGraphRequest -ExpectCollection @licParams

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
    Add-Setting -Category 'Admin Role Separation' -Setting 'Privileged Account vs Daily-Use Account Separation' -CurrentValue 'Unable to verify all privileged users' -RecommendedValue 'Admin accounts must not have Exchange mailbox service plans' -Status 'Unknown' -CheckId 'ENTRA-ADMINROLE-SEPARATION-001' -Limitations 'Role assignment, principal membership or license evidence is incomplete.' -Remediation 'Verify role assignments, role-assignable group membership and user licenses in Entra admin center. Review the collection log for the failed request.'
    Write-Warning "Could not check admin role separation: $_"
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra Admin Role Separation'
