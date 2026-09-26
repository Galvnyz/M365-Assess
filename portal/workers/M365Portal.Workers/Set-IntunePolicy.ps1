# Set-IntunePolicy.ps1 — EPIC-016 Intune policy CRUD worker (SPEC §4.1, §6, §8; T-0302).
#
# Supports create/edit/delete of Intune configuration and compliance policies.
# Validates against the T-0301 registry (kind must be supported).
# create/edit return a plan (settings diff + assignment changes) before apply.
# delete requires naming confirmation for enforced/assigned policies.
# Every write emits an audit event.

function Read-IntunePolicyCrudJob {
    <#
    .SYNOPSIS
        Parses a job envelope JSON for Set-IntunePolicy.
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

    $raw  = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json -AsHashtable

    if (-not $json['tenantId']) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }
    if (-not $json['kind']) {
        throw "job envelope '$Path' is missing mandatory 'kind'"
    }
    if (-not $json['action']) {
        throw "job envelope '$Path' is missing mandatory 'action'"
    }

    $validKinds    = @('configuration', 'compliance')
    $validActions  = @('create', 'edit', 'delete')

    if ($validKinds -notcontains $json['kind']) {
        throw "job envelope '$Path' has unsupported kind '$($json['kind'])'; valid: $($validKinds -join ', ')"
    }
    if ($validActions -notcontains $json['action']) {
        throw "job envelope '$Path' has unknown action '$($json['action'])'; valid: $($validActions -join ', ')"
    }

    return @{
        TenantId      = [string]$json['tenantId']
        Kind          = [string]$json['kind']
        Action        = [string]$json['action']
        PolicyId      = if ($json['policyId']) { [string]$json['policyId'] } else { '' }
        DisplayName   = if ($json['displayName']) { [string]$json['displayName'] } else { '' }
        Platform      = if ($json['platform']) { [string]$json['platform'] } else { 'windows' }
        SettingsJson  = if ($json['settingsJson']) { [string]$json['settingsJson'] } else { '' }
        PolicyJson    = if ($json['policyJson']) { [string]$json['policyJson'] } else { '' }
        AssignmentsJson = if ($json['assignmentsJson']) { [string]$json['assignmentsJson'] } else { '' }
        ConfirmName   = if ($json['confirmName']) { [string]$json['confirmName'] } else { '' }
        DryRun        = if ($null -ne $json['dryRun']) { [bool]$json['dryRun'] } else { $false }
    }
}

# Kind → Graph resource mapping (mirrors T-0301 registry for the supported set)
$script:CrudKindRegistry = @{
    'configuration' = @{
        ListResource   = 'v1.0/deviceManagement/configurationPolicies'
        ItemResource   = 'v1.0/deviceManagement/configurationPolicies/{id}'
        NameField      = 'name'
    }
    'compliance' = @{
        ListResource   = 'v1.0/deviceManagement/deviceCompliancePolicies'
        ItemResource   = 'v1.0/deviceManagement/deviceCompliancePolicies/{id}'
        NameField      = 'displayName'
    }
}

function Get-IntunePolicyName {
    param([hashtable]$Policy, [string]$Kind)
    $reg = $script:CrudKindRegistry[$Kind]
    $field = if ($reg) { $reg.NameField } else { 'displayName' }
    if ($Policy[$field]) { return [string]$Policy[$field] }
    if ($Policy['displayName']) { return [string]$Policy['displayName'] }
    if ($Policy['name']) { return [string]$Policy['name'] }
    return ''
}

function Build-IntunePolicyDiff {
    param(
        [hashtable]$Before,
        [hashtable]$After
    )

    $diff = [System.Collections.Generic.List[string]]::new()

    if ($null -eq $Before -and $null -ne $After) {
        $name = if ($After['name']) { $After['name'] } elseif ($After['displayName']) { $After['displayName'] } else { '(new)' }
        $diff.Add("+ Policy created: $name")
        $diff.Add("+ Platform: $($After['platforms'] ?? $After['platform'] ?? 'windows')")
        if ($After['settingsJson']) {
            $diff.Add('+ Settings: (structured settings)')
        } elseif ($After['policyJson']) {
            $diff.Add('+ Settings: (raw JSON)')
        }
    }
    elseif ($null -ne $Before -and $null -eq $After) {
        $name = if ($Before['displayName']) { $Before['displayName'] } elseif ($Before['name']) { $Before['name'] } else { '(unknown)' }
        $diff.Add("- Policy deleted: $name")
    }
    elseif ($null -ne $Before -and $null -ne $After) {
        $beforeName = if ($Before['displayName']) { $Before['displayName'] } elseif ($Before['name']) { $Before['name'] } else { '' }
        $afterName  = if ($After['displayName']) { $After['displayName'] } elseif ($After['name']) { $After['name'] } else { $beforeName }
        if ($beforeName -ne $afterName) {
            $diff.Add("~ name: '$beforeName' -> '$afterName'")
        }
        $bJson = $Before | ConvertTo-Json -Depth 5 -Compress
        $aJson = $After  | ConvertTo-Json -Depth 5 -Compress
        if ($bJson -ne $aJson) {
            $diff.Add('~ settings/assignments updated')
        }
    }

    return @($diff)
}

function Build-AssignmentDiff {
    param(
        [array]$Before,
        [array]$After
    )

    $diff = [System.Collections.Generic.List[string]]::new()
    $beforeIds = @($Before | Where-Object { $_.id } | ForEach-Object { $_.id })
    $afterIds  = @($After  | Where-Object { $_.id } | ForEach-Object { $_.id })

    foreach ($aId in $afterIds) {
        if ($beforeIds -notcontains $aId) {
            $diff.Add("+ Assignment added: $aId")
        }
    }
    foreach ($bId in $beforeIds) {
        if ($afterIds -notcontains $bId) {
            $diff.Add("- Assignment removed: $bId")
        }
    }

    return @($diff)
}

function Invoke-SetIntunePolicy {
    <#
    .SYNOPSIS
        Executes or previews Intune policy create/edit/delete operations.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('configuration', 'compliance')]
        [string]$Kind,

        [Parameter(Mandatory)]
        [ValidateSet('create', 'edit', 'delete')]
        [string]$Action,

        [string]$PolicyId       = '',
        [string]$DisplayName    = '',
        [string]$Platform       = 'windows',
        [string]$SettingsJson   = '',
        [string]$PolicyJson     = '',
        [string]$AssignmentsJson = '',
        [string]$ConfirmName    = '',
        [bool]$DryRun           = $false
    )

    $reg = $script:CrudKindRegistry[$Kind]
    if (-not $reg) {
        return @{
            success    = $false
            error      = 'intune.kind.unsupported'
            message    = "Intune CRUD not supported for kind '$Kind'"
            statusCode = 501
        }
    }

    $before         = $null
    $after          = $null
    $beforeAssigns  = @()
    $afterAssigns   = @()
    $targetName     = $DisplayName
    $targetPolicyId = $PolicyId

    # Build payload from settings or raw JSON
    $payload = @{}
    if (-not [string]::IsNullOrWhiteSpace($PolicyJson)) {
        $parsed = $PolicyJson | ConvertFrom-Json -AsHashtable
        foreach ($k in $parsed.Keys) { $payload[$k] = $parsed[$k] }
    }
    if (-not [string]::IsNullOrWhiteSpace($SettingsJson)) {
        $payload['settingsJson'] = $SettingsJson
    }
    if (-not [string]::IsNullOrWhiteSpace($DisplayName)) {
        $payload['name']        = $DisplayName
        $payload['displayName'] = $DisplayName
    }
    if (-not [string]::IsNullOrWhiteSpace($Platform)) {
        $payload['platforms'] = $Platform
        $payload['platform']  = $Platform
    }

    # Parse new assignments if provided
    $newAssigns = @()
    if (-not [string]::IsNullOrWhiteSpace($AssignmentsJson)) {
        $newAssigns = @($AssignmentsJson | ConvertFrom-Json)
    }

    if ($Action -eq 'create') {
        $nameVal = if ($payload['name']) { $payload['name'] } elseif ($payload['displayName']) { $payload['displayName'] } else { '' }
        if ([string]::IsNullOrWhiteSpace($nameVal)) {
            throw "ValidationFailed: displayName/name is required for create"
        }
        $targetName    = $nameVal
        $afterAssigns  = $newAssigns
        $after         = $payload
    }
    elseif ($Action -in @('edit', 'delete')) {
        if ([string]::IsNullOrWhiteSpace($PolicyId)) {
            throw "ValidationFailed: policyId is required for $Action"
        }

        $itemUri = $reg.ItemResource -replace '\{id\}', $PolicyId
        $existing = Invoke-MgGraphRequest -Method GET -Uri "/$itemUri`?`$expand=assignments"
        if (-not $existing) {
            throw "NotFound: Intune policy '$PolicyId' not found"
        }

        # Capture as hashtable via JSON round-trip
        $existingJson = $existing | ConvertTo-Json -Depth 5 -Compress
        $before       = $existingJson | ConvertFrom-Json -AsHashtable

        $targetName     = Get-IntunePolicyName -Policy $before -Kind $Kind
        $targetPolicyId = $PolicyId

        # Capture before assignments
        if ($existing.assignments) {
            $beforeAssigns = @($existing.assignments)
        }

        if ($Action -eq 'edit') {
            $merged = @{}
            foreach ($k in $before.Keys) { $merged[$k] = $before[$k] }
            foreach ($k in $payload.Keys) { $merged[$k] = $payload[$k] }
            $after        = $merged
            $afterAssigns = if ($newAssigns.Count -gt 0) { $newAssigns } else { $beforeAssigns }
            $targetName   = Get-IntunePolicyName -Policy $merged -Kind $Kind
        }
        elseif ($Action -eq 'delete') {
            $isAssigned = $beforeAssigns.Count -gt 0
            if ($isAssigned -or ($before['isAssigned'] -eq $true)) {
                if ([string]::IsNullOrWhiteSpace($ConfirmName) -or ($ConfirmName.Trim() -ne $targetName.Trim())) {
                    throw "ValidationFailed: Deleting an assigned policy requires ConfirmName matching the policy name '$targetName'."
                }
            }
            $after = $null
        }
    }

    $policyDiff     = Build-IntunePolicyDiff -Before $before -After $after
    $assignmentDiff = Build-AssignmentDiff  -Before $beforeAssigns -After $afterAssigns
    $combinedDiff   = @($policyDiff) + @($assignmentDiff)

    $plan = [pscustomobject]@{
        action               = $Action
        kind                 = $Kind
        policyId             = if ($targetPolicyId) { $targetPolicyId } else { $null }
        targetName           = $targetName
        before               = $before
        after                = $after
        beforeAssignments    = $beforeAssigns
        afterAssignments     = $afterAssigns
        diff                 = $combinedDiff
        valid                = $true
        dryRun               = $DryRun
        requiresConfirmation = ($Action -eq 'delete' -and $beforeAssigns.Count -gt 0)
    }

    if ($DryRun) {
        return [pscustomobject]@{
            success = $true
            plan    = $plan
        }
    }

    # Execute mutating Graph calls
    $result = $null
    if ($Action -eq 'create') {
        # Remove portal-only keys before sending to Graph
        $graphPayload = @{}
        foreach ($k in $payload.Keys) {
            if ($k -ne 'settingsJson') { $graphPayload[$k] = $payload[$k] }
        }
        $body   = $graphPayload | ConvertTo-Json -Depth 10 -Compress
        $result = Invoke-MgGraphRequest -Method POST -Uri "/$($reg.ListResource)" -Body $body
        $targetPolicyId = if ($result -and $result.id) { [string]$result.id } else { [Guid]::NewGuid().ToString() }
        $plan.policyId = $targetPolicyId
    }
    elseif ($Action -eq 'edit') {
        $graphPayload = @{}
        foreach ($k in $payload.Keys) {
            if ($k -ne 'settingsJson') { $graphPayload[$k] = $payload[$k] }
        }
        $body   = $graphPayload | ConvertTo-Json -Depth 10 -Compress
        $itemUri = $reg.ItemResource -replace '\{id\}', $PolicyId
        $result = Invoke-MgGraphRequest -Method PATCH -Uri "/$itemUri" -Body $body
    }
    elseif ($Action -eq 'delete') {
        $itemUri = $reg.ItemResource -replace '\{id\}', $PolicyId
        Invoke-MgGraphRequest -Method DELETE -Uri "/$itemUri"
        $result = @{ deleted = $true }
    }

    $auditEvent = [pscustomobject]@{
        id               = [Guid]::NewGuid().ToString()
        tenantId         = $TenantId
        action           = "intune.$Kind.$Action"
        targetId         = $targetPolicyId
        targetName       = $targetName
        kind             = $Kind
        timestamp        = (Get-Date).ToUniversalTime().ToString('o')
        before           = $before
        after            = $after
        beforeAssignments = $beforeAssigns
        afterAssignments  = $afterAssigns
    }

    return [pscustomobject]@{
        success    = $true
        plan       = $plan
        result     = $result
        auditEvent = $auditEvent
    }
}
