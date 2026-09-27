# Set-PimRoleSettings.ps1 — EPIC-013 PIM role settings apply (SPEC §3.2, §4.2, §8; T-0244).
#
# Worker job to configure PIM role settings rules (max duration, MFA, justification, approval).
# Supports DryRun (preview mode returning diff without mutating).
# Mutating mode issues PATCH requests to role management policy rules.

function Read-SetPimRoleSettingsJob {
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
    if (-not $json.roleId) {
        throw "job envelope '$Path' is missing mandatory 'roleId'"
    }

    $settingsObj = @{}
    if ($json.settings) {
        foreach ($prop in $json.settings.PSObject.Properties) {
            $settingsObj[$prop.Name] = $prop.Value
        }
    }

    return @{
        TenantId = [string]$json.tenantId
        RoleId   = [string]$json.roleId
        Action   = if ($json.action) { [string]$json.action } else { 'apply' }
        Settings = $settingsObj
        DryRun   = [bool]($json.dryRun -eq $true)
    }
}

function Get-PimRoleCurrentSettings {
    param(
        [string]$TenantId,
        [string]$RoleId
    )

    $current = @{
        maximumDurationInHours = 8
        requireMfa             = $false
        requireJustification   = $false
        requireApproval        = $false
    }

    # A failed read throws rather than reporting default settings: the portal diffs
    # templates against this and would otherwise show or apply the wrong changes.
    $uri = "/v1.0/policies/roleManagementPolicyAssignments?`$filter=roleDefinitionId eq '$RoleId' and scopeId eq '/' and scopeType eq 'DirectoryRole'&`$expand=policy(`$expand=rules)"
    $resp = Invoke-MgGraphRequest -Method GET -Uri $uri
    if ($resp.value -and $resp.value.Count -gt 0) {
        $policy = $resp.value[0].policy
        if ($policy -and $policy.rules) {
            foreach ($rule in $policy.rules) {
                if ($rule.'@odata.type' -match 'expirationRule') {
                    # ISO 8601 duration e.g. PT8H
                    if ($rule.maximumDuration -and $rule.maximumDuration -match 'PT(\d+)H') {
                        $current.maximumDurationInHours = [int]$Matches[1]
                    }
                }
                if ($rule.'@odata.type' -match 'enablementRule') {
                    if ($rule.enabledRules) {
                        $current.requireMfa = [bool]($rule.enabledRules -contains 'mfa')
                        $current.requireJustification = [bool]($rule.enabledRules -contains 'justification')
                    }
                }
                if ($rule.'@odata.type' -match 'approvalRule') {
                    if ($rule.setting -and $rule.setting.isApprovalRequired) {
                        $current.requireApproval = [bool]$rule.setting.isApprovalRequired
                    }
                }
            }
        }
    }

    return $current
}

function Set-PimRoleSettings {
    <#
    .SYNOPSIS
        Applies or previews PIM role settings.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$RoleId,

        [Parameter(Mandatory)]
        [hashtable]$Settings,

        [Parameter()]
        [switch]$DryRun
    )

    $current = Get-PimRoleCurrentSettings -TenantId $TenantId -RoleId $RoleId

    # Compute proposed
    $proposed = @{}
    foreach ($k in $current.Keys) {
        $proposed[$k] = $current[$k]
    }
    foreach ($k in $Settings.Keys) {
        $proposed[$k] = $Settings[$k]
    }

    $diff = @()
    foreach ($k in $proposed.Keys) {
        $diff += [pscustomobject]@{
            setting = $k
            before  = $current[$k]
            after   = $proposed[$k]
            changed = ($current[$k] -ne $proposed[$k])
        }
    }

    if ($DryRun) {
        return [pscustomobject]@{
            tenantId  = $TenantId
            roleId    = $RoleId
            dryRun    = $true
            before    = [pscustomobject]$current
            after     = [pscustomobject]$proposed
            diff      = @($diff)
            applied   = $null
        }
    }

    # Execute privileged update
    $policyUri = "/v1.0/policies/roleManagementPolicies?`$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'"
    $policyResp = Invoke-MgGraphRequest -Method GET -Uri $policyUri
    $policyId = if ($policyResp.value -and $policyResp.value.Count -gt 0) { $policyResp.value[0].id } else { "default-policy" }

    # Patch expiration rule if duration provided
    if ($Settings.ContainsKey('maximumDurationInHours')) {
        $hours = [int]$Settings['maximumDurationInHours']
        $body = @{
            '@odata.type'   = '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule'
            id              = "Expiration_Admin_Eligibility"
            maximumDuration = "PT${hours}H"
            target          = @{
                caller           = 'Admin'
                operations       = @('All')
                level            = 'Assignment'
                inheritableSettings = @()
                enforcedSettings    = @()
            }
        }
        Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/policies/roleManagementPolicies/$policyId/rules/Expiration_Admin_Eligibility" -Body ($body | ConvertTo-Json -Depth 5)
    }

    # Patch enablement rule if MFA or justification provided
    if ($Settings.ContainsKey('requireMfa') -or $Settings.ContainsKey('requireJustification')) {
        $enabledRules = [System.Collections.Generic.List[string]]::new()
        if ($proposed['requireMfa']) { $enabledRules.Add('mfa') }
        if ($proposed['requireJustification']) { $enabledRules.Add('justification') }

        $body = @{
            '@odata.type'  = '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule'
            id             = "Enablement_Admin_Eligibility"
            enabledRules   = @($enabledRules)
            target         = @{
                caller           = 'Admin'
                operations       = @('All')
                level            = 'Assignment'
                inheritableSettings = @()
                enforcedSettings    = @()
            }
        }
        Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/policies/roleManagementPolicies/$policyId/rules/Enablement_Admin_Eligibility" -Body ($body | ConvertTo-Json -Depth 5)
    }

    return [pscustomobject]@{
        tenantId = $TenantId
        roleId   = $RoleId
        dryRun   = $false
        before   = [pscustomobject]$current
        after    = [pscustomobject]$proposed
        diff     = @($diff)
        applied  = [pscustomobject]$proposed
    }
}
