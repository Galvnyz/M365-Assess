# Set-AssignmentFilter.ps1 - EPIC-016 assignment filter worker (SPEC section 3.3, 5, 6; T-0309).
#
# Lists, creates, edits, and deletes Intune assignment filters in one tenant, and deploys a
# filter template by name (create when missing, update when the rule differs). Every write
# returns an AuditEvent with before/after. The BFF validates rule grammar and maps the
# registry platform to the Graph platform before a job reaches this worker; the worker
# re-checks the Graph platform and refuses a platform change on an existing filter, which
# Intune does not allow.

$script:AssignmentFiltersUri = '/beta/deviceManagement/assignmentFilters'

# Graph platform -> T-0301 registry platform.
$script:AssignmentFilterPlatforms = @{
    windows10AndLater = 'windows'
    androidForWork    = 'android'
    iOS               = 'ios'
    macOS             = 'macos'
}

$script:AssignmentFilterActions = @('list', 'create', 'edit', 'delete', 'plan', 'deploy')

function Read-SetAssignmentFilterJob {
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
    $action = [string]$json.action
    if ($script:AssignmentFilterActions -notcontains $action) {
        throw "job envelope '$Path' has unknown action '$action'; valid: $($script:AssignmentFilterActions -join ', ')"
    }

    return @{
        TenantId    = [string]$json.tenantId
        Action      = $action
        FilterId    = if ($json.filterId) { [string]$json.filterId } else { '' }
        FilterJson  = if ($json.filterJson) { [string]$json.filterJson } else { '{}' }
        ConfirmName = if ($json.confirmName) { [string]$json.confirmName } else { '' }
        Actor       = if ($json.actor) { [string]$json.actor } else { 'system' }
    }
}

function Get-AssignmentFilterValue {
    # Read a property from a hashtable or a PSCustomObject.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function ConvertTo-AssignmentFilterItem {
    # Normalise a Graph filter into the portal shape.
    param($Filter)
    $graphPlatform = [string](Get-AssignmentFilterValue -Object $Filter -Name 'platform')
    return [pscustomobject]@{
        id            = [string](Get-AssignmentFilterValue -Object $Filter -Name 'id')
        displayName   = [string](Get-AssignmentFilterValue -Object $Filter -Name 'displayName')
        description   = [string](Get-AssignmentFilterValue -Object $Filter -Name 'description')
        platform      = $script:AssignmentFilterPlatforms[$graphPlatform]
        graphPlatform = $graphPlatform
        rule          = [string](Get-AssignmentFilterValue -Object $Filter -Name 'rule')
    }
}

function ConvertTo-AssignmentFilterAuditEvent {
    param([string]$TenantId, [string]$Action, [string]$TargetId, [string]$TargetName, [string]$Actor, $Before, $After)
    return [pscustomobject]@{
        id         = [guid]::NewGuid().ToString()
        tenantId   = $TenantId
        action     = "intune.assignment-filter.$Action"
        targetId   = $TargetId
        targetName = $TargetName
        actor      = $Actor
        timestamp  = (Get-Date).ToUniversalTime().ToString('o')
        before     = $Before
        after      = $After
    }
}

function Get-AssignmentFilterDiff {
    param($Before, [hashtable]$After)
    $diff = [System.Collections.Generic.List[string]]::new()
    foreach ($key in @('displayName', 'description', 'platform', 'rule')) {
        if (-not $After.ContainsKey($key)) { continue }
        # $After carries the Graph platform; compare it with the live filter's Graph platform.
        $beforeKey = if ($key -eq 'platform') { 'graphPlatform' } else { $key }
        $old = if ($Before) { [string](Get-AssignmentFilterValue -Object $Before -Name $beforeKey) } else { $null }
        $new = [string]$After[$key]
        if ($null -eq $Before) { $diff.Add("+ ${key}: $new") }
        elseif ($old -ne $new) { $diff.Add("~ ${key}: '$old' -> '$new'") }
    }
    return @($diff)
}

function Invoke-SetAssignmentFilter {
    <#
    .SYNOPSIS
        Runs one assignment filter action against the connected tenant.
    .PARAMETER Action
        list | create | edit | delete | plan | deploy. 'plan' previews a template deploy.
    .PARAMETER FilterJson
        JSON with displayName, description, platform (Graph value), and rule.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('list', 'create', 'edit', 'delete', 'plan', 'deploy')]
        [string]$Action,

        [string]$FilterId = '',

        [string]$FilterJson = '{}',

        [string]$ConfirmName = '',

        [string]$Actor = 'system'
    )

    $filter = $FilterJson | ConvertFrom-Json -AsHashtable
    if ($filter.ContainsKey('platform') -and -not $script:AssignmentFilterPlatforms.ContainsKey([string]$filter['platform'])) {
        throw "unsupported assignment filter platform '$($filter['platform'])'; valid: $($script:AssignmentFilterPlatforms.Keys -join ', ')"
    }

    switch ($Action) {
        'list' {
            $resp = Invoke-MgGraphRequest -Method GET -Uri $script:AssignmentFiltersUri
            return [pscustomobject]@{
                tenantId = $TenantId
                items    = @(@(Get-AssignmentFilterValue -Object $resp -Name 'value') | Where-Object { $_ } | ForEach-Object { ConvertTo-AssignmentFilterItem -Filter $_ })
            }
        }
        'create' {
            foreach ($required in @('displayName', 'platform', 'rule')) {
                if ([string]::IsNullOrWhiteSpace([string]$filter[$required])) { throw "create requires '$required'" }
            }
            $created = Invoke-MgGraphRequest -Method POST -Uri $script:AssignmentFiltersUri -Body ($filter | ConvertTo-Json -Compress)
            $item = ConvertTo-AssignmentFilterItem -Filter $created
            return [pscustomobject]@{
                filter     = $item
                auditEvent = ConvertTo-AssignmentFilterAuditEvent -TenantId $TenantId -Action 'create' -TargetId $item.id -TargetName $item.displayName -Actor $Actor -Before $null -After $item
            }
        }
        'edit' {
            if (-not $FilterId) { throw "edit requires a filterId" }
            $before = ConvertTo-AssignmentFilterItem -Filter (Invoke-MgGraphRequest -Method GET -Uri "$($script:AssignmentFiltersUri)/$FilterId")
            if ($filter.ContainsKey('platform') -and [string]$filter['platform'] -ne $before.graphPlatform) {
                throw "an assignment filter's platform cannot be changed ('$($before.graphPlatform)' -> '$($filter['platform'])')"
            }
            $null = Invoke-MgGraphRequest -Method PATCH -Uri "$($script:AssignmentFiltersUri)/$FilterId" -Body ($filter | ConvertTo-Json -Compress)
            $after = ConvertTo-AssignmentFilterItem -Filter (Invoke-MgGraphRequest -Method GET -Uri "$($script:AssignmentFiltersUri)/$FilterId")
            return [pscustomobject]@{
                filter     = $after
                auditEvent = ConvertTo-AssignmentFilterAuditEvent -TenantId $TenantId -Action 'edit' -TargetId $FilterId -TargetName $after.displayName -Actor $Actor -Before $before -After $after
            }
        }
        'delete' {
            if (-not $FilterId) { throw "delete requires a filterId" }
            $before = ConvertTo-AssignmentFilterItem -Filter (Invoke-MgGraphRequest -Method GET -Uri "$($script:AssignmentFiltersUri)/$FilterId")
            if ($ConfirmName -cne $before.displayName) {
                throw "confirmName '$ConfirmName' does not match the filter name '$($before.displayName)'"
            }
            $null = Invoke-MgGraphRequest -Method DELETE -Uri "$($script:AssignmentFiltersUri)/$FilterId"
            return [pscustomobject]@{
                filter     = $null
                auditEvent = ConvertTo-AssignmentFilterAuditEvent -TenantId $TenantId -Action 'delete' -TargetId $FilterId -TargetName $before.displayName -Actor $Actor -Before $before -After $null
            }
        }
        default {
            # plan / deploy: match the template to a live filter by name.
            $name = [string]$filter['displayName']
            $resp = Invoke-MgGraphRequest -Method GET -Uri $script:AssignmentFiltersUri
            $live = @(Get-AssignmentFilterValue -Object $resp -Name 'value') | Where-Object { $_ -and [string](Get-AssignmentFilterValue -Object $_ -Name 'displayName') -ieq $name } | Select-Object -First 1
            $existing = if ($live) { ConvertTo-AssignmentFilterItem -Filter $live } else { $null }

            $issue = $null
            if ($existing -and $existing.graphPlatform -ne [string]$filter['platform']) {
                $issue = "a filter named '$name' already exists for platform '$($existing.graphPlatform)'; its platform cannot be changed"
            }
            $diff = if ($existing) { Get-AssignmentFilterDiff -Before $existing -After $filter } else { Get-AssignmentFilterDiff -Before $null -After $filter }
            $planAction = if (-not $existing) { 'create' } elseif (@($diff).Count -gt 0) { 'update' } else { 'none' }
            $plan = [pscustomobject]@{
                tenantId = $TenantId
                action   = $planAction
                filterId = if ($existing) { $existing.id } else { $null }
                diff     = @($diff)
                valid    = ($null -eq $issue)
                issue    = $issue
            }
            if ($Action -eq 'plan') { return $plan }
            if ($issue) { throw $issue }

            if ($planAction -eq 'none') {
                return [pscustomobject]@{ tenantId = $TenantId; state = 'skipped'; filterId = $existing.id; error = $null; auditEvent = $null }
            }
            if ($planAction -eq 'create') {
                $created = Invoke-MgGraphRequest -Method POST -Uri $script:AssignmentFiltersUri -Body ($filter | ConvertTo-Json -Compress)
                $after = ConvertTo-AssignmentFilterItem -Filter $created
            }
            else {
                $patch = @{}
                foreach ($key in @('description', 'rule')) { if ($filter.ContainsKey($key)) { $patch[$key] = $filter[$key] } }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "$($script:AssignmentFiltersUri)/$($existing.id)" -Body ($patch | ConvertTo-Json -Compress)
                $after = [pscustomobject]@{ id = $existing.id; displayName = $existing.displayName; description = [string]$filter['description']; platform = $existing.platform; graphPlatform = $existing.graphPlatform; rule = [string]$filter['rule'] }
            }
            return [pscustomobject]@{
                tenantId   = $TenantId
                state      = 'succeeded'
                filterId   = $after.id
                error      = $null
                auditEvent = ConvertTo-AssignmentFilterAuditEvent -TenantId $TenantId -Action "deploy.$planAction" -TargetId $after.id -TargetName $name -Actor $Actor -Before $existing -After $after
            }
        }
    }
}
