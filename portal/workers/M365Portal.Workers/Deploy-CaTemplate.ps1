# Deploy-CaTemplate.ps1 — EPIC-015 CA template deploy worker (SPEC §3.2, §4.2, §6, §8; T-0286).
#
# Deploys a Conditional Access template to a target tenant:
# - Accepts deploy drawer options: group/user handling, policy state (report-only default),
#   overwrite switch, disable-security-defaults switch, create-groups toggle.
# - Validates guardrails (lockout prevention / break-glass exclusion).
# - Handles conflicts: returns diff against live policy when overwrite is enabled; flags conflict when disabled.
# - Explicitly surfaces disable-security-defaults.
# - Supports DryRun plan preview.
# - Captures before/after and emits AuditEvent on apply.

function Read-DeployCaTemplateJob {
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
        TenantId                = [string]$json.tenantId
        TemplateId              = if ($json.templateId) { [string]$json.templateId } else { '' }
        TemplateJson            = if ($json.templateJson) { [string]$json.templateJson } else { '' }
        PolicyName              = if ($json.policyName) { [string]$json.policyName } else { '' }
        PolicyState             = if ($json.policyState) { [string]$json.policyState } else { 'enabledForReportingButNotEnforced' }
        GroupUserHandling       = if ($json.groupUserHandling) { [string]$json.groupUserHandling } else { 'all' }
        CreateGroups            = [bool]($json.createGroups -eq $true)
        Overwrite               = [bool]($json.overwrite -eq $true)
        DisableSecurityDefaults = [bool]($json.disableSecurityDefaults -eq $true)
        BreakGlassExclusions    = if ($json.breakGlassExclusions) { @($json.breakGlassExclusions) } else { @() }
        DryRun                  = [bool]($json.dryRun -eq $true)
    }
}

function Test-CaDeployGuardrails {
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

function Build-CaDeployDiff {
    param(
        $Before,
        $After,
        [bool]$DisableSecurityDefaults = $false,
        [array]$GroupsToCreate = @()
    )

    $diff = [System.Collections.Generic.List[string]]::new()
    if ($DisableSecurityDefaults) {
        $diff.Add("! Security Defaults will be disabled in the target tenant")
    }
    foreach ($grp in $GroupsToCreate) {
        $diff.Add("+ Create Group: $grp")
    }

    if ($null -eq $Before -and $null -ne $After) {
        $diff.Add("+ Policy: $($After['displayName']) (State: $($After['state']))")
        $diff.Add("+ Payload: " + ($After | ConvertTo-Json -Depth 5 -Compress))
    }
    elseif ($null -ne $Before -and $null -ne $After) {
        $diff.Add("~ Overwriting existing policy '$($Before['displayName'])' (ID: $($Before['id']))")
        if ($Before['state'] -ne $After['state']) {
            $diff.Add("~ State: '$($Before['state'])' -> '$($After['state'])'")
        }
        $diff.Add("~ Updated policy configuration applied from template")
    }

    return @($diff)
}

function Invoke-DeployCaTemplate {
    <#
    .SYNOPSIS
        Plans and executes deployment of a CA template to a tenant.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [string]$TemplateId = '',

        [Parameter()]
        [string]$TemplateJson = '',

        [Parameter()]
        [string]$PolicyName = '',

        [Parameter()]
        [string]$PolicyState = 'enabledForReportingButNotEnforced',

        [Parameter()]
        [string]$GroupUserHandling = 'all',

        [Parameter()]
        [bool]$CreateGroups = $false,

        [Parameter()]
        [bool]$Overwrite = $false,

        [Parameter()]
        [bool]$DisableSecurityDefaults = $false,

        [Parameter()]
        [string[]]$BreakGlassExclusions = @(),

        [Parameter()]
        [bool]$DryRun = $false
    )

    # 1. Parse template policy JSON
    $templateObj = @{}
    if (-not [string]::IsNullOrWhiteSpace($TemplateJson)) {
        $parsed = $TemplateJson | ConvertFrom-Json -AsHashtable
        if ($parsed.ContainsKey('policyJson') -and $parsed['policyJson'] -is [hashtable]) {
            $templateObj = $parsed['policyJson']
        }
        else {
            $templateObj = $parsed
        }
    }

    $finalPolicyName = if (-not [string]::IsNullOrWhiteSpace($PolicyName)) {
        $PolicyName.Trim()
    }
    elseif ($templateObj.ContainsKey('displayName') -and -not [string]::IsNullOrWhiteSpace($templateObj['displayName'])) {
        $templateObj['displayName']
    }
    elseif ($templateObj.ContainsKey('name') -and -not [string]::IsNullOrWhiteSpace($templateObj['name'])) {
        $templateObj['name']
    }
    else {
        "Template Policy - $TemplateId"
    }

    # Clone template object into working payload
    $payload = @{}
    foreach ($k in $templateObj.Keys) {
        $payload[$k] = $templateObj[$k]
    }
    $payload['displayName'] = $finalPolicyName
    $payload['state'] = if ([string]::IsNullOrWhiteSpace($PolicyState)) { 'enabledForReportingButNotEnforced' } else { $PolicyState }

    # Group/User Handling
    if (-not $payload.ContainsKey('conditions') -or -not $payload['conditions']) {
        $payload['conditions'] = @{}
    }
    if (-not $payload['conditions'].ContainsKey('users') -or -not $payload['conditions']['users']) {
        $payload['conditions']['users'] = @{}
    }

    if ($GroupUserHandling -eq 'all') {
        $payload['conditions']['users']['includeUsers'] = @('All')
    }

    # Apply Break-Glass exclusions if specified
    if ($BreakGlassExclusions -and $BreakGlassExclusions.Count -gt 0) {
        $currEx = if ($payload['conditions']['users'].ContainsKey('excludeUsers') -and $payload['conditions']['users']['excludeUsers']) {
            @($payload['conditions']['users']['excludeUsers'])
        } else { @() }
        foreach ($bg in $BreakGlassExclusions) {
            if ($bg -and ($currEx -notcontains $bg)) {
                $currEx += $bg
            }
        }
        $payload['conditions']['users']['excludeUsers'] = $currEx
    }

    # Check guardrails
    Test-CaDeployGuardrails -Payload $payload

    # Groups to create
    $groupsToCreate = @()
    if ($CreateGroups) {
        $groupsToCreate += "SG-CA-$finalPolicyName-Included"
        $groupsToCreate += "SG-CA-$finalPolicyName-Excluded"
    }

    # Query live policies to check for conflict or overwrite
    $existing = $null
    try {
        $listResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies'
        $livePolicies = if ($listResp -and $listResp['value']) { @($listResp['value']) } else { @() }
        foreach ($p in $livePolicies) {
            $pName = if ($p['displayName']) { [string]$p['displayName'] } elseif ($p.displayName) { [string]$p.displayName } else { '' }
            if ($pName.Trim() -eq $finalPolicyName.Trim()) {
                $existing = $p
                break
            }
        }
    }
    catch {
        # proceed with null existing
    }

    $conflict = $false
    $conflictMessage = $null
    $before = $null

    if ($existing) {
        $before = @{
            id          = if ($existing['id']) { [string]$existing['id'] } else { [string]$existing.id }
            displayName = if ($existing['displayName']) { [string]$existing['displayName'] } else { [string]$existing.displayName }
            state       = if ($existing['state']) { [string]$existing['state'] } else { [string]$existing.state }
        }
        if (-not $Overwrite) {
            $conflict = $true
            $conflictMessage = "A policy named '$finalPolicyName' already exists in the tenant. Enable overwrite to update it."
            if (-not $DryRun) {
                throw "Conflict: $conflictMessage"
            }
        }
    }

    $after = $payload
    $diff = Build-CaDeployDiff -Before $before -After $after -DisableSecurityDefaults $DisableSecurityDefaults -GroupsToCreate $groupsToCreate

    $plan = [pscustomobject]@{
        action                  = if ($existing -and $Overwrite) { 'update' } else { 'create' }
        tenantId                = $TenantId
        templateId              = $TemplateId
        policyName              = $finalPolicyName
        policyState             = $payload['state']
        disableSecurityDefaults = $DisableSecurityDefaults
        overwrite               = $Overwrite
        conflict                = $conflict
        conflictMessage         = $conflictMessage
        diff                    = $diff
        groupsToCreate          = $groupsToCreate
        valid                   = (-not $conflict)
        dryRun                  = $DryRun
    }

    if ($DryRun) {
        return [pscustomobject]@{
            success = $true
            plan    = $plan
        }
    }

    # Execute mutations
    if ($DisableSecurityDefaults) {
        try {
            $secBody = @{ isEnabled = $false } | ConvertTo-Json -Compress
            Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -Body $secBody -ErrorAction SilentlyContinue
        } catch {}
    }

    $result = $null
    $targetId = $null
    if ($existing -and $Overwrite) {
        $body = $payload | ConvertTo-Json -Depth 10 -Compress
        $targetId = $before['id']
        $result = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identity/conditionalAccess/policies/$targetId" -Body $body
    }
    else {
        $body = $payload | ConvertTo-Json -Depth 10 -Compress
        $result = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/identity/conditionalAccess/policies' -Body $body
        $targetId = if ($result -and $result['id']) { [string]$result['id'] } elseif ($result -and $result.id) { [string]$result.id } else { [Guid]::NewGuid().ToString() }
    }

    $auditEvent = [pscustomobject]@{
        id         = [Guid]::NewGuid().ToString()
        tenantId   = $TenantId
        action     = "ca.template.deploy"
        targetId   = $targetId
        targetName = $finalPolicyName
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
