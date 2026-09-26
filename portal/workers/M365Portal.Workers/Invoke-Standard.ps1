# Invoke-Standard.ps1
# EPIC-008 SPEC.md §4.2, §4.4, §8 — per-standard execution (report / alert /
# remediate). T-0145.
#
# One standard maps 1:1 to a registry check and runs the same three-branch shape
# as CIPP's Invoke-CIPPStandard* scripts:
#   1. read current state;
#   2. `remediate` -> route through EPIC-006 (plan/apply, audit) — never a private
#      write path (§8: standards reuse EPIC-006 entirely);
#   3. `alert`    -> raise via EPIC-029 when current != desired;
#   4. `report`   -> record current vs expected (a Set-CIPPStandardsCompareField
#      analogue) for alignment.
# `autoRemediate` implies `remediate` + `report`.
#
# Licence gating (§4.4): a standard whose licence is missing is SKIPPED with state
# `license missing`, not failed. The classification is computed upstream (T-0144)
# and passed in via -LicenseState, or supplied by the -TestLicense seam.
#
# Everything that reads or writes the tenant is an injectable seam so the unit
# tests exercise the orchestration without Graph/EXO/Purview or a queue.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The default remediation seam reuses the EPIC-006 contract; dot-source the
# handlers when present (a test that injects both seams runs without them).
$script:StandardRemediationRoot = $PSScriptRoot
foreach ($handler in @('Plan-Remediation.ps1', 'Invoke-RemediationApply.ps1')) {
    $handlerPath = Join-Path -Path $script:StandardRemediationRoot -ChildPath $handler
    if (Test-Path -LiteralPath $handlerPath -PathType Leaf) {
        . $handlerPath
    }
}

function Get-StandardOptionalProperty {
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

function ConvertTo-StandardComparable {
    <#
    .SYNOPSIS
        Produces a stable JSON string for value comparison.
    .DESCRIPTION
        Recursively sorts object keys so two structurally equal values serialize
        identically regardless of property order. Used to decide whether current
        state already matches the desired state.
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
            '"{0}":{1}' -f $_, (ConvertTo-StandardComparable -Value $Value[$_] -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @($Value) | ForEach-Object { ConvertTo-StandardComparable -Value $_ -Depth ($Depth + 1) }
        return '[' + ($items -join ',') + ']'
    }
    $properties = @($Value.PSObject.Properties | Where-Object { $_.MemberType -in @('NoteProperty', 'Property') })
    if ($properties.Count -gt 0) {
        $pairs = $properties | Sort-Object Name | ForEach-Object {
            '"{0}":{1}' -f $_.Name, (ConvertTo-StandardComparable -Value $_.Value -Depth ($Depth + 1))
        }
        return '{' + ($pairs -join ',') + '}'
    }
    return ([string]$Value | ConvertTo-Json -Compress)
}

function Test-StandardDesiredState {
    <#
    .SYNOPSIS
        True when the current state already matches the expected state.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter()][AllowNull()][object]$Current,
        [Parameter()][AllowNull()][object]$Expected
    )
    if ($null -eq $Expected) { return $null -eq $Current }
    return (ConvertTo-StandardComparable -Value $Current) -eq (ConvertTo-StandardComparable -Value $Expected)
}

function Get-StandardRemediationState {
    param([Parameter()][object]$ApplyResult)
    $failed = Get-StandardOptionalProperty -Object (Get-StandardOptionalProperty -Object $ApplyResult -Name 'Summary') -Name 'failed'
    if ($null -ne $failed -and [int]$failed -gt 0) { return 'failed' }
    $state = Get-StandardOptionalProperty -Object $ApplyResult -Name 'State'
    if ($state) { return [string]$state }
    $applied = Get-StandardOptionalProperty -Object (Get-StandardOptionalProperty -Object $ApplyResult -Name 'Summary') -Name 'applied'
    if ($null -ne $applied -and [int]$applied -gt 0) { return 'applied' }
    return 'applied'
}

function Invoke-Standard {
    <#
    .SYNOPSIS
        Executes one standard for a tenant (report / alert / remediate).
    .DESCRIPTION
        Implements EPIC-008 SPEC.md §4.2. Reads current state, records the
        current-vs-expected comparison when `report` is set, routes a mismatch
        through the EPIC-006 plan/apply contract when `remediate` (or
        `autoRemediate`) is set, and raises an alert when `alert` is set. A
        missing licence skips the standard with state `license missing` and never
        fails it (§4.4). This function performs no direct tenant writes: all
        tenant interaction is through the injected seams.
    .PARAMETER TenantId
    .PARAMETER Check
        The standard's registry check id.
    .PARAMETER Expected
        The desired state (from the effective template).
    .PARAMETER Current
        The current state, when the caller already read it. Ignored when
        -ReadCurrentState is supplied.
    .PARAMETER Report / Alert / Remediate / AutoRemediate
        The template action flags. AutoRemediate implies Report + Remediate.
    .PARAMETER LicenseState
        Upstream licence classification (T-0144). Anything other than `eligible`
        skips the standard.
    .PARAMETER RunAt
        ISO-8601 timestamp recorded on the comparison row; defaults to now.
    .PARAMETER ReadCurrentState
        Seam: scriptblock (check) -> current state.
    .PARAMETER WriteCompare
        Seam: scriptblock (comparisonRow) -> void. Records the StandardCompare row.
    .PARAMETER ApplyRemediation
        Seam: scriptblock (check, expected) -> apply result. Defaults to the
        EPIC-006 plan/apply contract.
    .PARAMETER RaiseAlert
        Seam: scriptblock (alertEvent) -> void (EPIC-029).
    .PARAMETER WriteAudit
        Seam: scriptblock (auditEvent) -> void.
    .PARAMETER TestLicense
        Seam: scriptblock (check) -> licence state; overrides -LicenseState.
    .OUTPUTS
        [PSCustomObject] with TenantId, Check, State, LicenseState, DesiredMet,
        Reported, Remediated, Alerted, RemediationState, Current, Expected, Error.
    .EXAMPLE
        Invoke-Standard -TenantId 'contoso' -Check 'ENTRA-SECDEFAULT-001' -Expected $desired -Report
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Check,

        [Parameter()][AllowNull()][object]$Expected,

        [Parameter()][AllowNull()][object]$Current,

        [Parameter()][string]$TemplateId = '',

        [Parameter()][bool]$Report = $true,

        [Parameter()][bool]$Alert = $false,

        [Parameter()][bool]$Remediate = $false,

        [Parameter()][bool]$AutoRemediate = $false,

        [Parameter()][string]$LicenseState = 'eligible',

        [Parameter()][string]$RunAt = '',

        [Parameter()][string]$Actor = '',

        [Parameter()][string]$CorrelationId = '',

        [Parameter()][scriptblock]$ReadCurrentState,

        [Parameter()][scriptblock]$WriteCompare,

        [Parameter()][scriptblock]$ApplyRemediation,

        [Parameter()][scriptblock]$RaiseAlert,

        [Parameter()][scriptblock]$WriteAudit,

        [Parameter()][scriptblock]$TestLicense
    )

    # autoRemediate implies remediate + report (SPEC §4.2).
    if ($AutoRemediate) {
        $Remediate = $true
        $Report = $true
    }
    if (-not $RunAt) { $RunAt = [DateTime]::UtcNow.ToString('o') }
    if (-not $WriteCompare) { $WriteCompare = { param($row) } }
    if (-not $RaiseAlert) { $RaiseAlert = { param($event) } }
    if (-not $WriteAudit) { $WriteAudit = { param($event) } }

    $effectiveLicense = $LicenseState
    if ($null -ne $TestLicense) {
        $effectiveLicense = [string](& $TestLicense $Check)
    }

    # ── Licence gate (§4.4): skip, never fail, and record the state. ──────────
    if ($effectiveLicense -ne 'eligible') {
        $licenseRow = [ordered]@{
            tenantId  = $TenantId
            check     = $Check
            templateId = if ($TemplateId) { $TemplateId } else { $null }
            current   = $null
            expected  = $Expected
            state     = 'license missing'
            lastRunAt = $RunAt
        }
        if ($Report) { & $WriteCompare $licenseRow }
        & $WriteAudit ([ordered]@{
            action = 'standards.standard'; result = 'skipped'; tenantId = $TenantId
            resourceId = $Check; templateId = $TemplateId; reason = 'license missing'
            licenseState = $effectiveLicense; actorUserId = $Actor
            correlationId = $CorrelationId; timestamp = $RunAt
        })
        return [PSCustomObject]@{
            TenantId         = $TenantId
            Check            = $Check
            TemplateId       = $TemplateId
            State            = 'license missing'
            LicenseState     = $effectiveLicense
            DesiredMet       = $false
            Reported         = [bool]$Report
            Remediated       = $false
            Alerted          = $false
            RemediationState = $null
            Current          = $null
            Expected         = $Expected
            Error            = $null
        }
    }

    # ── 1. Read current state. ────────────────────────────────────────────────
    $currentState = $Current
    if ($null -ne $ReadCurrentState) {
        $currentState = & $ReadCurrentState $Check
    }
    $desiredMet = Test-StandardDesiredState -Current $currentState -Expected $Expected

    # ── 4. Report: record current vs expected for alignment. ──────────────────
    $reported = $false
    if ($Report) {
        & $WriteCompare ([ordered]@{
            tenantId  = $TenantId
            check     = $Check
            templateId = if ($TemplateId) { $TemplateId } else { $null }
            current   = $currentState
            expected  = $Expected
            state     = if ($desiredMet) { 'compliant' } else { 'non-compliant' }
            lastRunAt = $RunAt
        })
        $reported = $true
    }

    # ── 2. Remediate: route through EPIC-006, never a private write path. ─────
    $remediationState = $null
    $remediated = $false
    if ($Remediate -and -not $desiredMet) {
        if (-not $ApplyRemediation) {
            $ApplyRemediation = {
                param($check, $expected)
                $finding = [PSCustomObject]@{ Id = "$check-standard"; CheckId = $check; Status = 'Fail' }
                $plan = New-RemediationPlan -Findings @($finding) -TenantId $TenantId -CreatedBy $Actor -CorrelationId $CorrelationId
                return Invoke-RemediationApply `
                    -Actions $plan.Actions `
                    -PlanId $plan.Plan.id `
                    -TenantId $TenantId `
                    -Actor $Actor `
                    -CorrelationId $CorrelationId `
                    -DryRun:$false
            }
        }
        try {
            $applyResult = & $ApplyRemediation $Check $Expected
            $remediationState = Get-StandardRemediationState -ApplyResult $applyResult
            $remediated = $remediationState -eq 'applied'
            & $WriteAudit ([ordered]@{
                action = 'standards.remediate'; result = $(if ($remediationState -eq 'failed') { 'failure' } else { 'success' })
                tenantId = $TenantId; resourceId = $Check; templateId = $TemplateId
                remediationState = $remediationState; actorUserId = $Actor
                correlationId = $CorrelationId; timestamp = $RunAt
            })
        }
        catch {
            $remediationState = 'failed'
            & $WriteAudit ([ordered]@{
                action = 'standards.remediate'; result = 'failure'; tenantId = $TenantId
                resourceId = $Check; templateId = $TemplateId; error = $_.Exception.Message
                actorUserId = $Actor; correlationId = $CorrelationId; timestamp = $RunAt
            })
        }
    }

    # ── 3. Alert: raise via EPIC-029 when current != desired. ─────────────────
    $alerted = $false
    if ($Alert -and -not $desiredMet) {
        & $RaiseAlert ([ordered]@{
            kind = 'standards.non-compliant'; tenantId = $TenantId; check = $Check
            templateId = $TemplateId; current = $currentState; expected = $Expected
            correlationId = $CorrelationId; timestamp = $RunAt
        })
        $alerted = $true
    }

    $state = if ($desiredMet) { 'compliant' }
        elseif ($remediationState -eq 'failed') { 'failed' }
        elseif ($remediated) { 'remediated' }
        else { 'non-compliant' }

    return [PSCustomObject]@{
        TenantId         = $TenantId
        Check            = $Check
        TemplateId       = $TemplateId
        State            = $state
        LicenseState     = $effectiveLicense
        DesiredMet       = $desiredMet
        Reported         = $reported
        Remediated       = $remediated
        Alerted          = $alerted
        RemediationState = $remediationState
        Current          = $currentState
        Expected         = $Expected
        Error            = $null
    }
}
