# Deploy-IntuneTemplate.ps1 - EPIC-016 Intune template deploy worker (SPEC section 3.2, section 4.2, section 6, section 8; T-0306).
#
# Deploys one Intune policy template to one target tenant (the BFF fans out across targets):
# - Resolves template + deploy-drawer options (assignment mode, policy state, overwrite,
#   create-groups) into a plan: policy JSON, groups to create, and assignments.
# - Conflicts: a live policy with the same name blocks the deploy unless overwrite is on;
#   with overwrite the plan diffs the template against the live policy.
# - Applies with before/after capture; a failed policy write fails the target, while a failed
#   group create or assignment leaves it 'partial' with per-step detail.
# - Emits an AuditEvent for every policy write.

$script:IntuneDeployResources = @{
    configuration = @{ Uri = '/v1.0/deviceManagement/configurationPolicies'; NameProperty = 'name' }
    compliance    = @{ Uri = '/v1.0/deviceManagement/deviceCompliancePolicies'; NameProperty = 'displayName' }
}

$script:IntuneAssignmentModes = @('template', 'none', 'allDevices', 'allUsers', 'allUsersAndDevices', 'groups')

# Graph and plan-bookkeeping properties never copied from a template into a write payload.
$script:IntuneReadOnlyProperties = @('id', 'createdDateTime', 'lastModifiedDateTime', 'version', 'assignments', 'settingCount', 'isAssigned')

function Read-DeployIntuneTemplateJob {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }
    if (-not $json.templateJson) {
        throw "job envelope '$Path' is missing mandatory 'templateJson'"
    }

    return @{
        TenantId       = [string]$json.tenantId
        TemplateJson   = [string]$json.templateJson
        PolicyName     = if ($json.policyName) { [string]$json.policyName } else { '' }
        AssignmentMode = if ($json.assignmentMode) { [string]$json.assignmentMode } else { 'template' }
        Groups         = if ($json.groups) { @($json.groups | ForEach-Object { [string]$_ }) } else { @() }
        PolicyState    = if ($json.policyState) { [string]$json.policyState } else { 'enabled' }
        Overwrite      = [bool]($json.overwrite -eq $true)
        CreateGroups   = [bool]($json.createGroups -eq $true)
        DryRun         = [bool]($json.dryRun -eq $true)
    }
}

function Get-IntuneValue {
    # Read a property from a hashtable or a PSCustomObject.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function ConvertTo-IntuneAssignmentTarget {
    # Map a portal assignment ({ target, targetType }) or a raw Graph target to a Graph assignment.
    param($Assignment)

    $graphTarget = Get-IntuneValue -Object $Assignment -Name 'target'
    if ($graphTarget -and ($graphTarget -is [System.Collections.IDictionary] -or $graphTarget -is [pscustomobject])) {
        return @{ target = $graphTarget }
    }
    $type = [string](Get-IntuneValue -Object $Assignment -Name 'targetType')
    switch ($type) {
        'allDevicesAssignmentTarget' { return @{ target = @{ '@odata.type' = '#microsoft.graph.allDevicesAssignmentTarget' } } }
        'allLicensedUsersAssignmentTarget' { return @{ target = @{ '@odata.type' = '#microsoft.graph.allLicensedUsersAssignmentTarget' } } }
        default {
            $groupId = [string](Get-IntuneValue -Object $Assignment -Name 'id')
            if (-not $groupId) { $groupId = [string]$graphTarget }
            return @{ target = @{ '@odata.type' = '#microsoft.graph.groupAssignmentTarget'; groupId = $groupId } }
        }
    }
}

function Resolve-IntuneDeployGroup {
    # Returns @{ Name; Id } where Id is $null when the group does not exist in the tenant.
    param([Parameter(Mandatory)][string]$Group)

    if ($Group -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        return @{ Name = $Group; Id = $Group }
    }
    $escaped = $Group.Replace("'", "''")
    $resp = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/groups?`$filter=displayName eq '$escaped'&`$select=id,displayName"
    $match = @(Get-IntuneValue -Object $resp -Name 'value') | Where-Object { $_ } | Select-Object -First 1
    return @{ Name = $Group; Id = if ($match) { [string](Get-IntuneValue -Object $match -Name 'id') } else { $null } }
}

function Format-IntuneDiffValue {
    param($Value)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string]) { return "'$Value'" }
    return ($Value | ConvertTo-Json -Depth 6 -Compress)
}

function Build-IntuneDeployDiff {
    <#
    .SYNOPSIS
        Diff lines for a plan: groups, policy settings (vs the live policy on overwrite), assignments.
    #>
    param(
        $Before,
        [Parameter(Mandatory)][hashtable]$After,
        [string]$NameProperty = 'displayName',
        [string[]]$GroupsToCreate = @(),
        [string[]]$AssignmentLabels = @(),
        [string]$PolicyState = 'enabled'
    )

    $diff = [System.Collections.Generic.List[string]]::new()
    foreach ($g in $GroupsToCreate) { $diff.Add("+ Create group: $g") }
    if ($PolicyState -eq 'disabled') {
        $diff.Add('! Policy state disabled: the policy is deployed without assignments')
    }

    $name = $After[$NameProperty]
    if ($null -eq $Before) {
        $diff.Add("+ Policy: $name")
        foreach ($key in ($After.Keys | Sort-Object)) {
            if ($key -eq $NameProperty -or $key -eq '@odata.type') { continue }
            $diff.Add("+ ${key}: $(Format-IntuneDiffValue -Value $After[$key])")
        }
    }
    else {
        $diff.Add("~ Overwriting existing policy '$name' (ID: $(Get-IntuneValue -Object $Before -Name 'id'))")
        $changed = 0
        foreach ($key in ($After.Keys | Sort-Object)) {
            if ($key -eq '@odata.type') { continue }
            $old = Format-IntuneDiffValue -Value (Get-IntuneValue -Object $Before -Name $key)
            $new = Format-IntuneDiffValue -Value $After[$key]
            if ($old -ne $new) {
                $diff.Add("~ ${key}: $old -> $new")
                $changed++
            }
        }
        if ($changed -eq 0) { $diff.Add('= Settings match the live policy') }
    }

    foreach ($label in $AssignmentLabels) { $diff.Add("+ Assign: $label") }
    return @($diff)
}

function Invoke-DeployIntuneTemplate {
    <#
    .SYNOPSIS
        Plans (DryRun) or applies an Intune policy template deploy to one tenant.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TemplateJson,

        [string]$PolicyName = '',

        [string]$AssignmentMode = 'template',

        [string[]]$Groups = @(),

        [ValidateSet('enabled', 'disabled')]
        [string]$PolicyState = 'enabled',

        [bool]$Overwrite = $false,

        [bool]$CreateGroups = $false,

        [bool]$DryRun = $false,

        [string]$CreatedBy = 'system'
    )

    if ($script:IntuneAssignmentModes -notcontains $AssignmentMode) {
        throw "unknown assignment mode '$AssignmentMode'; valid: $($script:IntuneAssignmentModes -join ', ')"
    }

    # 1. Template: a stored IntuneTemplate record ({ id, name, policyType, policyJson, assignments }).
    $template = $TemplateJson | ConvertFrom-Json -AsHashtable
    $templateId = [string]$template['id']
    $kind = [string]$template['policyType']
    $resource = $script:IntuneDeployResources[$kind]
    if (-not $resource) {
        throw "template '$templateId' has unsupported policyType '$kind'; valid: configuration, compliance"
    }
    $policyJson = if ($template['policyJson'] -is [System.Collections.IDictionary]) { $template['policyJson'] } else { @{} }

    $finalName = if (-not [string]::IsNullOrWhiteSpace($PolicyName)) { $PolicyName.Trim() }
        elseif ($policyJson['displayName']) { [string]$policyJson['displayName'] }
        elseif ($policyJson['name']) { [string]$policyJson['name'] }
        else { [string]$template['name'] }

    # 2. Payload: template policy JSON minus read-only properties, named for the target resource.
    $payload = @{}
    foreach ($key in $policyJson.Keys) {
        if ($script:IntuneReadOnlyProperties -notcontains $key -and $key -ne 'name' -and $key -ne 'displayName') {
            $payload[$key] = $policyJson[$key]
        }
    }
    $payload[$resource.NameProperty] = $finalName
    if ($kind -eq 'compliance' -and -not $payload.ContainsKey('scheduledActionsForRule')) {
        # Graph rejects a compliance policy created without a block action.
        $payload['scheduledActionsForRule'] = @(@{
            ruleName                      = 'PasswordRequired'
            scheduledActionConfigurations = @(@{ actionType = 'block'; gracePeriodHours = 0 })
        })
    }

    # 3. Assignments per mode; 'disabled' state deploys unassigned.
    $issues = [System.Collections.Generic.List[string]]::new()
    $groupsToCreate = [System.Collections.Generic.List[string]]::new()
    $resolvedGroups = [System.Collections.Generic.List[hashtable]]::new()
    $assignments = [System.Collections.Generic.List[hashtable]]::new()
    $assignmentLabels = [System.Collections.Generic.List[string]]::new()

    $mode = if ($PolicyState -eq 'disabled') { 'none' } else { $AssignmentMode }
    $groupNames = [System.Collections.Generic.List[string]]::new()
    switch ($mode) {
        'template' {
            foreach ($a in @($template['assignments'])) {
                if (-not $a) { continue }
                $type = [string](Get-IntuneValue -Object $a -Name 'targetType')
                $target = Get-IntuneValue -Object $a -Name 'target'
                if ($type -eq 'allDevicesAssignmentTarget' -or $type -eq 'allLicensedUsersAssignmentTarget') {
                    $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment $a))
                    $assignmentLabels.Add($(if ($type -like 'allDevices*') { 'All devices' } else { 'All users' }))
                }
                elseif ($target -is [string] -and $target) {
                    # Portal-shaped group assignment: resolve by name or id like 'groups' mode.
                    $groupNames.Add($target)
                }
                else {
                    $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment $a))
                    $assignmentLabels.Add([string](Get-IntuneValue -Object $target -Name 'groupId'))
                }
            }
        }
        'allDevices' {
            $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment @{ targetType = 'allDevicesAssignmentTarget' }))
            $assignmentLabels.Add('All devices')
        }
        'allUsers' {
            $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment @{ targetType = 'allLicensedUsersAssignmentTarget' }))
            $assignmentLabels.Add('All users')
        }
        'allUsersAndDevices' {
            $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment @{ targetType = 'allDevicesAssignmentTarget' }))
            $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment @{ targetType = 'allLicensedUsersAssignmentTarget' }))
            $assignmentLabels.Add('All devices')
            $assignmentLabels.Add('All users')
        }
        'groups' {
            $named = @($Groups | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            if ($named.Count -eq 0) { $issues.Add("assignment mode 'groups' requires at least one group") }
            foreach ($g in $named) { $groupNames.Add($g.Trim()) }
        }
    }
    foreach ($g in $groupNames) {
        $resolved = Resolve-IntuneDeployGroup -Group $g
        if (-not $resolved.Id) {
            if ($CreateGroups) { $groupsToCreate.Add($resolved.Name) }
            else { $issues.Add("group '$($resolved.Name)' does not exist in the tenant; enable create-groups to create it") }
        }
        $resolvedGroups.Add($resolved)
        $assignmentLabels.Add($resolved.Name)
    }

    # 4. Live policy with the same name: conflict, or the overwrite baseline.
    $existing = $null
    $live = Invoke-MgGraphRequest -Method GET -Uri $resource.Uri
    foreach ($p in @(Get-IntuneValue -Object $live -Name 'value')) {
        if ($p -and ([string](Get-IntuneValue -Object $p -Name $resource.NameProperty)).Trim() -eq $finalName) {
            $existing = $p
            break
        }
    }

    $conflict = $false
    $conflictMessage = $null
    if ($existing -and -not $Overwrite) {
        $conflict = $true
        $conflictMessage = "A $kind policy named '$finalName' already exists in the tenant. Enable overwrite to update it."
    }

    $before = $null
    if ($existing) {
        $before = @{}
        foreach ($key in $payload.Keys) { $before[$key] = Get-IntuneValue -Object $existing -Name $key }
        $before['id'] = [string](Get-IntuneValue -Object $existing -Name 'id')
    }

    $diffParams = @{
        Before           = $before
        After            = $payload
        NameProperty     = $resource.NameProperty
        GroupsToCreate   = @($groupsToCreate)
        AssignmentLabels = @($assignmentLabels)
        PolicyState      = $PolicyState
    }
    $diff = Build-IntuneDeployDiff @diffParams

    $plan = [pscustomobject]@{
        tenantId        = $TenantId
        templateId      = $templateId
        kind            = $kind
        policyName      = $finalName
        action          = if ($existing -and $Overwrite) { 'update' } else { 'create' }
        policyState     = $PolicyState
        assignmentMode  = $mode
        overwrite       = $Overwrite
        conflict        = $conflict
        conflictMessage = $conflictMessage
        groupsToCreate  = @($groupsToCreate)
        assignments     = @($assignmentLabels)
        issues          = @($issues)
        diff            = $diff
        valid           = (-not $conflict) -and ($issues.Count -eq 0)
        dryRun          = $DryRun
    }

    if ($DryRun) {
        return [pscustomobject]@{ success = $plan.valid; plan = $plan }
    }
    if (-not $plan.valid) {
        $reason = if ($conflict) { $conflictMessage } else { $issues -join '; ' }
        throw "Deploy blocked for tenant '$TenantId': $reason"
    }

    # 5. Apply: groups, then the policy write (audited), then assignments.
    $steps = [System.Collections.Generic.List[hashtable]]::new()
    $hasFailure = $false

    foreach ($g in $resolvedGroups) {
        if ($g.Id) { continue }
        try {
            $nick = ($g.Name -replace '[^A-Za-z0-9]', '')
            if (-not $nick) { $nick = 'intunegroup' }
            $groupBody = @{ displayName = $g.Name; mailEnabled = $false; mailNickname = $nick; securityEnabled = $true } | ConvertTo-Json -Compress
            $created = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/groups' -Body $groupBody
            $g.Id = [string](Get-IntuneValue -Object $created -Name 'id')
            $steps.Add(@{ step = 'createGroup'; target = $g.Name; status = 'succeeded' })
        }
        catch {
            $steps.Add(@{ step = 'createGroup'; target = $g.Name; status = 'failed'; error = $_.ToString() })
            $hasFailure = $true
        }
    }
    foreach ($g in $resolvedGroups) {
        if ($g.Id) {
            $assignments.Add((ConvertTo-IntuneAssignmentTarget -Assignment @{ id = $g.Id; targetType = 'groupAssignmentTarget' }))
        }
    }

    $policyId = $null
    $auditEvent = $null
    try {
        $body = $payload | ConvertTo-Json -Depth 20 -Compress
        if ($existing) {
            $policyId = $before['id']
            $method = if ($kind -eq 'configuration') { 'PUT' } else { 'PATCH' }
            $null = Invoke-MgGraphRequest -Method $method -Uri "$($resource.Uri)/$policyId" -Body $body
        }
        else {
            $created = Invoke-MgGraphRequest -Method POST -Uri $resource.Uri -Body $body
            $policyId = [string](Get-IntuneValue -Object $created -Name 'id')
        }
        $steps.Add(@{ step = if ($existing) { 'updatePolicy' } else { 'createPolicy' }; target = $finalName; status = 'succeeded' })
        $auditEvent = [pscustomobject]@{
            id         = [guid]::NewGuid().ToString()
            tenantId   = $TenantId
            action     = if ($existing) { 'intune.template.deploy.update' } else { 'intune.template.deploy.create' }
            targetId   = $policyId
            targetName = $finalName
            kind       = $kind
            templateId = $templateId
            actor      = $CreatedBy
            timestamp  = (Get-Date).ToUniversalTime().ToString('o')
            before     = $before
            after      = $payload
        }
    }
    catch {
        $steps.Add(@{ step = 'writePolicy'; target = $finalName; status = 'failed'; error = $_.ToString() })
        return [pscustomobject]@{
            success    = $false
            state      = 'failed'
            tenantId   = $TenantId
            policyId   = $null
            plan       = $plan
            steps      = @($steps)
            error      = $_.ToString()
            auditEvent = $null
        }
    }

    if ($assignments.Count -gt 0) {
        try {
            $assignBody = @{ assignments = @($assignments) } | ConvertTo-Json -Depth 10 -Compress
            $null = Invoke-MgGraphRequest -Method POST -Uri "$($resource.Uri)/$policyId/assign" -Body $assignBody
            $steps.Add(@{ step = 'assign'; target = ($assignmentLabels -join ', '); status = 'succeeded' })
        }
        catch {
            $steps.Add(@{ step = 'assign'; target = ($assignmentLabels -join ', '); status = 'failed'; error = $_.ToString() })
            $hasFailure = $true
        }
    }

    $state = if ($hasFailure) { 'partial' } else { 'succeeded' }
    return [pscustomobject]@{
        success    = $true
        state      = $state
        tenantId   = $TenantId
        policyId   = $policyId
        plan       = $plan
        steps      = @($steps)
        error      = $null
        auditEvent = $auditEvent
    }
}
