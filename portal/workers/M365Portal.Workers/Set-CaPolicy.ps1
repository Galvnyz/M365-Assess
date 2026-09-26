# Set-CaPolicy.ps1 — EPIC-015 Conditional Access CRUD worker (SPEC §4.1, §6, §8, §11.1, §11.2; T-0282).
#
# Covers create, edit, and delete operations for Conditional Access policies.
# Supports DryRun (plan preview mode returning JSON diff without mutating).
# Enforces guardrails: hard-block on 'All users' + 'Block' without break-glass exclusion.
# Enforces report-only as default state for new policies.
# Enforces naming confirmation for deleting enforced policies.
# Captures before/after and emits AuditEvent on every write.

function Read-SetCaPolicyJob {
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
    if (-not $json.action) {
        throw "job envelope '$Path' is missing mandatory 'action'"
    }

    return @{
        TenantId             = [string]$json.tenantId
        Action               = [string]$json.action
        PolicyId             = if ($json.policyId) { [string]$json.policyId } else { '' }
        DisplayName          = if ($json.displayName) { [string]$json.displayName } else { '' }
        State                = if ($json.state) { [string]$json.state } else { '' }
        PolicyJson           = if ($json.policyJson) { [string]$json.policyJson } else { '' }
        ConditionsJson       = if ($json.conditionsJson) { [string]$json.conditionsJson } else { '' }
        GrantControlsJson    = if ($json.grantControlsJson) { [string]$json.grantControlsJson } else { '' }
        SessionControlsJson  = if ($json.sessionControlsJson) { [string]$json.sessionControlsJson } else { '' }
        ConfirmName          = if ($json.confirmName) { [string]$json.confirmName } else { '' }
        DryRun               = [bool]($json.dryRun -eq $true)
    }
}

function Test-CaGuardrails {
    param(
        [hashtable]$Payload
    )

    $conditions = $Payload['conditions']
    $users = if ($conditions -and $conditions['users']) { $conditions['users'] } else { $null }
    $includeUsers = if ($users -and $users['includeUsers']) { @($users['includeUsers']) } else { @() }
    $excludeUsers = if ($users -and $users['excludeUsers']) { @($users['excludeUsers']) } else { @() }
    $excludeGroups = if ($users -and $users['excludeGroups']) { @($users['excludeGroups']) } else { @() }
    $excludeRoles = if ($users -and $users['excludeRoles']) { @($users['excludeRoles']) } else { @() }

    $allUsers = ($includeUsers -contains 'All')

    $grant = $Payload['grantControls']
    $builtIn = if ($grant -and $grant['builtInControls']) { @($grant['builtInControls']) } else { @() }
    $isBlock = ($builtIn | ForEach-Object { $_.ToString().ToLowerInvariant() }) -contains 'block'

    $hasBreakGlass = ($excludeUsers.Count -gt 0) -or ($excludeGroups.Count -gt 0) -or ($excludeRoles.Count -gt 0)

    if ($allUsers -and $isBlock -and (-not $hasBreakGlass)) {
        throw "GuardrailViolation: cannot block All users without an explicit break-glass exclusion"
    }
}

function Build-CaPolicyDiff {
    param(
        [hashtable]$Before,
        [hashtable]$After
    )

    $diff = [System.Collections.Generic.List[string]]::new()
    if ($null -eq $Before -and $null -ne $After) {
        $diff.Add("+ Policy: $($After['displayName']) (State: $($After['state']))")
        $diff.Add("+ Payload: " + ($After | ConvertTo-Json -Depth 5 -Compress))
    }
    elseif ($null -ne $Before -and $null -eq $After) {
        $diff.Add("- Policy: $($Before['displayName']) (State: $($Before['state']))")
    }
    elseif ($null -ne $Before -and $null -ne $After) {
        if ($Before['displayName'] -ne $After['displayName']) {
            $diff.Add("~ displayName: '$($Before['displayName'])' -> '$($After['displayName'])'")
        }
        if ($Before['state'] -ne $After['state']) {
            $diff.Add("~ state: '$($Before['state'])' -> '$($After['state'])'")
        }
        $bJson = $Before | ConvertTo-Json -Depth 5 -Compress
        $aJson = $After | ConvertTo-Json -Depth 5 -Compress
        if ($bJson -ne $aJson) {
            $diff.Add("~ conditions/controls updated")
        }
    }
    return @($diff)
}

function Invoke-SetCaPolicy {
    <#
    .SYNOPSIS
        Executes or previews Conditional Access policy create/edit/delete operations.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('create', 'edit', 'delete')]
        [string]$Action,

        [Parameter()]
        [string]$PolicyId = '',

        [Parameter()]
        [string]$DisplayName = '',

        [Parameter()]
        [string]$State = '',

        [Parameter()]
        [string]$PolicyJson = '',

        [Parameter()]
        [string]$ConditionsJson = '',

        [Parameter()]
        [string]$GrantControlsJson = '',

        [Parameter()]
        [string]$SessionControlsJson = '',

        [Parameter()]
        [string]$ConfirmName = '',

        [Parameter()]
        [bool]$DryRun = $false
    )

    $before = $null
    $after = $null
    $targetName = $DisplayName

    # Parse full policy JSON or assemble payload
    $payload = @{}
    if (-not [string]::IsNullOrWhiteSpace($PolicyJson)) {
        $parsed = $PolicyJson | ConvertFrom-Json -AsHashtable
        foreach ($k in $parsed.Keys) {
            $payload[$k] = $parsed[$k]
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($DisplayName)) {
        $payload['displayName'] = $DisplayName
    }
    if (-not [string]::IsNullOrWhiteSpace($State)) {
        $payload['state'] = $State
    }
    if (-not [string]::IsNullOrWhiteSpace($ConditionsJson)) {
        $payload['conditions'] = ($ConditionsJson | ConvertFrom-Json -AsHashtable)
    }
    if (-not [string]::IsNullOrWhiteSpace($GrantControlsJson)) {
        $payload['grantControls'] = ($GrantControlsJson | ConvertFrom-Json -AsHashtable)
    }
    if (-not [string]::IsNullOrWhiteSpace($SessionControlsJson)) {
        $payload['sessionControls'] = ($SessionControlsJson | ConvertFrom-Json -AsHashtable)
    }

    if ($Action -eq 'create') {
        if (-not $payload.ContainsKey('displayName') -or [string]::IsNullOrWhiteSpace($payload['displayName'])) {
            throw "ValidationFailed: displayName is required for create"
        }
        $targetName = $payload['displayName']
        # Default state to enabledForReportingButNotEnforced (SPEC §11.1)
        if (-not $payload.ContainsKey('state') -or [string]::IsNullOrWhiteSpace($payload['state'])) {
            $payload['state'] = 'enabledForReportingButNotEnforced'
        }
        Test-CaGuardrails -Payload $payload
        $after = $payload
    }
    elseif ($Action -in @('edit', 'delete')) {
        if ([string]::IsNullOrWhiteSpace($PolicyId)) {
            throw "ValidationFailed: policyId is required for $Action"
        }
        $existing = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/policies/$PolicyId"
        if (-not $existing) {
            throw "NotFound: Policy '$PolicyId' not found"
        }
        $before = @{
            id              = [string]$existing.id
            displayName     = [string]$existing.displayName
            state           = [string]$existing.state
            conditions      = $existing.conditions
            grantControls   = $existing.grantControls
            sessionControls = $existing.sessionControls
        }
        $targetName = [string]$existing.displayName

        if ($Action -eq 'edit') {
            # Merge payload on top of before
            $merged = @{}
            foreach ($k in $before.Keys) { $merged[$k] = $before[$k] }
            foreach ($k in $payload.Keys) { $merged[$k] = $payload[$k] }
            Test-CaGuardrails -Payload $merged
            $after = $merged
            $targetName = $merged['displayName']
        }
        elseif ($Action -eq 'delete') {
            # Deleting an enforced policy requires explicit confirmation (SPEC §8)
            $isEnforced = ($before['state'] -eq 'enabled')
            if ($isEnforced) {
                if ([string]::IsNullOrWhiteSpace($ConfirmName) -or ($ConfirmName.Trim() -ne $before['displayName'].Trim())) {
                    throw "ValidationFailed: Deleting an enforced policy requires ConfirmName matching the policy displayName '$($before['displayName'])'."
                }
            }
            $after = $null
        }
    }

    $diff = Build-CaPolicyDiff -Before $before -After $after

    $plan = [pscustomobject]@{
        action               = $Action
        policyId             = if ($PolicyId) { $PolicyId } else { $null }
        targetName           = $targetName
        before               = $before
        after                = $after
        diff                 = $diff
        valid                = $true
        dryRun               = $DryRun
        requiresConfirmation = if ($before -and $before['state'] -eq 'enabled' -and $Action -eq 'delete') { $true } else { $false }
    }

    if ($DryRun) {
        return [pscustomobject]@{
            success = $true
            plan    = $plan
        }
    }

    # Execute mutating call
    $result = $null
    if ($Action -eq 'create') {
        $body = $payload | ConvertTo-Json -Depth 10 -Compress
        $result = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/identity/conditionalAccess/policies' -Body $body
        $PolicyId = if ($result -and $result.id) { [string]$result.id } else { [Guid]::NewGuid().ToString() }
        $plan.policyId = $PolicyId
    }
    elseif ($Action -eq 'edit') {
        $body = $payload | ConvertTo-Json -Depth 10 -Compress
        $result = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identity/conditionalAccess/policies/$PolicyId" -Body $body
    }
    elseif ($Action -eq 'delete') {
        Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/identity/conditionalAccess/policies/$PolicyId"
        $result = @{ deleted = $true }
    }

    $auditEvent = [pscustomobject]@{
        id         = [Guid]::NewGuid().ToString()
        tenantId   = $TenantId
        action     = "ca.policy.$Action"
        targetId   = $PolicyId
        targetName = $targetName
        timestamp  = (Get-Date).ToUniversalTime().ToString('o')
        before     = $before
        after      = $after
    }

    return [pscustomobject]@{
        success    = $true
        plan       = $plan
        result     = $result
        auditEvent = $auditEvent
    }
}
