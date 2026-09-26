# Invoke-Drift.ps1
# EPIC-009 SPEC.md §4.1, §11.2 — drift detection (US-1, US-2). T-0163.
#
# Computes deviations in two directions, matching CIPP's Get-CIPPDrift model:
#   1. in-template mismatch — a defined setting whose current value differs from
#      the template's expected value;
#   2. extra policy — a resource present in the tenant but absent from the
#      template. §11.2 adopts CA + Intune first for this dimension.
#
# Every deviation is upserted through the T-0162 repository seam, which preserves
# prior triage state (accepted / customer specific / denied) so a re-run never
# resurrects a settled item. The worker never resolves or deletes a deviation:
# closing one is an explicit operator action (T-0165/T-0166).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The resource types that participate in "extra policy" detection (SPEC §11.2).
$script:DriftExtraResourceTypes = @('conditionalAccess', 'intune')

function Get-DriftOptionalProperty {
    param(
        [Parameter()][object]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}

function ConvertTo-DriftComparable {
    <#
    .SYNOPSIS
        Stable JSON of a value, with object keys sorted for order-independent equality.
    #>
    [CmdletBinding()]
    param([Parameter()][object]$Value, [Parameter()][int]$Depth = 0)

    if ($null -eq $Value) { return 'null' }
    if ($Depth -gt 12) { return '"<max-depth>"' }
    if ($Value -is [string]) { return ($Value | ConvertTo-Json -Compress) }
    if ($Value -is [bool] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        return ($Value | ConvertTo-Json -Compress)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $pairs = $Value.Keys | Sort-Object | ForEach-Object {
            '"{0}":{1}' -f $_, (ConvertTo-DriftComparable -Value $Value[$_] -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @($Value) | ForEach-Object { ConvertTo-DriftComparable -Value $_ -Depth ($Depth + 1) }
        return '[' + ($items -join ',') + ']'
    }
    $properties = @($Value.PSObject.Properties | Where-Object { $_.MemberType -in @('NoteProperty', 'Property') })
    if ($properties.Count -gt 0) {
        $pairs = $properties | Sort-Object Name | ForEach-Object {
            '"{0}":{1}' -f $_.Name, (ConvertTo-DriftComparable -Value $_.Value -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    return ([string]$Value | ConvertTo-Json -Compress)
}

function Test-DriftValueEqual {
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter()][AllowNull()][object]$Current,
        [Parameter()][AllowNull()][object]$Expected
    )
    return (ConvertTo-DriftComparable -Value $Current) -eq (ConvertTo-DriftComparable -Value $Expected)
}

function Resolve-DriftResourceType {
    <#
    .SYNOPSIS
        Normalises a resource type to the CA/Intune taxonomy, or $null when the
        type does not participate in extra-policy detection (SPEC §11.2).
    #>
    [CmdletBinding()]
    param([Parameter()][string]$ResourceType)
    switch -Regex ($ResourceType) {
        '^(?i)(conditional[-_]?access|ca)$' { return 'conditionalAccess' }
        '^(?i)(intune|deviceManagement)$' { return 'intune' }
        default { return $null }
    }
}

function Invoke-Drift {
    <#
    .SYNOPSIS
        Computes and upserts a tenant's drift deviations.
    .DESCRIPTION
        Implements EPIC-009 SPEC.md §4.1: reads the tenant's current state and the
        drift template's expected settings, then emits in-template mismatches and
        extra policies (CA + Intune) as deviations. Deviations are handed to the
        T-0162 upsert seam, which preserves triage state; this function never
        resolves or deletes a deviation.
        Auto-remediation (SPEC §4.3, §11.5) applies only the mismatches whose
        setting key is listed in -AutoRemediateKeys, and every write routes through
        the EPIC-006 contract via -ApplyRemediation; a gate failure skips the item
        and records the reason. Drift stays report-only when no key is listed.
    .PARAMETER TenantId
    .PARAMETER ExpectedSettings
        The drift template's settings; each has Key, Value, and an optional ResourceId.
    .PARAMETER TemplateId
        Provenance recorded on the result.
    .PARAMETER CollectCurrentState
        Seam: scriptblock (key, resourceId) -> current value.
    .PARAMETER CollectExtraPolicies
        Seam: scriptblock -> array of objects with ResourceType, ResourceId, Value.
    .PARAMETER UpsertDeviations
        Seam: scriptblock (tenantId, deviations) -> upsert result (T-0162).
    .PARAMETER AutoRemediateKeys
        Setting keys opted into auto-remediation; empty means report-only (§11.5).
    .PARAMETER ApplyRemediation
        Seam: scriptblock (standardKey, resourceId, expected) -> apply result with
        State/Reason. Defaults to a no-op; the default must be overridden with the
        EPIC-006 plan/apply contract when auto-remediation is enabled.
    .PARAMETER RunAt
        ISO-8601 timestamp; defaults to now.
    .OUTPUTS
        [PSCustomObject] with TenantId, TemplateId, Deviations, Counts, Upsert,
        Remediations, RemediationSummary.
    .EXAMPLE
        Invoke-Drift -TenantId 'contoso' -ExpectedSettings $settings -CollectCurrentState $reader
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [AllowEmptyCollection()]
        [object[]]$ExpectedSettings = @(),

        [Parameter()]
        [string]$TemplateId = '',

        [Parameter()]
        [scriptblock]$CollectCurrentState,

        [Parameter()]
        [scriptblock]$CollectExtraPolicies,

        [Parameter()]
        [scriptblock]$UpsertDeviations,

        [Parameter()]
        [AllowEmptyCollection()]
        [string[]]$AutoRemediateKeys = @(),

        [Parameter()]
        [scriptblock]$ApplyRemediation,

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [string]$RunAt = ''
    )

    if (-not $RunAt) { $RunAt = [DateTime]::UtcNow.ToString('o') }
    if (-not $CollectCurrentState) { $CollectCurrentState = { param($key, $resourceId) $null } }
    if (-not $CollectExtraPolicies) { $CollectExtraPolicies = { @() } }
    if (-not $UpsertDeviations) { $UpsertDeviations = { param($tenantId, $deviations) $null } }
    if (-not $ApplyRemediation) { $ApplyRemediation = { param($standardKey, $resourceId, $expected) $null } }
    $autoKeys = @($AutoRemediateKeys)

    $deviations = New-Object System.Collections.Generic.List[object]
    $mismatchCount = 0
    $extraCount = 0

    # ── 1. In-template mismatches. ────────────────────────────────────────────
    foreach ($setting in $ExpectedSettings) {
        $key = [string](Get-DriftOptionalProperty -Object $setting -Name 'key')
        if (-not $key) { continue }
        $resourceId = [string](Get-DriftOptionalProperty -Object $setting -Name 'resourceId')
        if (-not $resourceId) { $resourceId = '' }
        $expected = Get-DriftOptionalProperty -Object $setting -Name 'value'
        $current = & $CollectCurrentState $key $resourceId
        if (-not (Test-DriftValueEqual -Current $current -Expected $expected)) {
            $mismatchCount++
            $deviations.Add([PSCustomObject]@{
                standardKey = $key
                resourceId  = $resourceId
                kind        = 'mismatch'
                current     = $current
                expected    = $expected
                lastSeenAt  = $RunAt
            }) | Out-Null
        }
    }

    # ── 2. Extra policies (CA + Intune, SPEC §11.2). ──────────────────────────
    foreach ($policy in @(& $CollectExtraPolicies)) {
        $resourceType = Resolve-DriftResourceType -ResourceType ([string](Get-DriftOptionalProperty -Object $policy -Name 'resourceType'))
        if (-not $resourceType) { continue }
        $resourceId = [string](Get-DriftOptionalProperty -Object $policy -Name 'resourceId')
        if (-not $resourceId) { continue }
        $extraCount++
        $deviations.Add([PSCustomObject]@{
            # An extra has no template standard; the synthetic key names the
            # resource type so triage rows stay self-describing.
            standardKey = "extra:$resourceType"
            resourceId  = $resourceId
            kind        = 'extra'
            current     = Get-DriftOptionalProperty -Object $policy -Name 'value'
            expected    = $null
            lastSeenAt  = $RunAt
        }) | Out-Null
    }

    $upsert = $null
    if ($deviations.Count -gt 0) {
        $upsert = & $UpsertDeviations $TenantId $deviations.ToArray()
    }

    # ── 3. Auto-remediation (opt-in per setting, SPEC §4.3/§11.5, §8). ────────
    # Drift is report-only unless a setting's key is listed in -AutoRemediateKeys.
    # Extras are never auto-remediated (deleting a resource is the destructive
    # deny path, T-0166). Every write routes through EPIC-006 via the seam; a
    # gate failure skips the item and records the reason.
    $remediations = New-Object System.Collections.Generic.List[object]
    foreach ($deviation in $deviations) {
        if ($deviation.kind -ne 'mismatch') { continue }
        if ($autoKeys -notcontains $deviation.standardKey) { continue }

        try {
            $applyResult = & $ApplyRemediation $deviation.standardKey $deviation.resourceId $deviation.expected
            $state = 'applied'
            $reason = $null
            if ($null -ne $applyResult) {
                if ($null -ne $applyResult.PSObject.Properties['State']) { $state = [string]$applyResult.State }
                if ($null -ne $applyResult.PSObject.Properties['Reason']) { $reason = $applyResult.Reason }
            }
            switch ($state) {
                'applied' { $outcome = 'remediated' }
                'failed' { $outcome = 'failed' }
                default {
                    # skipped / rejected / not-implemented: a gate did not pass.
                    $outcome = 'skipped'
                    if (-not $reason) { $reason = $state }
                }
            }
            if ($outcome -eq 'failed' -and -not $reason) { $reason = 'remediation failed' }
        }
        catch {
            $outcome = 'failed'
            $reason = $_.Exception.Message
        }

        $remediations.Add([PSCustomObject]@{
            standardKey = $deviation.standardKey
            resourceId  = $deviation.resourceId
            outcome     = $outcome
            reason      = $reason
        }) | Out-Null
    }

    $remediationSummary = [PSCustomObject]@{
        total      = $remediations.Count
        remediated = @($remediations | Where-Object { $_.outcome -eq 'remediated' }).Count
        skipped    = @($remediations | Where-Object { $_.outcome -eq 'skipped' }).Count
        failed     = @($remediations | Where-Object { $_.outcome -eq 'failed' }).Count
    }

    return [PSCustomObject]@{
        TenantId    = $TenantId
        TemplateId  = $TemplateId
        Deviations  = $deviations.ToArray()
        Counts      = [PSCustomObject]@{ mismatch = $mismatchCount; extra = $extraCount; total = $deviations.Count }
        Upsert      = $upsert
        Remediations = $remediations.ToArray()
        RemediationSummary = $remediationSummary
        CorrelationId = $CorrelationId
        RunAt       = $RunAt
    }
}
