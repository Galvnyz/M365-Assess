# Sync-ReusableSettings.ps1 - EPIC-016 reusable settings worker (SPEC section 3.3, 4.3, 11.3; T-0308).
#
# Lists a tenant's Intune reusable policy settings and syncs reusable setting templates into it
# (CIPP Sync-CIPPReusablePolicySettings parity):
# - v1 sync scope is the enumerated $script:ReusableSettingTypes; anything else is rejected.
# - Each template is matched to a live setting by displayName and type. Missing -> create;
#   different settingInstance -> update; identical -> no change.
# - Preview (DryRun) returns a per-setting diff at leaf paths plus the configuration policies
#   that reference the setting, and writes nothing. Referencing policies pick up an update
#   through their reference, so the list shows the blast radius before apply.
# - Apply writes each change independently and emits an AuditEvent per write.

$script:ReusableSettingTypes = @(
    @{ Key = 'firewallRemoteAddresses'; Prefix = 'vendor_msft_firewall_mdmstore_dynamickeywords_addresses_' }
    @{ Key = 'deviceControlGroups'; Prefix = 'device_vendor_msft_defender_configuration_devicecontrol_policygroups_' }
)

$script:ReusableSettingsUri = '/beta/deviceManagement/reusablePolicySettings'

function Read-SyncReusableSettingsJob {
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
    $action = if ($json.action) { [string]$json.action } else { 'sync' }
    if (@('list', 'sync') -notcontains $action) {
        throw "job envelope '$Path' has unknown action '$action'; valid: list, sync"
    }
    if ($action -eq 'sync' -and -not $json.templatesJson) {
        throw "job envelope '$Path' is missing 'templatesJson' for action 'sync'"
    }

    return @{
        TenantId      = [string]$json.tenantId
        Action        = $action
        TemplatesJson = if ($json.templatesJson) { [string]$json.templatesJson } else { '[]' }
        # Preview unless the envelope explicitly asks to apply.
        DryRun        = -not ($json.dryRun -eq $false)
        Actor         = if ($json.actor) { [string]$json.actor } else { 'system' }
    }
}

function Get-ReusableSettingTypeKey {
    <#
    .SYNOPSIS
        The v1 sync-scope type key for a settingDefinitionId, or $null when out of scope.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([string]$SettingDefinitionId)

    if ([string]::IsNullOrWhiteSpace($SettingDefinitionId)) { return $null }
    $id = $SettingDefinitionId.ToLowerInvariant()
    foreach ($type in $script:ReusableSettingTypes) {
        if ($id.StartsWith($type.Prefix)) { return $type.Key }
    }
    return $null
}

function Get-ReusableSettingValue {
    # Read a property from a hashtable or a PSCustomObject.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function ConvertTo-ReusableSettingLeafMap {
    <#
    .SYNOPSIS
        Flattens a settingInstance into path -> JSON value pairs for leaf-level diffs.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param(
        $Value,
        [string]$Path = '',
        [System.Collections.Specialized.OrderedDictionary]$Map = ([ordered]@{})
    )

    if ($null -eq $Value -and -not $Path) { return $Map }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in ($Value.Keys | Sort-Object)) {
            $child = if ($Path) { "$Path.$key" } else { [string]$key }
            $null = ConvertTo-ReusableSettingLeafMap -Value $Value[$key] -Path $child -Map $Map
        }
    }
    elseif ($Value -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in ($Value.PSObject.Properties | Sort-Object -Property Name)) {
            $child = if ($Path) { "$Path.$($prop.Name)" } else { $prop.Name }
            $null = ConvertTo-ReusableSettingLeafMap -Value $prop.Value -Path $child -Map $Map
        }
    }
    elseif ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $i = 0
        foreach ($item in $Value) {
            $null = ConvertTo-ReusableSettingLeafMap -Value $item -Path "$Path[$i]" -Map $Map
            $i++
        }
    }
    else {
        $Map[$Path] = ($Value | ConvertTo-Json -Compress -Depth 2)
    }
    return $Map
}

function Get-ReusableSettingDiff {
    <#
    .SYNOPSIS
        Leaf-level diff lines between a live settingInstance and the template's.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param($Before, $After)

    $old = ConvertTo-ReusableSettingLeafMap -Value $Before
    $new = ConvertTo-ReusableSettingLeafMap -Value $After
    $diff = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $new.Keys) {
        if (-not $old.Contains($path)) { $diff.Add("+ ${path}: $($new[$path])") }
        elseif ($old[$path] -ne $new[$path]) { $diff.Add("~ ${path}: $($old[$path]) -> $($new[$path])") }
    }
    foreach ($path in $old.Keys) {
        if (-not $new.Contains($path)) { $diff.Add("- ${path}: $($old[$path])") }
    }
    return @($diff)
}

function Get-TenantReusableSetting {
    <#
    .SYNOPSIS
        Lists the connected tenant's reusable policy settings with their v1 sync-scope type.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject[]])]
    param()

    $resp = Invoke-MgGraphRequest -Method GET -Uri "$($script:ReusableSettingsUri)?`$select=id,displayName,description,settingDefinitionId,settingInstance,referencingConfigurationPolicyCount"
    $items = foreach ($s in @(Get-ReusableSettingValue -Object $resp -Name 'value')) {
        if (-not $s) { continue }
        $definitionId = [string](Get-ReusableSettingValue -Object $s -Name 'settingDefinitionId')
        if (-not $definitionId) {
            $definitionId = [string](Get-ReusableSettingValue -Object (Get-ReusableSettingValue -Object $s -Name 'settingInstance') -Name 'settingDefinitionId')
        }
        $type = Get-ReusableSettingTypeKey -SettingDefinitionId $definitionId
        [pscustomobject]@{
            id                     = [string](Get-ReusableSettingValue -Object $s -Name 'id')
            displayName            = [string](Get-ReusableSettingValue -Object $s -Name 'displayName')
            settingDefinitionId    = $definitionId
            type                   = $type
            inScope                = [bool]$type
            referencingPolicyCount = [int](Get-ReusableSettingValue -Object $s -Name 'referencingConfigurationPolicyCount')
            settingInstance        = Get-ReusableSettingValue -Object $s -Name 'settingInstance'
        }
    }
    return @($items)
}

function Sync-ReusableSettingTemplate {
    <#
    .SYNOPSIS
        Previews (DryRun) or applies reusable setting templates to one tenant.
    .PARAMETER TemplatesJson
        JSON array of ReusableSettingTemplate records ({ id, name, settingsJson }).
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TemplatesJson,

        [bool]$DryRun = $true,

        [string]$Actor = 'system'
    )

    $templates = @($TemplatesJson | ConvertFrom-Json -AsHashtable)

    # Reject the whole request when any template is outside the v1 scope.
    foreach ($t in $templates) {
        $instance = $t['settingsJson']['settingInstance']
        $definitionId = if ($instance) { [string]$instance['settingDefinitionId'] } else { '' }
        if (-not (Get-ReusableSettingTypeKey -SettingDefinitionId $definitionId)) {
            throw "template '$($t['id'])' has settingDefinitionId '$definitionId', which is outside the v1 reusable-settings sync scope"
        }
    }

    $live = Get-TenantReusableSetting

    $changes = [System.Collections.Generic.List[pscustomobject]]::new()
    foreach ($t in $templates) {
        $settings = $t['settingsJson']
        $name = [string]$settings['displayName']
        $type = Get-ReusableSettingTypeKey -SettingDefinitionId ([string]$settings['settingInstance']['settingDefinitionId'])
        $match = $live | Where-Object { $_.type -eq $type -and $_.displayName -ieq $name } | Select-Object -First 1

        $referencing = @()
        if ($match) {
            $diff = @(Get-ReusableSettingDiff -Before $match.settingInstance -After $settings['settingInstance'])
            $action = if ($diff.Count -gt 0) { 'update' } else { 'none' }
            if ($action -eq 'update') {
                $refs = Invoke-MgGraphRequest -Method GET -Uri "$($script:ReusableSettingsUri)/$($match.id)/referencingConfigurationPolicies?`$select=id,name"
                $referencing = @(foreach ($p in @(Get-ReusableSettingValue -Object $refs -Name 'value')) {
                        if ($p) {
                            [pscustomobject]@{
                                id   = [string](Get-ReusableSettingValue -Object $p -Name 'id')
                                name = [string](Get-ReusableSettingValue -Object $p -Name 'name')
                            }
                        }
                    })
            }
        }
        else {
            $diff = @("+ Reusable setting: $name") + @(Get-ReusableSettingDiff -Before $null -After $settings['settingInstance'])
            $action = 'create'
        }

        $changes.Add([pscustomobject]@{
                templateId          = [string]$t['id']
                displayName         = $name
                type                = $type
                action              = $action
                settingId           = if ($match) { $match.id } else { $null }
                diff                = @($diff)
                referencingPolicies = $referencing
            })
    }

    if ($DryRun) {
        return [pscustomobject]@{
            tenantId    = $TenantId
            preview     = $true
            changes     = @($changes)
            results     = @()
            auditEvents = @()
        }
    }

    $results = [System.Collections.Generic.List[pscustomobject]]::new()
    $auditEvents = [System.Collections.Generic.List[pscustomobject]]::new()
    foreach ($change in $changes) {
        if ($change.action -eq 'none') {
            $results.Add([pscustomobject]@{ templateId = $change.templateId; displayName = $change.displayName; status = 'skipped'; settingId = $change.settingId; error = $null })
            continue
        }
        $template = $templates | Where-Object { $_['id'] -eq $change.templateId } | Select-Object -First 1
        $body = @{}
        foreach ($key in $template['settingsJson'].Keys) { $body[$key] = $template['settingsJson'][$key] }
        $body['@odata.type'] = '#microsoft.graph.deviceManagementReusablePolicySetting'
        $before = $null
        try {
            if ($change.action -eq 'create') {
                $created = Invoke-MgGraphRequest -Method POST -Uri $script:ReusableSettingsUri -Body ($body | ConvertTo-Json -Depth 30 -Compress)
                $settingId = [string](Get-ReusableSettingValue -Object $created -Name 'id')
            }
            else {
                $settingId = $change.settingId
                $before = ($live | Where-Object { $_.id -eq $settingId } | Select-Object -First 1).settingInstance
                $null = Invoke-MgGraphRequest -Method PUT -Uri "$($script:ReusableSettingsUri)/$settingId" -Body ($body | ConvertTo-Json -Depth 30 -Compress)
            }
            $results.Add([pscustomobject]@{ templateId = $change.templateId; displayName = $change.displayName; status = 'succeeded'; settingId = $settingId; error = $null })
            $auditEvents.Add([pscustomobject]@{
                    id                  = [guid]::NewGuid().ToString()
                    tenantId            = $TenantId
                    action              = "intune.reusable-setting.$($change.action)"
                    targetId            = $settingId
                    targetName          = $change.displayName
                    templateId          = $change.templateId
                    referencingPolicies = @($change.referencingPolicies | ForEach-Object { $_.id })
                    actor               = $Actor
                    timestamp           = (Get-Date).ToUniversalTime().ToString('o')
                    before              = $before
                    after               = $template['settingsJson']['settingInstance']
                })
        }
        catch {
            $results.Add([pscustomobject]@{ templateId = $change.templateId; displayName = $change.displayName; status = 'failed'; settingId = $change.settingId; error = $_.ToString() })
        }
    }

    return [pscustomobject]@{
        tenantId    = $TenantId
        preview     = $false
        changes     = @($changes)
        results     = @($results)
        auditEvents = @($auditEvents)
    }
}
