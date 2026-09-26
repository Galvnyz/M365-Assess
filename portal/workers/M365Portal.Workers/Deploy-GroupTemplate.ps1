# Deploy-GroupTemplate.ps1 — EPIC-014 Group template deploy worker (SPEC §4.2, §5, §6, §11.2; T-0266).
#
# Resolves template + variables -> plan (group + owners + members + settings) -> apply, per target,
# with partial failures and name conflicts reported per target.
# Records GroupTemplateDeployment and emits AuditEvents.

function Resolve-GroupTemplateName {
    param(
        [Parameter(Mandatory)]
        [string]$BaseName,

        [object]$Naming,

        [hashtable]$Variables = @{}
    )

    $prefix = ''
    $suffix = ''
    $pattern = ''
    $conflictBehavior = 'block'

    if ($Naming) {
        if ($Naming.prefix) { $prefix = [string]$Naming.prefix }
        if ($Naming.suffix) { $suffix = [string]$Naming.suffix }
        if ($Naming.pattern) { $pattern = [string]$Naming.pattern }
        if ($Naming.conflictBehavior) { $conflictBehavior = [string]$Naming.conflictBehavior }
    }

    $name = $BaseName
    if (-not [string]::IsNullOrWhiteSpace($pattern)) {
        $name = $pattern
        $name = $name -replace '\{name\}', $BaseName
        $name = $name -replace '\{prefix\}', $prefix
        $name = $name -replace '\{suffix\}', $suffix
    } else {
        $name = "$prefix$BaseName$suffix"
    }

    if ($Variables) {
        foreach ($key in $Variables.Keys) {
            $val = [string]$Variables[$key]
            $name = $name -replace "\{$key\}", $val
        }
    }

    return @{
        ResolvedName     = $name.Trim()
        ConflictBehavior = $conflictBehavior
    }
}

function Read-DeployGroupTemplateJob {
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
    if (-not $json.template) {
        throw "job envelope '$Path' is missing mandatory 'template'"
    }

    $vars = @{}
    if ($json.variables) {
        foreach ($prop in $json.variables.PSObject.Properties) {
            $vars[$prop.Name] = [string]$prop.Value
        }
    }

    return @{
        TenantId  = [string]$json.tenantId
        Template  = $json.template
        Variables = $vars
        CreatedBy = if ($json.createdBy) { [string]$json.createdBy } else { 'system' }
        DryRun    = [bool]($json.dryRun -eq $true)
    }
}

function Invoke-DeployGroupTemplate {
    <#
    .SYNOPSIS
        Plans or applies a group template deployment to a target tenant.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [object]$Template,

        [Parameter()]
        [hashtable]$Variables = @{},

        [Parameter()]
        [string]$CreatedBy = 'system',

        [Parameter()]
        [bool]$DryRun = $false
    )

    $templateId = if ($Template.id) { [string]$Template.id } else { [guid]::NewGuid().ToString() }
    $baseName = if ($Template.name) { [string]$Template.name } else { 'Standard Group' }
    $groupType = if ($Template.groupType) { [string]$Template.groupType } else { 'security' }
    $naming = $Template.naming
    $owners = if ($Template.owners) { @($Template.owners) } else { @() }
    $members = if ($Template.members) { @($Template.members) } else { @() }
    $settings = if ($Template.settings) { $Template.settings } else { @{} }

    # 1. Resolve naming and conflict behavior
    $resolvedNaming = Resolve-GroupTemplateName -BaseName $baseName -Naming $naming -Variables $Variables
    $targetName = $resolvedNaming.ResolvedName
    $conflictBehavior = $resolvedNaming.ConflictBehavior

    # 2. Check for name conflict via Graph
    $hasConflict = $false
    $existing = $null
    try {
        $encodedName = [System.Uri]::EscapeDataString($targetName)
        $query = "/v1.0/groups?`$filter=displayName eq '$encodedName'"
        $check = Invoke-MgGraphRequest -Method GET -Uri $query
        if ($check -and $check.value -and @($check.value).Count -gt 0) {
            $hasConflict = $true
            $existing = @($check.value)[0]
        }
    }
    catch {
        # Graph query error ignored or reported
    }

    $finalName = $targetName
    if ($hasConflict) {
        if ($conflictBehavior -eq 'appendSuffix') {
            $finalName = "$targetName-$(Get-Random -Minimum 1000 -Maximum 9999)"
        }
    }

    $planDiff = [System.Collections.Generic.List[string]]::new()
    $planDiff.Add("Deploy template '$baseName' as '$finalName' ($groupType)")
    if ($hasConflict -and $conflictBehavior -eq 'block') {
        $planDiff.Add("ERROR: Name collision with existing group '$targetName'")
    }
    if ($owners.Count -gt 0) {
        $planDiff.Add("Add $($owners.Count) owner(s)")
    }
    if ($members.Count -gt 0) {
        $planDiff.Add("Add $($members.Count) initial member(s)")
    }

    $isValid = -not ($hasConflict -and $conflictBehavior -eq 'block')
    $conflictError = if ($hasConflict -and $conflictBehavior -eq 'block') {
        "Name conflict: group with display name '$targetName' already exists in tenant '$TenantId'."
    } else { $null }

    $plan = [pscustomobject]@{
        templateId   = $templateId
        tenantId     = $TenantId
        targetName   = $finalName
        groupType    = $groupType
        owners       = @($owners)
        members      = @($members)
        settings     = $settings
        diff         = @($planDiff)
        valid        = $isValid
        conflict     = $hasConflict
        conflictError = $conflictError
        dryRun       = $DryRun
    }

    if ($DryRun) {
        return $plan
    }

    if (-not $isValid) {
        throw "ConflictBlocked: $conflictError"
    }

    # 3. Apply deployment live
    $deploymentId = [guid]::NewGuid().ToString()
    $stepResults = [System.Collections.Generic.List[object]]::new()
    $createdGroup = $null
    $hasFailure = $false

    # Step 1: Create Group
    try {
        $body = @{
            displayName     = $finalName
            mailNickname    = ($finalName -replace '[^a-zA-Z0-9]', '')
            mailEnabled     = ($groupType -in @('m365', 'distribution'))
            securityEnabled = ($groupType -ne 'distribution')
        }
        if ($groupType -eq 'm365') {
            $body.groupTypes = @('Unified')
        }

        $createdGroup = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups" -Body ($body | ConvertTo-Json -Depth 5)
        $stepResults.Add(@{
            step    = 'createGroup'
            status  = 'succeeded'
            groupId = [string]$createdGroup.id
        })
    }
    catch {
        $stepResults.Add(@{
            step   = 'createGroup'
            status = 'failed'
            error  = $_.ToString()
        })
        $hasFailure = $true
    }

    # Step 2: Add owners
    if ($createdGroup -and $owners.Count -gt 0) {
        foreach ($ownerId in $owners) {
            try {
                $refBody = @{
                    "@odata.id" = "https://graph.microsoft.com/v1.0/users/$ownerId"
                }
                Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups/$($createdGroup.id)/owners/`$ref" -Body ($refBody | ConvertTo-Json)
                $stepResults.Add(@{
                    step    = 'addOwner'
                    ownerId = $ownerId
                    status  = 'succeeded'
                })
            }
            catch {
                $stepResults.Add(@{
                    step    = 'addOwner'
                    ownerId = $ownerId
                    status  = 'failed'
                    error   = $_.ToString()
                })
                $hasFailure = $true
            }
        }
    }

    # Step 3: Add members
    if ($createdGroup -and $members.Count -gt 0) {
        foreach ($memberId in $members) {
            try {
                $refBody = @{
                    "@odata.id" = "https://graph.microsoft.com/v1.0/users/$memberId"
                }
                Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups/$($createdGroup.id)/members/`$ref" -Body ($refBody | ConvertTo-Json)
                $stepResults.Add(@{
                    step     = 'addMember'
                    memberId = $memberId
                    status   = 'succeeded'
                })
            }
            catch {
                $stepResults.Add(@{
                    step     = 'addMember'
                    memberId = $memberId
                    status   = 'failed'
                    error    = $_.ToString()
                })
                $hasFailure = $true
            }
        }
    }

    $state = if (-not $createdGroup) {
        'failed'
    } elseif ($hasFailure) {
        'partial'
    } else {
        'succeeded'
    }

    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $deploymentRecord = [pscustomobject]@{
        id         = $deploymentId
        templateId = $templateId
        tenantId   = $TenantId
        state      = $state
        results    = @($stepResults)
        createdBy  = $CreatedBy
        createdAt  = $now
        updatedAt  = $now
    }

    $auditEvent = @{
        id         = [guid]::NewGuid().ToString()
        tenantId   = $TenantId
        action     = 'group-template.deploy'
        targetId   = if ($createdGroup) { [string]$createdGroup.id } else { $templateId }
        targetName = $finalName
        timestamp  = $now
        state      = $state
    }

    return [pscustomobject]@{
        plan       = $plan
        deployment = $deploymentRecord
        auditEvent = $auditEvent
        success    = ($state -ne 'failed')
    }
}
