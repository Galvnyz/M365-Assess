# Invoke-RemediationVerify.ps1
# EPIC-006 SPEC.md §4.4, §11 item 5 — verify after apply (US-6). T-0109.
#
# After an action is applied, re-run the affected collector and re-evaluate the
# finding:
#   - Success (finding flips to Pass) -> action state `applied`, finding updated.
#   - Still failing/partial           -> action state `failed` + an alert.
#
# Re-collection strategy (SPEC §11 item 5): single-check re-collection where the
# collector supports it, otherwise re-run the whole section. The strategy choice
# and both collection paths are injectable seams so the orchestration is testable
# without a live collector.
#
# Verify is read-only against the tenant: it re-reads state, it never writes to
# the tenant. Only the RemediationAction update + finding re-evaluation +
# AuditEvent are persisted, all through injected seams.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-VerifyOptionalProperty {
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

function Get-VerifyRegistryKey {
    param([Parameter(Mandatory)][string]$CheckId)
    return ($CheckId -replace '\.\d+$', '')
}

function Select-VerifyFinding {
    <#
    .SYNOPSIS
        Finds the finding for a check within a collection result.
    .DESCRIPTION
        Matches by exact CheckId first, then by registry key (sub-number
        stripped) so a section re-run whose ids are sub-numbered still resolves.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Findings,
        [Parameter(Mandatory)][string]$CheckId
    )
    $registryKey = Get-VerifyRegistryKey -CheckId $CheckId
    foreach ($finding in $Findings) {
        if ([string](Get-VerifyOptionalProperty -Object $finding -Name 'CheckId') -eq $CheckId) {
            return $finding
        }
    }
    foreach ($finding in $Findings) {
        $candidate = [string](Get-VerifyOptionalProperty -Object $finding -Name 'CheckId')
        if ($candidate -and (Get-VerifyRegistryKey -CheckId $candidate) -eq $registryKey) {
            return $finding
        }
    }
    return $null
}

function Invoke-RemediationVerify {
    <#
    .SYNOPSIS
        Verifies a remediation action by re-running its collector.
    .DESCRIPTION
        Implements EPIC-006 SPEC.md §4.4. Chooses single-check re-collection when
        the collector supports it, otherwise re-runs the section, then flips the
        action/finding to applied on success or records `failed` + raises an alert
        otherwise. Every verify writes an AuditEvent.
    .PARAMETER Action
        The applied action (id, checkId, optional section).
    .PARAMETER TenantId
    .PARAMETER Section
        Fallback section to re-run when single-check re-collection is unavailable.
    .PARAMETER SingleCheckSupported
        Explicit support flag; used when -TestSingleCheckSupport is not supplied.
    .PARAMETER TestSingleCheckSupport
        Seam: scriptblock (checkId) -> bool. Overrides -SingleCheckSupported.
    .PARAMETER CollectCheck
        Seam: scriptblock (checkId) -> finding (single-check re-collection).
    .PARAMETER CollectSection
        Seam: scriptblock (section) -> findings[] (section re-run fallback).
    .PARAMETER UpdateAction
        Seam: scriptblock (actionId, update) -> void.
    .PARAMETER UpdateFinding
        Seam: scriptblock (findingId, update) -> void (EPIC-001 run persistence).
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void.
    .PARAMETER RaiseAlert
        Seam: scriptblock (event) -> void (failure/partial alerting, EPIC-029).
    .PARAMETER Actor
    .PARAMETER CorrelationId
    .OUTPUTS
        [PSCustomObject] with ActionId, CheckId, Strategy, FindingStatus, Passed,
        ActionState, ReEvaluated, Alerted.
    .EXAMPLE
        Invoke-RemediationVerify -Action $action -TenantId 'contoso' -SingleCheckSupported
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [object]$Action,

        [Parameter()]
        [string]$TenantId = '',

        [Parameter()]
        [string]$Section = '',

        [Parameter()]
        [bool]$SingleCheckSupported = $false,

        [Parameter()]
        [scriptblock]$TestSingleCheckSupport,

        [Parameter()]
        [scriptblock]$CollectCheck,

        [Parameter()]
        [scriptblock]$CollectSection,

        [Parameter()]
        [scriptblock]$UpdateAction,

        [Parameter()]
        [scriptblock]$UpdateFinding,

        [Parameter()]
        [scriptblock]$WriteAudit,

        [Parameter()]
        [scriptblock]$RaiseAlert,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = ''
    )

    $actionId = [string](Get-VerifyOptionalProperty -Object $Action -Name 'id')
    $checkId = [string](Get-VerifyOptionalProperty -Object $Action -Name 'checkId')
    if (-not $actionId) {
        throw [System.ArgumentException]::new('remediation.verify_missing_action_id: Action.id is required.')
    }
    if (-not $checkId) {
        throw [System.ArgumentException]::new('remediation.verify_missing_check_id: Action.checkId is required.')
    }
    if (-not $Section) {
        $Section = [string](Get-VerifyOptionalProperty -Object $Action -Name 'section')
    }

    if (-not $CollectCheck) {
        $CollectCheck = {
            param($id)
            throw "remediation.verify_no_collector: no single-check collector is configured for '$id'"
        }
    }
    if (-not $CollectSection) {
        $CollectSection = {
            param($name)
            throw "remediation.verify_no_collector: no section collector is configured for '$name'"
        }
    }
    if (-not $UpdateAction) { $UpdateAction = { param($id, $update) } }
    if (-not $UpdateFinding) { $UpdateFinding = { param($id, $update) } }
    if (-not $WriteAudit) { $WriteAudit = { param($event) } }
    if (-not $RaiseAlert) { $RaiseAlert = { param($event) } }

    # Choose the re-collection strategy (SPEC §11 item 5).
    $supportsSingle = $SingleCheckSupported
    if ($null -ne $TestSingleCheckSupport) {
        $supportsSingle = [bool](& $TestSingleCheckSupport $checkId)
    }

    $finding = $null
    if ($supportsSingle) {
        $strategy = 'single-check'
        $finding = & $CollectCheck $checkId
    }
    else {
        $strategy = 'section'
        if (-not $Section) {
            throw [System.InvalidOperationException]::new(
                "remediation.verify_no_section: check '$checkId' has no single-check collector and no section to re-run.")
        }
        $sectionFindings = @(& $CollectSection $Section)
        $finding = Select-VerifyFinding -Findings $sectionFindings -CheckId $checkId
    }

    if ($null -eq $finding) {
        $now = [DateTime]::UtcNow.ToString('o')
        $reason = "finding-not-recollected: no finding for '$checkId' after $strategy re-collection"
        & $UpdateAction $actionId @{ state = 'failed'; error = $reason; appliedAt = $now; appliedBy = $Actor }
        & $RaiseAlert ([ordered]@{
            kind = 'remediation.verify'; tenantId = $TenantId; actionId = $actionId
            checkId = $checkId; reason = $reason; timestamp = $now
        })
        & $WriteAudit ([ordered]@{
            action = 'remediation.verify'; result = 'failure'; tenantId = $TenantId
            resourceId = $actionId; checkId = $checkId; strategy = $strategy
            error = $reason; actorUserId = $Actor; correlationId = $CorrelationId; timestamp = $now
        })
        return [PSCustomObject]@{
            ActionId = $actionId; CheckId = $checkId; Strategy = $strategy
            FindingStatus = $null; Passed = $false; ActionState = 'failed'
            ReEvaluated = $false; Alerted = $true
        }
    }

    $findingId = [string](Get-VerifyOptionalProperty -Object $finding -Name 'Id')
    $findingStatus = [string](Get-VerifyOptionalProperty -Object $finding -Name 'Status')
    $passed = $findingStatus -eq 'Pass'
    $now = [DateTime]::UtcNow.ToString('o')

    if ($passed) {
        & $UpdateAction $actionId @{ state = 'applied'; error = $null; appliedAt = $now; appliedBy = $Actor; result = @{ verifiedStatus = $findingStatus } }
        if ($findingId) {
            & $UpdateFinding $findingId @{ status = 'Pass'; updatedAt = $now }
        }
        & $WriteAudit ([ordered]@{
            action = 'remediation.verify'; result = 'success'; tenantId = $TenantId
            resourceId = $actionId; checkId = $checkId; strategy = $strategy
            findingStatus = $findingStatus; actorUserId = $Actor
            correlationId = $CorrelationId; timestamp = $now
        })
        return [PSCustomObject]@{
            ActionId = $actionId; CheckId = $checkId; Strategy = $strategy
            FindingStatus = $findingStatus; Passed = $true; ActionState = 'applied'
            ReEvaluated = [bool]$findingId; Alerted = $false
        }
    }

    # Failure / partial: action failed, finding left as-is (not flipped), alert.
    $reason = "verify-failed: finding status '$findingStatus'"
    & $UpdateAction $actionId @{ state = 'failed'; error = $reason; appliedAt = $now; appliedBy = $Actor; result = @{ verifiedStatus = $findingStatus } }
    & $RaiseAlert ([ordered]@{
        kind = 'remediation.verify'; tenantId = $TenantId; actionId = $actionId
        checkId = $checkId; findingStatus = $findingStatus; reason = $reason; timestamp = $now
    })
    & $WriteAudit ([ordered]@{
        action = 'remediation.verify'; result = 'failure'; tenantId = $TenantId
        resourceId = $actionId; checkId = $checkId; strategy = $strategy
        findingStatus = $findingStatus; error = $reason; actorUserId = $Actor
        correlationId = $CorrelationId; timestamp = $now
    })
    return [PSCustomObject]@{
        ActionId = $actionId; CheckId = $checkId; Strategy = $strategy
        FindingStatus = $findingStatus; Passed = $false; ActionState = 'failed'
        ReEvaluated = $false; Alerted = $true
    }
}
