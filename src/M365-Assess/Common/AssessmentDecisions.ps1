function Import-AssessmentDecisions {
    <#
    .SYNOPSIS
        Validates a tenant-scoped assessor sidecar without changing observations.
    #>
    [CmdletBinding()]
    param([string]$Path, [string]$TenantId)
    if (-not $Path) { return $null }
    $json = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $schema = Join-Path -Path $PSScriptRoot -ChildPath '../schemas/assessment-decisions.schema.json'
    if (-not (Test-Json -Json $json -SchemaFile $schema -ErrorAction Stop)) { throw 'Invalid assessment decisions.' }
    $document = ConvertFrom-Json -InputObject $json
    if (-not $TenantId -or $document.tenantId -ne $TenantId) { throw 'Assessment decisions tenantId must match the collected tenant GUID.' }
    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($decision in $document.decisions) {
        if (-not $keys.Add("$($decision.checkId)`n$($decision.setting)")) { throw 'Duplicate assessor decision scope.' }
        if ([datetimeoffset]$decision.expiresAt -le [datetimeoffset]$decision.approvedAt) { throw 'Decision expiry must follow approval.' }
        foreach ($field in @('setting', 'justification', 'approvedBy', 'evidence')) {
            if ([string]::IsNullOrWhiteSpace($decision.$field)) { throw "Decision $field must not be blank." }
        }
    }
    return $document
}

function Add-AssessmentDecisions {
    <#
    .SYNOPSIS
        Adds decision metadata; Status and CurrentValue always remain observations.
    .DESCRIPTION
        Matches a base check and exact setting, never a mutable sub-number alone.
        Accepted risks must match the original observed value. Attestations apply
        only to Review findings. Expired, future, ambiguous and changed evidence
        decisions stay visible but cannot remove findings from actionable work.
    #>
    [CmdletBinding()]
    param([AllowEmptyCollection()][object[]]$Findings, [object]$Document,
        [datetimeoffset]$AsOf = [datetimeoffset]::UtcNow)
    foreach ($finding in $Findings) {
        $baseId = $finding.CheckId -replace '\.\d+$', ''
        $scopedDecisions = @($Document.decisions | Where-Object { $_.checkId -eq $baseId -and $_.setting -ceq $finding.Setting })
        $decision = $null
        if ($scopedDecisions.Count -eq 1) {
            $source = $scopedDecisions[0]
            $state = 'Active'
            $instances = @($Findings | Where-Object { ($_.CheckId -replace '\.\d+$', '') -eq $baseId -and $_.Setting -ceq $finding.Setting })
            if ($instances.Count -ne 1) { $state = 'Ambiguous' }
            elseif ([datetimeoffset]$source.expiresAt -le $AsOf) { $state = 'Expired' }
            elseif ([datetimeoffset]$source.approvedAt -gt $AsOf) { $state = 'Future' }
            elseif ($source.type -eq 'ManualAttestation' -and $finding.Status -ne 'Review') { $state = 'Ineligible' }
            elseif ($source.type -eq 'AcceptedRisk' -and ($finding.Status -notin @('Fail', 'Warning') -or [string]$finding.CurrentValue -cne $source.observedValue)) { $state = 'EvidenceChanged' }
            $decision = $source | Select-Object *
            $decision | Add-Member -NotePropertyName state -NotePropertyValue $state -Force
        }
        $finding | Add-Member -NotePropertyName Decision -NotePropertyValue $decision -Force
        $finding | Add-Member -NotePropertyName Actionable -NotePropertyValue ([bool]($finding.Status -in @('Fail','Warning','Review') -and -not ($decision -and $decision.state -eq 'Active'))) -Force
    }
}

function Get-AssessmentCollectionState {
    <# .SYNOPSIS
        Summarizes collector completion separately from observed check scores.
    #>
    [CmdletBinding()]
    param([AllowEmptyCollection()][object[]]$Summary, [AllowEmptyCollection()][object[]]$Findings)
    $collectors = @($Summary | Select-Object Section, Collector, Status, Items, Error)
    $unavailable = @($Findings | Where-Object { $_.Status -in @('Unknown','Skipped','NotLicensed') }).Count
    $incomplete = @($collectors | Where-Object { $_.Status -ne 'Complete' -or $_.Error }).Count
    return [ordered]@{
        state = if ($collectors.Count -eq 0) { 'Unspecified' } elseif ($incomplete -or $unavailable) { 'Incomplete' } else { 'Complete' }
        scope = 'Requested collectors only; completeness does not establish compliance.'
        unavailableFindings = $unavailable
        incompleteCollectors = $incomplete
        collectors = $collectors
    }
}
