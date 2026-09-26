# Invoke-Baseline.ps1
# EPIC-010 SPEC.md §4.3, §8 — baseline state collectors + gated apply (T-0184).
#
# Baselines reuse the same two-function shape CIPP uses: a state collector
# reads current state, an apply step writes it. Every apply write routes
# through the EPIC-006 remediation contract via -ApplyRemediation; there is no
# baseline-specific executor. Licence/service/RBAC/scope/allowlist/audit gates
# live behind that contract: a gate failure skips the action and records why.
# Stages with action 'report' never write — the collector only records
# current-vs-expected.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BaselineOptionalProperty {
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

function ConvertTo-BaselineComparable {
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
            '"{0}":{1}' -f $_, (ConvertTo-BaselineComparable -Value $Value[$_] -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @($Value) | ForEach-Object { ConvertTo-BaselineComparable -Value $_ -Depth ($Depth + 1) }
        return '[' + ($items -join ',') + ']'
    }
    $properties = @($Value.PSObject.Properties | Where-Object { $_.MemberType -in @('NoteProperty', 'Property') })
    if ($properties.Count -gt 0) {
        $pairs = $properties | Sort-Object Name | ForEach-Object {
            '"{0}":{1}' -f $_.Name, (ConvertTo-BaselineComparable -Value $_.Value -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    return ([string]$Value | ConvertTo-Json -Compress)
}

function Test-BaselineValueEqual {
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter()][AllowNull()][object]$Current,
        [Parameter()][AllowNull()][object]$Expected
    )
    return (ConvertTo-BaselineComparable -Value $Current) -eq (ConvertTo-BaselineComparable -Value $Expected)
}

function Invoke-Baseline {
    <#
    .SYNOPSIS
        Collects baseline state per stage and applies remediable mismatches.
    .DESCRIPTION
        Implements EPIC-010 SPEC.md §4.3: for each ordered stage, the state
        collector (-CollectStageState) reads the current value of every staged
        standard key without writing. Stages with action 'report' only record
        current-vs-expected. Stages with action 'remediate' route each mismatch
        through the EPIC-006 contract via -ApplyRemediation; a gate failure
        skips the action and records the reason. Every apply is reported to
        -WriteAudit. This function performs no direct tenant writes: all tenant
        interaction is through the injected seams.
    .PARAMETER TenantId
    .PARAMETER BaselineId
        Provenance recorded on the result and audit events.
    .PARAMETER Stages
        Ordered stages; each has order, conditions[] (key + expected), action.
    .PARAMETER CollectStageState
        Seam: scriptblock (key) -> current value.
    .PARAMETER ApplyRemediation
        Seam: scriptblock (standardKey, expected) -> apply result with
        State/Reason. Defaults to a no-op; the default must be overridden with
        the EPIC-006 plan/apply contract when remediation is enabled.
    .PARAMETER WriteAudit
        Seam: scriptblock (auditEvent) -> void.
    .PARAMETER RunAt
        ISO-8601 timestamp; defaults to now.
    .OUTPUTS
        [PSCustomObject] with TenantId, BaselineId, StageResults, Summary.
    .EXAMPLE
        Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' -Stages $stages -CollectStageState $reader
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$BaselineId,

        [Parameter()]
        [AllowEmptyCollection()]
        [object[]]$Stages = @(),

        [Parameter()]
        [scriptblock]$CollectStageState,

        [Parameter()]
        [scriptblock]$ApplyRemediation,

        [Parameter()]
        [scriptblock]$WriteAudit,

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [string]$RunAt = ''
    )

    if (-not $RunAt) { $RunAt = [DateTime]::UtcNow.ToString('o') }
    if (-not $CollectStageState) { $CollectStageState = { param($key) $null } }
    if (-not $ApplyRemediation) { $ApplyRemediation = { param($standardKey, $expected) $null } }
    if (-not $WriteAudit) { $WriteAudit = { param($auditEvent) } }

    $stageResults = New-Object System.Collections.Generic.List[object]
    $orderedStages = @($Stages | Sort-Object {
        $order = Get-BaselineOptionalProperty -Object $_ -Name 'order'
        if ($null -eq $order) { 0 } else { [int]$order }
    })

    foreach ($stage in $orderedStages) {
        $order = Get-BaselineOptionalProperty -Object $stage -Name 'order'
        if ($null -eq $order) { $order = 0 }
        $action = [string](Get-BaselineOptionalProperty -Object $stage -Name 'action')
        if (-not $action) { $action = 'report' }
        $conditions = @(Get-BaselineOptionalProperty -Object $stage -Name 'conditions')
        if ($conditions.Count -eq 1 -and $null -eq $conditions[0]) { $conditions = @() }

        $evaluated = 0
        $mismatched = 0
        $remediated = 0
        $skipped = 0
        $failed = 0

        foreach ($condition in $conditions) {
            $key = [string](Get-BaselineOptionalProperty -Object $condition -Name 'key')
            if (-not $key) { continue }
            $expected = Get-BaselineOptionalProperty -Object $condition -Name 'expected'
            # State collector: reads current state, never writes.
            $current = & $CollectStageState $key
            $evaluated++
            if (Test-BaselineValueEqual -Current $current -Expected $expected) { continue }
            $mismatched++

            # Report-only stages record the mismatch and stop there.
            if ($action -ne 'remediate') { continue }

            try {
                $applyResult = & $ApplyRemediation $key $expected
                $state = 'applied'
                $reason = $null
                if ($null -ne $applyResult) {
                    if ($null -ne $applyResult.PSObject.Properties['State']) { $state = [string]$applyResult.State }
                    if ($null -ne $applyResult.PSObject.Properties['Reason']) { $reason = $applyResult.Reason }
                }
                switch ($state) {
                    'applied' { $outcome = 'remediated'; $remediated++ }
                    'failed' {
                        $outcome = 'failed'; $failed++
                        if (-not $reason) { $reason = 'remediation failed' }
                    }
                    default {
                        # skipped / rejected / not-implemented: a gate did not pass.
                        $outcome = 'skipped'; $skipped++
                        if (-not $reason) { $reason = $state }
                    }
                }
            }
            catch {
                $outcome = 'failed'; $failed++
                $reason = $_.Exception.Message
            }

            & $WriteAudit ([PSCustomObject]@{
                action      = 'baseline.apply'
                tenantId    = $TenantId
                baselineId  = $BaselineId
                stage       = [int]$order
                standardKey = $key
                outcome     = $outcome
                reason      = $reason
                runAt       = $RunAt
            }) | Out-Null
        }

        $stageResults.Add([PSCustomObject]@{
            order      = [int]$order
            action     = $action
            evaluated  = $evaluated
            mismatched = $mismatched
            compliant  = ($mismatched -eq 0)
            remediated = $remediated
            skipped    = $skipped
            failed     = $failed
        }) | Out-Null
    }

    $results = $stageResults.ToArray()
    $summary = [PSCustomObject]@{
        stages     = $results.Count
        compliant  = @($results | Where-Object { $_.compliant }).Count
        remediated = ($results | Measure-Object -Property remediated -Sum).Sum
        skipped    = ($results | Measure-Object -Property skipped -Sum).Sum
        failed     = ($results | Measure-Object -Property failed -Sum).Sum
    }
    if ($null -eq $summary.remediated) { $summary.remediated = 0 }
    if ($null -eq $summary.skipped) { $summary.skipped = 0 }
    if ($null -eq $summary.failed) { $summary.failed = 0 }

    return [PSCustomObject]@{
        TenantId      = $TenantId
        BaselineId    = $BaselineId
        StageResults  = $results
        Summary       = $summary
        CorrelationId = $CorrelationId
        RunAt         = $RunAt
    }
}
