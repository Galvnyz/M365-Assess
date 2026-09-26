# Get-CaPolicies.ps1 — EPIC-015 Conditional Access policy read (SPEC §3.1, §6; T-0281).
#
# Live Graph reads only: policies are never mirrored to disk.
# Emits policy rows with state, targeted users/groups/roles, apps,
# grant/session controls, conditions, and directory modifiedDateTime/modifiedBy.
# The worker is read-only: only GET requests are issued.

function Read-CaPoliciesJob {
    <#
    .SYNOPSIS
        Parses a job envelope JSON for Get-CaPolicies.
    #>
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

    $result = @{
        TenantId     = [string]$json.tenantId
        State        = if ($json.state) { [string]$json.state } else { '' }
        Target       = if ($json.target) { [string]$json.target } else { '' }
        Control      = if ($json.control) { [string]$json.control } else { '' }
        Condition    = if ($json.condition) { [string]$json.condition } else { '' }
        ModifiedDate = if ($json.modifiedDate) { [string]$json.modifiedDate } else { '' }
        Search       = if ($json.search) { [string]$json.search } else { '' }
        Top          = if ($json.top) { [int]$json.top } else { 100 }
        Cursor       = if ($json.cursor) { [string]$json.cursor } else { '' }
    }
    return $result
}

function ConvertTo-CaCursor {
    param([int]$Offset)
    if ($Offset -le 0) { return '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("offset:$Offset")
    return [System.Convert]::ToBase64String($bytes)
}

function ConvertFrom-CaCursor {
    param([string]$Cursor)
    if ([string]::IsNullOrWhiteSpace($Cursor)) { return 0 }
    try {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Cursor))
        if ($decoded -match '^offset:(\d+)$') {
            return [int]$Matches[1]
        }
        return 0
    }
    catch {
        return 0
    }
}

function ConvertTo-CaPolicyRow {
    param(
        [object]$Policy
    )

    $id = if ($Policy.id) { [string]$Policy.id } else { '' }
    $displayName = if ($Policy.displayName) { [string]$Policy.displayName } else { '' }
    $state = if ($Policy.state) { [string]$Policy.state } else { 'disabled' }

    # Users targeted
    $cond = $Policy.conditions
    $users = if ($cond -and $cond.users) { $cond.users } else { $null }
    $includeUsers = if ($users -and $users.includeUsers) { @($users.includeUsers) } else { @() }
    $excludeUsers = if ($users -and $users.excludeUsers) { @($users.excludeUsers) } else { @() }
    $includeGroups = if ($users -and $users.includeGroups) { @($users.includeGroups) } else { @() }
    $excludeGroups = if ($users -and $users.excludeGroups) { @($users.excludeGroups) } else { @() }
    $includeRoles = if ($users -and $users.includeRoles) { @($users.includeRoles) } else { @() }
    $excludeRoles = if ($users -and $users.excludeRoles) { @($users.excludeRoles) } else { @() }

    $targetSummaryParts = @()
    if ($includeUsers -contains 'All') {
        $targetSummaryParts += 'All users'
    }
    elseif ($includeUsers.Count -gt 0) {
        $targetSummaryParts += "$($includeUsers.Count) users"
    }
    if ($includeGroups.Count -gt 0) {
        $targetSummaryParts += "$($includeGroups.Count) groups"
    }
    if ($includeRoles.Count -gt 0) {
        $targetSummaryParts += "$($includeRoles.Count) roles"
    }
    $targetSummary = if ($targetSummaryParts.Count -gt 0) { $targetSummaryParts -join ', ' } else { 'None' }
    if ($excludeUsers.Count -gt 0 -or $excludeGroups.Count -gt 0 -or $excludeRoles.Count -gt 0) {
        $excludeCount = $excludeUsers.Count + $excludeGroups.Count + $excludeRoles.Count
        $targetSummary += " (excludes $excludeCount)"
    }

    $usersTargeted = [pscustomobject]@{
        includeUsers  = $includeUsers
        excludeUsers  = $excludeUsers
        includeGroups = $includeGroups
        excludeGroups = $excludeGroups
        includeRoles  = $includeRoles
        excludeRoles  = $excludeRoles
        summary       = $targetSummary
    }

    # Applications targeted
    $appsObj = if ($cond -and $cond.applications) { $cond.applications } else { $null }
    $includeApps = if ($appsObj -and $appsObj.includeApplications) { @($appsObj.includeApplications) } else { @() }
    $excludeApps = if ($appsObj -and $appsObj.excludeApplications) { @($appsObj.excludeApplications) } else { @() }
    $appSummary = if ($includeApps -contains 'All') {
        'All cloud apps'
    }
    elseif ($includeApps -contains 'Office365') {
        'Office 365'
    }
    elseif ($includeApps.Count -gt 0) {
        "$($includeApps.Count) apps"
    }
    else {
        'None'
    }
    if ($excludeApps.Count -gt 0) {
        $appSummary += " (excludes $($excludeApps.Count))"
    }

    $apps = [pscustomobject]@{
        includeApplications = $includeApps
        excludeApplications = $excludeApps
        summary             = $appSummary
    }

    # Grant controls
    $grant = $Policy.grantControls
    $grantOperator = if ($grant -and $grant.operator) { [string]$grant.operator } else { 'OR' }
    $builtIn = if ($grant -and $grant.builtInControls) { @($grant.builtInControls) } else { @() }
    $authStrength = if ($grant -and $grant.authenticationStrength) { $grant.authenticationStrength } else { $null }

    $controlSummary = 'None'
    if ($builtIn -contains 'block') {
        $controlSummary = 'Block'
    }
    elseif ($builtIn.Count -gt 0) {
        $controlSummary = "Grant: " + ($builtIn -join ", ")
    }
    elseif ($authStrength) {
        $controlSummary = 'Grant: Authentication strength'
    }

    $grantControls = [pscustomobject]@{
        operator               = $grantOperator
        builtInControls        = $builtIn
        authenticationStrength = $authStrength
        summary                = $controlSummary
    }

    # Session controls
    $sessionControls = if ($Policy.sessionControls) { $Policy.sessionControls } else { [pscustomobject]@{} }

    # Conditions detail
    $clientAppTypes = if ($cond -and $cond.clientAppTypes) { @($cond.clientAppTypes) } else { @() }
    $platforms = if ($cond -and $cond.platforms) { $cond.platforms } else { $null }
    $locations = if ($cond -and $cond.locations) { $cond.locations } else { $null }
    $signInRisk = if ($cond -and $cond.signInRiskLevels) { @($cond.signInRiskLevels) } else { @() }
    $userRisk = if ($cond -and $cond.userRiskLevels) { @($cond.userRiskLevels) } else { @() }
    $devices = if ($cond -and $cond.devices) { $cond.devices } else { $null }

    $conditionsSummaryParts = @()
    if ($clientAppTypes.Count -gt 0) { $conditionsSummaryParts += 'Client apps' }
    if ($platforms -and ($platforms.includePlatforms -or $platforms.excludePlatforms)) { $conditionsSummaryParts += 'Platforms' }
    if ($locations -and ($locations.includeLocations -or $locations.excludeLocations)) { $conditionsSummaryParts += 'Locations' }
    if ($signInRisk.Count -gt 0) { $conditionsSummaryParts += 'Sign-in risk' }
    if ($userRisk.Count -gt 0) { $conditionsSummaryParts += 'User risk' }
    if ($devices) { $conditionsSummaryParts += 'Devices' }
    $conditionsSummary = if ($conditionsSummaryParts.Count -gt 0) { $conditionsSummaryParts -join ', ' } else { 'Any' }

    $conditionsRow = [pscustomobject]@{
        clientAppTypes   = $clientAppTypes
        platforms        = $platforms
        locations        = $locations
        signInRiskLevels = $signInRisk
        userRiskLevels   = $userRisk
        devices          = $devices
        summary          = $conditionsSummary
    }

    $createdDateTime = if ($Policy.createdDateTime) { [string]$Policy.createdDateTime } else { $null }
    $modifiedDateTime = if ($Policy.modifiedDateTime) { [string]$Policy.modifiedDateTime } else { $null }
    $modifiedBy = if ($Policy.modifiedBy) {
        [string]$Policy.modifiedBy
    }
    elseif ($Policy.modifiedByUserPrincipalName) {
        [string]$Policy.modifiedByUserPrincipalName
    }
    else {
        $null
    }

    return [pscustomobject]@{
        id               = $id
        name             = $displayName
        displayName      = $displayName
        state            = $state
        usersTargeted    = $usersTargeted
        apps             = $apps
        grantControls    = $grantControls
        sessionControls  = $sessionControls
        conditions       = $conditionsRow
        createdDateTime  = $createdDateTime
        modifiedDateTime = $modifiedDateTime
        modifiedBy       = $modifiedBy
    }
}

function Test-CaPolicyFilter {
    param(
        [object]$Row,
        [string]$State = '',
        [string]$Target = '',
        [string]$Control = '',
        [string]$Condition = '',
        [string]$ModifiedDate = '',
        [string]$Search = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($State)) {
        $s = $State.Trim().ToLowerInvariant()
        $rowState = if ($Row.state) { $Row.state.ToLowerInvariant() } else { '' }
        $matchesState = $false
        if ($s -in @('on', 'enabled')) {
            $matchesState = ($rowState -eq 'enabled')
        }
        elseif ($s -in @('off', 'disabled')) {
            $matchesState = ($rowState -eq 'disabled')
        }
        elseif ($s -in @('report-only', 'reportonly', 'enabledforreportingbutnotenforced')) {
            $matchesState = ($rowState -eq 'enabledforreportingbutnotenforced')
        }
        else {
            $matchesState = ($rowState -eq $s)
        }
        if (-not $matchesState) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($Target)) {
        $t = $Target.Trim().ToLowerInvariant()
        $foundTarget = $false
        if ($Row.usersTargeted.summary -and $Row.usersTargeted.summary.ToLowerInvariant().Contains($t)) { $foundTarget = $true }
        if ($Row.apps.summary -and $Row.apps.summary.ToLowerInvariant().Contains($t)) { $foundTarget = $true }
        foreach ($u in @($Row.usersTargeted.includeUsers + $Row.usersTargeted.excludeUsers + $Row.usersTargeted.includeGroups + $Row.usersTargeted.excludeGroups + $Row.usersTargeted.includeRoles + $Row.usersTargeted.excludeRoles)) {
            if ($u -and $u.ToString().ToLowerInvariant().Contains($t)) { $foundTarget = $true; break }
        }
        foreach ($a in @($Row.apps.includeApplications + $Row.apps.excludeApplications)) {
            if ($a -and $a.ToString().ToLowerInvariant().Contains($t)) { $foundTarget = $true; break }
        }
        if (-not $foundTarget) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($Control)) {
        $c = $Control.Trim().ToLowerInvariant()
        $foundControl = $false
        if ($Row.grantControls.summary -and $Row.grantControls.summary.ToLowerInvariant().Contains($c)) { $foundControl = $true }
        foreach ($ctrl in @($Row.grantControls.builtInControls)) {
            if ($ctrl -and $ctrl.ToString().ToLowerInvariant().Contains($c)) { $foundControl = $true; break }
        }
        if (-not $foundControl) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($Condition)) {
        $cd = $Condition.Trim().ToLowerInvariant()
        $foundCondition = $false
        if ($Row.conditions.summary -and $Row.conditions.summary.ToLowerInvariant().Contains($cd)) { $foundCondition = $true }
        if ($cd -in @('location', 'locations') -and $Row.conditions.locations) { $foundCondition = $true }
        if ($cd -in @('platform', 'platforms') -and $Row.conditions.platforms) { $foundCondition = $true }
        if ($cd -in @('clientapp', 'clientapps', 'clientapptypes') -and $Row.conditions.clientAppTypes.Count -gt 0) { $foundCondition = $true }
        if ($cd -in @('risk', 'signinrisk', 'userrisk') -and ($Row.conditions.signInRiskLevels.Count -gt 0 -or $Row.conditions.userRiskLevels.Count -gt 0)) { $foundCondition = $true }
        if ($cd -in @('device', 'devices') -and $Row.conditions.devices) { $foundCondition = $true }
        if (-not $foundCondition) { return $false }
    }

    if (-not [string]::IsNullOrWhiteSpace($ModifiedDate)) {
        $md = $ModifiedDate.Trim()
        if ([string]::IsNullOrWhiteSpace($Row.modifiedDateTime)) { return $false }
        if (-not $Row.modifiedDateTime.StartsWith($md, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Search)) {
        $searchTerm = $Search.Trim().ToLowerInvariant()
        $nameMatch = ($Row.name -and $Row.name.ToLowerInvariant().Contains($searchTerm))
        $idMatch = ($Row.id -and $Row.id.ToLowerInvariant().Contains($searchTerm))
        if (-not ($nameMatch -or $idMatch)) { return $false }
    }

    return $true
}

function Get-CaPolicies {
    <#
    .SYNOPSIS
        Queries Conditional Access policies live from Graph and projects rows.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [string]$State = '',

        [Parameter()]
        [string]$Target = '',

        [Parameter()]
        [string]$Control = '',

        [Parameter()]
        [string]$Condition = '',

        [Parameter()]
        [string]$ModifiedDate = '',

        [Parameter()]
        [string]$Search = '',

        [Parameter()]
        [ValidateRange(1, 1000)]
        [int]$Top = 100,

        [Parameter()]
        [string]$Cursor = ''
    )

    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/identity/conditionalAccess/policies'
        ErrorAction = 'Stop'
    }

    $response = Invoke-MgGraphRequest @graphParams
    $rawList = @()
    if ($response -and $response['value']) {
        $rawList = @($response['value'])
    }
    elseif ($response -and $response.value) {
        $rawList = @($response.value)
    }

    $allRows = @()
    foreach ($item in $rawList) {
        $allRows += ConvertTo-CaPolicyRow -Policy $item
    }

    $filtered = @()
    foreach ($row in $allRows) {
        if (Test-CaPolicyFilter -Row $row -State $State -Target $Target -Control $Control -Condition $Condition -ModifiedDate $ModifiedDate -Search $Search) {
            $filtered += $row
        }
    }

    $totalCount = $filtered.Count
    $offset = ConvertFrom-CaCursor -Cursor $Cursor
    if ($offset -lt 0) { $offset = 0 }
    if ($offset -gt $totalCount) { $offset = $totalCount }

    $page = @()
    if ($offset -lt $totalCount) {
        $count = [Math]::Min($Top, ($totalCount - $offset))
        $page = $filtered[$offset..($offset + $count - 1)]
    }

    $nextOffset = $offset + $page.Count
    $nextCursor = $null
    if ($nextOffset -lt $totalCount) {
        $nextCursor = ConvertTo-CaCursor -Offset $nextOffset
    }

    return [pscustomobject]@{
        tenantId   = $TenantId
        totalCount = $totalCount
        items      = @($page)
        nextCursor = $nextCursor
    }
}
