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
        Free-form -- prefer the typed evidence fields below for new code.
    .PARAMETER ObservedValue
        Machine-readable representation of what the tenant returned. CurrentValue is the
        human-readable summary; ObservedValue is the raw value (e.g. boolean, GUID, count).
    .PARAMETER ExpectedValue
        Machine-readable representation of what the benchmark expects. Companion to ObservedValue.
    .PARAMETER EvidenceSource
        The Graph endpoint, EXO cmdlet, or DNS query that produced the data
        (e.g. 'Get-AdminAuditLogConfig', '/identity/conditionalAccess/policies').
    .PARAMETER EvidenceTimestamp
        UTC ISO-8601 timestamp of when the upstream data was collected. Leave empty
        if the collector does not have a precise collection time -- do not synthesize one.
    .PARAMETER CollectionMethod
        How the value was determined: 'Direct' (read from API), 'Derived' (computed
        from API output), or 'Inferred' (best-effort based on partial data).
    .PARAMETER PermissionRequired
        The Graph scope or RBAC role used to produce this finding (e.g. 'Policy.Read.All',
        'Exchange Online: View-Only Configuration'). Lets auditors verify the access path.
    .PARAMETER Confidence
        Number from 0.0 to 1.0 indicating confidence in the finding. Null = unspecified.
        Distinguishes 'this is definitely Pass' (1.0) from 'best-effort given missing scopes' (e.g. 0.6).
    .PARAMETER Limitations
        Free-text note explaining caveats (e.g. 'Required Reports.Read.All which was not
        granted; counted user signins from /auditLogs/signIns instead').
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
        [ValidateSet('Pass', 'Fail', 'Warning', 'Review', 'Info', 'Skipped', 'Unknown', 'NotApplicable', 'NotLicensed')]
        [string]$Status,

        [Parameter()]
        [string]$CheckId = '',

        [Parameter()]
        [string]$Remediation = '',

        [Parameter()]
        [switch]$IntentDesign,

        [Parameter()]
        [PSCustomObject]$Evidence = $null,

        # D1 #785 -- standardized evidence schema (all optional; empty by default)
        [Parameter()]
        [string]$ObservedValue = '',

        [Parameter()]
        [string]$ExpectedValue = '',

        [Parameter()]
        [string]$EvidenceSource = '',

        [Parameter()]
        [string]$EvidenceTimestamp = '',

        [Parameter()]
        [ValidateSet('', 'Direct', 'Derived', 'Inferred')]
        [string]$CollectionMethod = '',

        [Parameter()]
        [string]$PermissionRequired = '',

        [Parameter()]
        [Nullable[double]]$Confidence = $null,

        [Parameter()]
        [string]$Limitations = ''
    )

    # D1 #785 -- validate Confidence range manually so the [Nullable[double]] default
    # of $null does not trip ValidateRange (which rejects null on PS 7.x).
    if ($null -ne $Confidence -and ($Confidence -lt 0.0 -or $Confidence -gt 1.0)) {
        throw [System.Management.Automation.ValidationMetadataException]::new(
            "Confidence must be between 0.0 and 1.0 (or omitted). Received: $Confidence")
    }

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
        Category           = $Category
        Setting            = $Setting
        CurrentValue       = $CurrentValue
        RecommendedValue   = $RecommendedValue
        Status             = $Status
        CheckId            = $subCheckId
        Remediation        = $Remediation
        IntentDesign       = [bool]$IntentDesign
        Evidence           = $Evidence
        ObservedValue      = $ObservedValue
        ExpectedValue      = $ExpectedValue
        EvidenceSource     = $EvidenceSource
        EvidenceTimestamp  = $EvidenceTimestamp
        CollectionMethod   = $CollectionMethod
        PermissionRequired = $PermissionRequired
        Confidence         = $Confidence
        Limitations        = $Limitations
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
