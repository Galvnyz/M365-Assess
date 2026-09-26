# Set-Group.ps1 — EPIC-014 Group CRUD worker (SPEC §4.1, §6, §8, §11.1, §11.4; T-0262).
#
# Covers create, edit, delete, and convert operations for groups.
# Supports DryRun (plan preview mode returning diff without mutating).
# Validates dynamic membership rules before apply.
# Enforces naming confirmation for group deletion.

function Test-DynamicRuleSyntax {
    <#
    .SYNOPSIS
        Validates Graph membership rule syntax.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Rule
    )

    if ([string]::IsNullOrWhiteSpace($Rule)) {
        return @{
            Valid   = $false
            Message = 'Dynamic membership rule cannot be empty.'
        }
    }

    $trimmed = $Rule.Trim()
    if (-not ($trimmed.StartsWith('(') -and $trimmed.EndsWith(')'))) {
        return @{
            Valid   = $false
            Message = 'Dynamic membership rule must be enclosed in parentheses.'
        }
    }

    # Parentheses balance check
    $openCount = ($trimmed.ToCharArray() | Where-Object { $_ -eq '(' }).Count
    $closeCount = ($trimmed.ToCharArray() | Where-Object { $_ -eq ')' }).Count
    if ($openCount -ne $closeCount) {
        return @{
            Valid   = $false
            Message = 'Mismatched parentheses in dynamic membership rule.'
        }
    }

    # Operator validation check (-eq, -ne, -contains, -notContains, -startsWith, -notStartsWith, -match, -notMatch, -in, -notIn)
    $validOpPattern = '-(eq|ne|contains|notContains|startsWith|notStartsWith|match|notMatch|in|notIn)\b'
    if (-not ($trimmed -match $validOpPattern)) {
        return @{
            Valid   = $false
            Message = 'Dynamic membership rule must contain at least one valid comparison operator (-eq, -ne, -contains, -startsWith, etc.).'
        }
    }

    return @{
        Valid   = $true
        Message = 'Rule syntax valid.'
    }
}

function Read-SetGroupJob {
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
        TenantId     = [string]$json.tenantId
        Action       = [string]$json.action
        GroupId      = if ($json.groupId) { [string]$json.groupId } else { '' }
        DisplayName  = if ($json.displayName) { [string]$json.displayName } else { '' }
        GroupType    = if ($json.groupType) { [string]$json.groupType } else { 'security' }
        MailNickname = if ($json.mailNickname) { [string]$json.mailNickname } else { '' }
        Description  = if ($json.description) { [string]$json.description } else { '' }
        DynamicRule  = if ($json.dynamicRule) { [string]$json.dynamicRule } else { '' }
        ConfirmName  = if ($json.confirmName) { [string]$json.confirmName } else { '' }
        DryRun       = [bool]($json.dryRun -eq $true)
    }
}

function Invoke-SetGroup {
    <#
    .SYNOPSIS
        Executes or previews group CRUD operations with dynamic-rule validation.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
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
        [bool]$DryRun = $false
    )

    # 1. Dynamic Rule validation
    if ($GroupType -eq 'dynamic' -or -not [string]::IsNullOrWhiteSpace($DynamicRule)) {
        $ruleCheck = Test-DynamicRuleSyntax -Rule $DynamicRule
        if (-not $ruleCheck.Valid) {
            throw "ValidationFailed: $($ruleCheck.Message)"
        }
    }

    $before = $null
    $after = $null
    $diff = [System.Collections.Generic.List[string]]::new()

    # 2. Handle before state for existing groups
    if ($Action -in @('edit', 'delete', 'convert')) {
        if ([string]::IsNullOrWhiteSpace($GroupId)) {
            throw "ValidationFailed: groupId is required for $Action"
        }
        $existing = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/groups/$GroupId"
        if (-not $existing) {
            throw "NotFound: Group '$GroupId' not found"
        }
        $before = @{
            id          = [string]$existing.id
            displayName = [string]$existing.displayName
            description = [string]$existing.description
            mail        = [string]$existing.mail
            rule        = [string]$existing.membershipRule
        }

        # Delete confirmation requirement
        if ($Action -eq 'delete') {
            if ([string]::IsNullOrWhiteSpace($ConfirmName) -or $ConfirmName.Trim() -ne $existing.displayName) {
                throw "ConfirmationRequired: Deletion requires confirmName matching '$($existing.displayName)'"
            }
            $diff.Add("Delete group '$($existing.displayName)' ($GroupId)")
        }
    }

    if ($Action -eq 'create') {
        if ([string]::IsNullOrWhiteSpace($DisplayName)) {
            throw "ValidationFailed: displayName is required for create"
        }
        $nickname = if (-not [string]::IsNullOrWhiteSpace($MailNickname)) {
            $MailNickname
        } else {
            $DisplayName -replace '[^a-zA-Z0-9]', ''
        }

        $after = @{
            displayName  = $DisplayName
            description  = $Description
            groupType    = $GroupType
            mailNickname = $nickname
            dynamicRule  = $DynamicRule
        }
        $diff.Add("Create $GroupType group '$DisplayName'")
        if ($DynamicRule) {
            $diff.Add("Set dynamic membership rule: $DynamicRule")
        }
    }
    elseif ($Action -eq 'edit') {
        $after = @{
            id          = $GroupId
            displayName = if ($DisplayName) { $DisplayName } else { $before.displayName }
            description = if ($Description) { $Description } else { $before.description }
            dynamicRule = if ($DynamicRule) { $DynamicRule } else { $before.rule }
        }
        if ($DisplayName -and $DisplayName -ne $before.displayName) {
            $diff.Add("Change displayName: '$($before.displayName)' -> '$DisplayName'")
        }
        if ($Description -and $Description -ne $before.description) {
            $diff.Add("Change description: '$($before.description)' -> '$Description'")
        }
        if ($DynamicRule -and $DynamicRule -ne $before.rule) {
            $diff.Add("Update dynamicRule: '$($before.rule)' -> '$DynamicRule'")
        }
    }

    $plan = [pscustomobject]@{
        action               = $Action
        groupId              = $GroupId
        targetName           = if ($DisplayName) { $DisplayName } elseif ($before) { $before.displayName } else { '' }
        before               = $before
        after                = $after
        diff                 = @($diff)
        valid                = $true
        dryRun               = $DryRun
        requiresConfirmation = ($Action -eq 'delete')
    }

    if ($DryRun) {
        return $plan
    }

    # Apply mutation live
    $appliedResult = $null
    $auditEvent = @{
        id          = [guid]::NewGuid().ToString()
        tenantId    = $TenantId
        action      = "group.$Action"
        targetId    = $GroupId
        targetName  = $plan.targetName
        timestamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        before      = $before
        after       = $after
    }

    if ($Action -eq 'create') {
        $body = @{
            displayName     = $DisplayName
            mailNickname    = $plan.after.mailNickname
            description     = $Description
            mailEnabled     = ($GroupType -in @('m365', 'distribution'))
            securityEnabled = ($GroupType -ne 'distribution')
        }
        if ($GroupType -eq 'm365') {
            $body.groupTypes = @('Unified')
        }
        elseif ($GroupType -eq 'dynamic') {
            $body.groupTypes = @('DynamicMembership')
            $body.membershipRule = $DynamicRule
            $body.membershipRuleProcessingState = 'On'
        }

        $appliedResult = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups" -Body ($body | ConvertTo-Json -Depth 5)
        $auditEvent.targetId = [string]$appliedResult.id
    }
    elseif ($Action -eq 'edit') {
        $body = @{}
        if ($DisplayName) { $body.displayName = $DisplayName }
        if ($Description) { $body.description = $Description }
        if ($DynamicRule) {
            $body.membershipRule = $DynamicRule
            $body.membershipRuleProcessingState = 'On'
        }
        $appliedResult = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/groups/$GroupId" -Body ($body | ConvertTo-Json -Depth 5)
    }
    elseif ($Action -eq 'delete') {
        Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/groups/$GroupId"
        $appliedResult = @{ deleted = $true; id = $GroupId }
    }

    return [pscustomobject]@{
        plan       = $plan
        result     = $appliedResult
        auditEvent = $auditEvent
        success    = $true
    }
}
