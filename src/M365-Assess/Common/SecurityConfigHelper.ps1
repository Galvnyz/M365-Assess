<#
.SYNOPSIS
    Shared helpers for security-config collectors.
.DESCRIPTION
    Provides the standard Add-SecuritySetting and Export-SecurityConfigReport
    functions used by all security-config collectors (EXO, Entra, Defender,
    SharePoint, Teams, Intune, Forms, Compliance, DNS). Centralizes the output
    contract, CheckId sub-numbering, progress tracking, and CSV export logic
    that was previously duplicated in each collector.

    Dot-source this file at the top of each security-config collector:
        . "$PSScriptRoot\..\Common\SecurityConfigHelper.ps1"
.NOTES
    Author: Daren9m
#>

function Initialize-SecurityConfig {
    <#
    .SYNOPSIS
        Creates the standard settings collection and CheckId counter for a security-config collector.
    .OUTPUTS
        Hashtable with Settings (List[PSCustomObject]) and CheckIdCounter (hashtable).
    .EXAMPLE
        $ctx = Initialize-SecurityConfig
        $settings = $ctx.Settings
        $checkIdCounter = $ctx.CheckIdCounter
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    if (-not $global:AdoptionSignals) { $global:AdoptionSignals = @{} }
    @{
        Settings       = [System.Collections.Generic.List[PSCustomObject]]::new()
        CheckIdCounter = @{}
    }
}

function Add-SecuritySetting {
    <#
    .SYNOPSIS
        Adds a security configuration finding to the collector's settings list.
    .DESCRIPTION
        Standard output contract for all security-config collectors. Handles
        CheckId sub-numbering (e.g., EXO-AUTH-001 becomes EXO-AUTH-001.1,
        EXO-AUTH-001.2) and invokes real-time progress tracking when available.
    .PARAMETER Settings
        The List[PSCustomObject] collection to add the finding to.
    .PARAMETER CheckIdCounter
        Hashtable tracking sub-number counts per base CheckId.
    .PARAMETER Category
        Logical grouping for the setting (e.g., 'Authentication', 'External Sharing').
    .PARAMETER Setting
        Human-readable name of the setting being checked.
    .PARAMETER CurrentValue
        The actual value found in the tenant.
    .PARAMETER RecommendedValue
        The expected/recommended value per the benchmark.
    .PARAMETER Status
        Assessment result: Pass, Fail, Warning, Review, or Info.
    .PARAMETER CheckId
        Registry check identifier (e.g., 'EXO-AUTH-001'). Sub-numbered automatically.
    .PARAMETER Remediation
        Guidance for fixing a non-passing result.
    .PARAMETER Evidence
        Optional structured evidence object attached to the finding (serialized to JSON in the report).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[PSCustomObject]]$Settings,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [hashtable]$CheckIdCounter,

        [Parameter(Mandatory)]
        [string]$Category,

        [Parameter(Mandatory)]
        [string]$Setting,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$CurrentValue,

        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$RecommendedValue,

        [Parameter(Mandatory)]
        [ValidateSet('Pass', 'Fail', 'Warning', 'Review', 'Info', 'Skipped', 'Unknown')]
        [string]$Status,

        [Parameter()]
        [string]$CheckId = '',

        [Parameter()]
        [string]$Remediation = '',

        [Parameter()]
        [switch]$IntentDesign,

        [Parameter()]
        [PSCustomObject]$Evidence = $null
    )

    # Auto-generate sub-numbered CheckId for individual setting traceability
    $subCheckId = $CheckId
    if ($CheckId) {
        if (-not $CheckIdCounter.ContainsKey($CheckId)) { $CheckIdCounter[$CheckId] = 0 }
        $CheckIdCounter[$CheckId]++
        $subCheckId = "$CheckId.$($CheckIdCounter[$CheckId])"
    }

    # Registry remediation used as fallback so new collectors can omit the param
    if ([string]::IsNullOrWhiteSpace($Remediation) -and $CheckId) {
        $reg = Get-Variable -Name 'M365AssessRegistry' -Scope Global -ErrorAction SilentlyContinue
        if ($reg -and $reg.Value -and $reg.Value.ContainsKey($CheckId)) {
            $entry = $reg.Value[$CheckId]
            if ($entry -and $entry.remediation) { $Remediation = $entry.remediation }
        }
    }

    $Settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $subCheckId
        Remediation      = $Remediation
        IntentDesign     = [bool]$IntentDesign
        Evidence         = $Evidence
    })

    # Accumulate adoption signal for Value Opportunity analysis
    if ($CheckId) {
        $global:AdoptionSignals[$subCheckId] = @{
            Status       = $Status
            Setting      = $Setting
            CurrentValue = $CurrentValue
            Category     = $Category
        }
    }

    # Invoke real-time progress tracking if available (set up by Show-CheckProgress.ps1)
    if ($CheckId -and (Get-Command -Name Update-CheckProgress -ErrorAction SilentlyContinue)) {
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
    }
}

function Export-SecurityConfigReport {
    <#
    .SYNOPSIS
        Exports security-config settings to CSV or pipeline.
    .DESCRIPTION
        Standard output handler for all security-config collectors. Writes to
        CSV when OutputPath is provided, otherwise returns objects to the pipeline.
    .PARAMETER Settings
        The collected settings list.
    .PARAMETER OutputPath
        Optional CSV file path. If omitted, objects are written to the pipeline.
    .PARAMETER ServiceLabel
        Display name for log messages (e.g., 'Exchange Online', 'Entra ID').
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Settings,

        [Parameter()]
        [string]$OutputPath,

        [Parameter(Mandatory)]
        [string]$ServiceLabel
    )

    $report = @($Settings)
    Write-Verbose "Collected $($report.Count) $ServiceLabel security configuration settings"

    if ($OutputPath) {
        $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported $ServiceLabel security config ($($report.Count) settings) to $OutputPath"
    }
    else {
        Write-Output $report
    }
}

function Get-AdoptionSignals {
    <#
    .SYNOPSIS
        Returns a clone of the accumulated adoption signals.
    .DESCRIPTION
        Returns a thread-safe copy of the adoption signals hashtable that was
        passively populated by Add-SecuritySetting calls during the assessment.
        Used by the Value Opportunity collectors to determine feature adoption.
    .EXAMPLE
        $signals = Get-AdoptionSignals
        $signals['ENTRA-PIM-001.1'].Status  # 'Pass' or 'Fail'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    if ($global:AdoptionSignals) {
        return $global:AdoptionSignals.Clone()
    }
    return @{}
}
