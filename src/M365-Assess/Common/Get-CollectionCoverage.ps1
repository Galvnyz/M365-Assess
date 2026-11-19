<#
.SYNOPSIS
    Coverage guard for checks whose clean result means "nothing was found".
.DESCRIPTION
    A hunt-style check asks "is there anything bad in this set?". An empty
    answer is only meaningful when the whole set was read. If the query
    failed, was truncated, or some items could not be examined, an empty
    answer means "we could not look", and reporting Pass would be false
    assurance.

    These helpers make that distinction explicit:

      New-CollectionCoverage   records how much of a set was examined and
                               what went wrong.
      Add-IndicatorSetting     records the finding. It is the only place a
                               verdict is chosen:
                                 indicators found      -> the hit status
                                 none, coverage whole  -> Pass
                                 none, coverage partial-> Unknown

    A caller cannot produce a Pass from incomplete data because it never
    chooses the status itself.

    Dot-source after SecurityConfigHelper.ps1 (Add-IndicatorSetting forwards to
    its Add-Setting):
        . (Join-Path -Path $PSScriptRoot -ChildPath '..\Common\SecurityConfigHelper.ps1')
        . (Join-Path -Path $PSScriptRoot -ChildPath '..\Common\Get-CollectionCoverage.ps1')
#>

function New-CollectionCoverage {
    <#
    .SYNOPSIS
        Describes how completely a set of items was examined.
    .PARAMETER Scope
        Plural noun for the items, used in report text (for example 'mailboxes').
    .PARAMETER Total
        Number of items that should have been examined.
    .PARAMETER Examined
        Number of items that were examined successfully.
    .PARAMETER Errors
        Messages for anything that prevented full coverage. Any entry makes
        the coverage incomplete.
    .OUTPUTS
        PSCustomObject with Scope, Total, Examined, Errors and Complete.
    .EXAMPLE
        New-CollectionCoverage -Scope 'mailboxes' -Total 412 -Examined 412
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Scope,

        [Parameter(Mandatory)]
        [ValidateRange(0, [int]::MaxValue)]
        [int]$Total,

        [Parameter(Mandatory)]
        [ValidateRange(0, [int]::MaxValue)]
        [int]$Examined,

        [Parameter()]
        [AllowEmptyCollection()]
        [string[]]$Errors = @()
    )

    $errorList = @($Errors | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    [PSCustomObject]@{
        Scope    = $Scope
        Total    = $Total
        Examined = $Examined
        Errors   = $errorList
        Complete = ($errorList.Count -eq 0 -and $Examined -eq $Total)
    }
}

function Add-IndicatorSetting {
    <#
    .SYNOPSIS
        Records a hunt finding, choosing the status from indicators and coverage.
    .DESCRIPTION
        Forwards to Add-Setting. The status is derived, never supplied:
        indicators present gives -HitStatus; no indicators with complete
        coverage gives Pass; no indicators with incomplete coverage gives
        Unknown. Up to -MaxEvents indicator events are stored as a JSON string
        in Evidence (a string survives the collector CSV round trip intact).
    .PARAMETER CheckId
        Base CheckId, for example 'IOC-INBOXRULE-001'.
    .PARAMETER Category
        Report category.
    .PARAMETER Setting
        Human-readable name of the check.
    .PARAMETER Coverage
        Object from New-CollectionCoverage.
    .PARAMETER Indicators
        Indicator events. Each should carry Time, Actor, Target and Detail.
    .PARAMETER HitStatus
        Status when indicators are present: Fail (strong) or Warning (review).
    .PARAMETER Window
        Short description of what was examined, for example 'current rules'
        or 'the last 30 days'.
    .PARAMETER RecommendedValue
        Expected state.
    .PARAMETER Remediation
        What to do when indicators are present.
    .PARAMETER EvidenceSource
        Cmdlet or endpoint the data came from.
    .PARAMETER PermissionRequired
        Permission needed to collect the data.
    .PARAMETER Limitations
        Known limits of the check that always apply (retention, blind spots).
    .PARAMETER MaxEvents
        Maximum number of events stored in Evidence. The total is always kept.
    .EXAMPLE
        Add-IndicatorSetting -CheckId 'IOC-FORWARD-001' -Category 'Mailbox' -Setting 'External mailbox forwarding' -Coverage $coverage -Indicators $hits -HitStatus Warning -Window 'current settings' -RecommendedValue 'None' -Remediation 'Review each forward.' -EvidenceSource 'Get-EXOMailbox'
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$CheckId,

        [Parameter(Mandatory)]
        [string]$Category,

        [Parameter(Mandatory)]
        [string]$Setting,

        [Parameter(Mandatory)]
        [PSCustomObject]$Coverage,

        [Parameter()]
        [AllowEmptyCollection()]
        [AllowNull()]
        [object[]]$Indicators = @(),

        [Parameter(Mandatory)]
        [ValidateSet('Fail', 'Warning')]
        [string]$HitStatus,

        [Parameter(Mandatory)]
        [string]$Window,

        [Parameter(Mandatory)]
        [string]$RecommendedValue,

        [Parameter(Mandatory)]
        [string]$Remediation,

        [Parameter()]
        [string]$EvidenceSource = '',

        [Parameter()]
        [string]$PermissionRequired = '',

        [Parameter()]
        [string]$Limitations = '',

        [Parameter()]
        [ValidateRange(1, 500)]
        [int]$MaxEvents = 50
    )

    $hits = @($Indicators | Where-Object { $null -ne $_ })
    $coverageText = "examined $($Coverage.Examined) of $($Coverage.Total) $($Coverage.Scope), $Window"
    $limitationParts = [System.Collections.Generic.List[string]]::new()

    if (-not $Coverage.Complete) {
        $firstErrors = @($Coverage.Errors | Select-Object -First 3) -join ' | '
        $gap = "Coverage incomplete: $coverageText."
        if ($firstErrors) { $gap += " $firstErrors" }
        if ($Coverage.Errors.Count -gt 3) { $gap += " (+$($Coverage.Errors.Count - 3) more)" }
        $limitationParts.Add($gap)
    }
    if ($Limitations) { $limitationParts.Add($Limitations) }

    if ($hits.Count -gt 0) {
        $status = $HitStatus
        $current = "$($hits.Count) indicator(s) found ($coverageText)"
        if (-not $Coverage.Complete) { $current += '; coverage was incomplete, more may exist' }
        $remediationText = $Remediation
    }
    elseif ($Coverage.Complete) {
        $status = 'Pass'
        $current = "No indicators found ($coverageText)"
        $remediationText = 'No action needed. A clean result covers only what this check examines; it is not proof that the tenant is uncompromised.'
    }
    else {
        # The one place this family emits "could not look". Never Pass.
        $status = 'Unknown'
        $current = "Not evaluated: $coverageText"
        $remediationText = 'Resolve the collection problem described under Limitations and run the check again. No conclusion can be drawn from this result.'
    }

    $evidenceJson = [ordered]@{
        total    = $hits.Count
        shown    = [math]::Min($hits.Count, $MaxEvents)
        coverage = [ordered]@{
            scope    = $Coverage.Scope
            total    = $Coverage.Total
            examined = $Coverage.Examined
            complete = [bool]$Coverage.Complete
        }
        window   = $Window
        events   = @($hits | Select-Object -First $MaxEvents)
    } | ConvertTo-Json -Depth 6 -Compress

    $settingParams = @{
        CheckId            = $CheckId
        Category           = $Category
        Setting            = $Setting
        CurrentValue       = $current
        RecommendedValue   = $RecommendedValue
        Status             = $status
        Remediation        = $remediationText
        Evidence           = $evidenceJson
        ObservedValue      = "$($hits.Count)"
        ExpectedValue      = '0'
        EvidenceSource     = $EvidenceSource
        EvidenceTimestamp  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        CollectionMethod   = 'Direct'
        PermissionRequired = $PermissionRequired
        Limitations        = ($limitationParts -join ' ')
    }
    Add-Setting @settingParams
}
