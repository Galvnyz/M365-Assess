<#
.SYNOPSIS
    Loads the CMMC EZ-CMMC handoff artifact for the report layer.
.DESCRIPTION
    Loads controls/cmmc-ez-handoff.json (synced from CheckID via CI) and
    returns the parsed content plus a derived per-level summary of
    classifications (out-of-scope / partial / coverable / inherent).

    The handoff artifact catalogues CMMC 2.0 practices that M365-Assess
    does not automate — either because there is no M365 configuration
    equivalent (physical access, HR), because M365 partially addresses
    the practice, because a future check could address it, or because
    M365 satisfies it inherently without configuration.

    Returns $null when the file is missing so the report layer can
    degrade gracefully for older installations.
.PARAMETER ControlsPath
    Path to the controls/ directory containing cmmc-ez-handoff.json.
.OUTPUTS
    [hashtable] with keys SchemaVersion, Generated, Description, Coverage,
    Practices (array of practice objects), Summary (per-level counts).
    Returns $null if the handoff file is not present.
.EXAMPLE
    Import-CmmcHandoff -ControlsPath "$PSScriptRoot\..\controls"
#>
function Import-CmmcHandoff {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$ControlsPath
    )

    $handoffPath = Join-Path -Path $ControlsPath -ChildPath 'cmmc-ez-handoff.json'
    if (-not (Test-Path -Path $handoffPath)) {
        Write-Verbose "CMMC handoff file not found: $handoffPath"
        return $null
    }

    $raw = Get-Content -Path $handoffPath -Raw | ConvertFrom-Json
    $practices = @($raw.practices)

    # Pre-compute summary so the React layer just reads pills, not aggregates.
    # Level keys match the handoff schema (L1/L2/L3); classification keys are
    # camelCased (JS convention) because this hashtable is serialized to JSON
    # and consumed by the browser.
    $newBucket = { [ordered]@{ outOfScope = 0; partial = 0; coverable = 0; inherent = 0 } }
    $summary = [ordered]@{
        L1    = & $newBucket
        L2    = & $newBucket
        L3    = & $newBucket
        Total = & $newBucket
    }
    $summary.Total['practices'] = $practices.Count

    foreach ($practice in $practices) {
        $bucketKey = switch ($practice.classification) {
            'out-of-scope' { 'outOfScope' }
            'partial'      { 'partial' }
            'coverable'    { 'coverable' }
            'inherent'     { 'inherent' }
            default        { $null }
        }
        if ($null -eq $bucketKey) { continue }
        if (-not $summary.Contains($practice.level)) { continue }

        $summary[$practice.level][$bucketKey]++
        $summary.Total[$bucketKey]++
    }

    return @{
        SchemaVersion = $raw.schemaVersion
        Generated     = $raw.generated
        Description   = $raw.description
        Coverage      = $raw.coverage
        Practices     = $practices
        Summary       = $summary
    }
}
