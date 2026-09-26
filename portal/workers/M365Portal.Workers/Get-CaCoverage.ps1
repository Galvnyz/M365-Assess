# Get-CaCoverage.ps1 — EPIC-015 Conditional Access Coverage Evaluation worker (SPEC §3.1, §4.4, §6; T-0290).
#
# Computes which users and applications are covered by at least one active Conditional Access policy,
# and identifies concrete gaps (unprotected accounts and cloud apps).
# Live Graph reads only: no changes or mirror writes are performed.

function Read-CaCoverageJob {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }

    return @{
        TenantId = [string]$json.tenantId
    }
}

function Get-CaCoverage {
    <#
    .SYNOPSIS
        Evaluates Conditional Access policy coverage against tenant users and apps.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId
    )

    # 1. Fetch Conditional Access policies
    $policiesResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
    $rawPolicies = @()
    if ($policiesResp -and $policiesResp['value']) {
        $rawPolicies = @($policiesResp['value'])
    }
    elseif ($policiesResp -and $policiesResp.value) {
        $rawPolicies = @($policiesResp.value)
    }

    # Focus on enabled policies (or report-only annotated)
    $activePolicies = @()
    foreach ($p in $rawPolicies) {
        $st = if ($p['state']) { [string]$p['state'] } else { [string]$p.state }
        if ($st -eq 'enabled') {
            $activePolicies += $p
        }
    }

    # 2. Fetch users
    $rawUsers = @()
    try {
        $usersResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/users?$top=200&$select=id,displayName,userPrincipalName,userType' -ErrorAction Stop
        if ($usersResp -and $usersResp['value']) {
            $rawUsers = @($usersResp['value'])
        }
        elseif ($usersResp -and $usersResp.value) {
            $rawUsers = @($usersResp.value)
        }
    }
    catch {
        Write-Warning "Could not query users for coverage: $_"
    }

    # 3. Fetch applications / service principals
    $rawApps = @()
    try {
        $appsResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/servicePrincipals?$top=200&$select=id,appId,displayName' -ErrorAction Stop
        if ($appsResp -and $appsResp['value']) {
            $rawApps = @($appsResp['value'])
        }
        elseif ($appsResp -and $appsResp.value) {
            $rawApps = @($appsResp.value)
        }
    }
    catch {
        Write-Warning "Could not query service principals for coverage: $_"
    }

    # 4. Check user coverage
    $coveredUsers = @()
    $uncoveredUsers = @()

    foreach ($u in $rawUsers) {
        $userId = if ($u['id']) { [string]$u['id'] } else { [string]$u.id }
        $uName = if ($u['displayName']) { [string]$u['displayName'] } else { [string]$u.displayName }
        $upn = if ($u['userPrincipalName']) { [string]$u['userPrincipalName'] } else { [string]$u.userPrincipalName }
        $userType = if ($u['userType']) { [string]$u['userType'] } elseif ($u.userType) { [string]$u.userType } else { 'Member' }

        $matchingPolicies = @()

        foreach ($p in $activePolicies) {
            $cond = if ($p['conditions']) { $p['conditions'] } else { $p.conditions }
            if (-not $cond) { continue }
            $usersCond = if ($cond['users']) { $cond['users'] } else { $cond.users }
            if (-not $usersCond) { continue }

            $incUsers = if ($usersCond['includeUsers']) { @($usersCond['includeUsers']) } elseif ($usersCond.includeUsers) { @($usersCond.includeUsers) } else { @() }
            $excUsers = if ($usersCond['excludeUsers']) { @($usersCond['excludeUsers']) } elseif ($usersCond.excludeUsers) { @($usersCond.excludeUsers) } else { @() }

            # If user is explicitly excluded, policy does not cover them
            if ($excUsers -contains $userId -or $excUsers -contains $upn) {
                continue
            }

            # If policy includes 'All' or user specifically
            $isIncluded = ($incUsers -contains 'All' -or $incUsers -contains $userId -or $incUsers -contains $upn)
            if ($isIncluded) {
                $matchingPolicies += [pscustomobject]@{
                    id          = if ($p['id']) { [string]$p['id'] } else { [string]$p.id }
                    displayName = if ($p['displayName']) { [string]$p['displayName'] } else { [string]$p.displayName }
                }
            }
        }

        if ($matchingPolicies.Count -gt 0) {
            $coveredUsers += [pscustomobject]@{
                id                = $userId
                displayName       = $uName
                userPrincipalName = $upn
                userType          = $userType
                policies          = @($matchingPolicies)
            }
        }
        else {
            $uncoveredUsers += [pscustomobject]@{
                id                = $userId
                displayName       = $uName
                userPrincipalName = $upn
                userType          = $userType
                reason            = 'No active Conditional Access policy targets this user'
            }
        }
    }

    # 5. Check app coverage
    $coveredApps = @()
    $uncoveredApps = @()

    foreach ($app in $rawApps) {
        $appId = if ($app['appId']) { [string]$app['appId'] } else { [string]$app.appId }
        $appDisplayName = if ($app['displayName']) { [string]$app['displayName'] } else { [string]$app.displayName }

        $matchingAppPolicies = @()

        foreach ($p in $activePolicies) {
            $cond = if ($p['conditions']) { $p['conditions'] } else { $p.conditions }
            if (-not $cond) { continue }
            $appsCond = if ($cond['applications']) { $cond['applications'] } else { $cond.applications }
            if (-not $appsCond) { continue }

            $incApps = if ($appsCond['includeApplications']) { @($appsCond['includeApplications']) } elseif ($appsCond.includeApplications) { @($appsCond.includeApplications) } else { @() }
            $excApps = if ($appsCond['excludeApplications']) { @($appsCond['excludeApplications']) } elseif ($appsCond.excludeApplications) { @($appsCond.excludeApplications) } else { @() }

            if ($excApps -contains $appId) { continue }

            if ($incApps -contains 'All' -or $incApps -contains $appId -or ($incApps -contains 'Office365' -and $appDisplayName -match 'Office 365|Exchange|SharePoint|Teams')) {
                $matchingAppPolicies += [pscustomobject]@{
                    id          = if ($p['id']) { [string]$p['id'] } else { [string]$p.id }
                    displayName = if ($p['displayName']) { [string]$p['displayName'] } else { [string]$p.displayName }
                }
            }
        }

        if ($matchingAppPolicies.Count -gt 0) {
            $coveredApps += [pscustomobject]@{
                appId       = $appId
                displayName = $appDisplayName
                policies    = @($matchingAppPolicies)
            }
        }
        else {
            $uncoveredApps += [pscustomobject]@{
                appId       = $appId
                displayName = $appDisplayName
                reason      = 'No active Conditional Access policy targets this cloud application'
            }
        }
    }

    # 6. Gaps compilation
    $gaps = @()
    $uncoveredGuestUsers = @($uncoveredUsers | Where-Object { $_.userType -eq 'Guest' })
    if ($uncoveredGuestUsers.Count -gt 0) {
        $gaps += [pscustomobject]@{
            category    = 'Guest Accounts'
            severity    = 'high'
            title       = "$($uncoveredGuestUsers.Count) guest account(s) not covered by any active policy"
            description = "External and guest accounts without MFA or location boundaries represent an elevated threat vector."
            count       = $uncoveredGuestUsers.Count
        }
    }

    $uncoveredMemberUsers = @($uncoveredUsers | Where-Object { $_.userType -ne 'Guest' })
    if ($uncoveredMemberUsers.Count -gt 0) {
        $gaps += [pscustomobject]@{
            category    = 'Member Users'
            severity    = 'high'
            title       = "$($uncoveredMemberUsers.Count) user account(s) have zero policy coverage"
            description = "Users not encompassed by any Conditional Access policy can authenticate without baseline controls."
            count       = $uncoveredMemberUsers.Count
        }
    }

    if ($uncoveredApps.Count -gt 0) {
        $gaps += [pscustomobject]@{
            category    = 'Cloud Apps'
            severity    = 'medium'
            title       = "$($uncoveredApps.Count) cloud application(s) unprotected"
            description = "Applications excluded or omitted from policy scope allow sessions without grant requirements."
            count       = $uncoveredApps.Count
        }
    }

    $totalUsers = $coveredUsers.Count + $uncoveredUsers.Count
    $userPct = if ($totalUsers -gt 0) { [Math]::Round(($coveredUsers.Count / $totalUsers) * 100, 1) } else { 100 }

    $totalAppsCount = $coveredApps.Count + $uncoveredApps.Count
    $appPct = if ($totalAppsCount -gt 0) { [Math]::Round(($coveredApps.Count / $totalAppsCount) * 100, 1) } else { 100 }

    return [pscustomobject]@{
        tenantId            = $TenantId
        summary             = [pscustomobject]@{
            totalUsers         = $totalUsers
            coveredUsersCount  = $coveredUsers.Count
            uncoveredUsersCount = $uncoveredUsers.Count
            userCoveragePct    = $userPct
            totalApps          = $totalAppsCount
            coveredAppsCount   = $coveredApps.Count
            uncoveredAppsCount = $uncoveredApps.Count
            appCoveragePct     = $appPct
            activePoliciesCount = $activePolicies.Count
            totalGapsCount     = $gaps.Count
        }
        gaps                = @($gaps)
        coveredUsers        = @($coveredUsers)
        uncoveredUsers      = @($uncoveredUsers)
        coveredApps         = @($coveredApps)
        uncoveredApps       = @($uncoveredApps)
    }
}
