function Get-RemediationLane {
    <#
    .SYNOPSIS
        Maps a finding to a Now/Next/Later remediation horizon.
    .DESCRIPTION
        Single source of truth for lane bucketing. The HTML report and the XLSX
        export both read precomputed lane values from this helper so the two
        consumption surfaces never disagree.

        Rules (#709 rebalance):
          - Non-Fail findings: critical severity -> 'now', otherwise 'later'.
          - Fail findings:
              * critical                              -> 'now'
              * high + small effort (high-value quick win) -> 'now'
              * high                                  -> 'soon'
              * medium + (small | medium) effort      -> 'soon'
              * medium + large effort, or low/info/none severity -> 'later'

        Pass-status findings get an empty lane -- they need no remediation.
    .PARAMETER Status
        Finding status: Pass | Fail | Warning | Review | Info | Skipped.
    .PARAMETER Severity
        Risk severity: critical | high | medium | low | info | none.
    .PARAMETER Effort
        Remediation effort: small | medium | large. Defaults to 'medium' when omitted.
    .EXAMPLE
        Get-RemediationLane -Status 'Fail' -Severity 'critical' -Effort 'small'
        # -> 'now'
    .EXAMPLE
        Get-RemediationLane -Status 'Fail' -Severity 'medium' -Effort 'large'
        # -> 'later'
    .EXAMPLE
        Get-RemediationLane -Status 'Pass' -Severity 'high' -Effort 'small'
        # -> ''  (Pass findings need no remediation)
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Status,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Severity,

        [Parameter()]
        [string]$Effort = 'medium'
    )

    if ($Status -eq 'Pass') { return '' }

    $sev = $Severity.ToLowerInvariant()
    $eff = if ([string]::IsNullOrWhiteSpace($Effort)) { 'medium' } else { $Effort.ToLowerInvariant() }

    if ($Status -ne 'Fail') {
        if ($sev -eq 'critical') { return 'now' }
        return 'later'
    }

    if ($sev -eq 'critical')                              { return 'now' }
    if ($sev -eq 'high'   -and $eff -eq 'small')          { return 'now' }
    if ($sev -eq 'high')                                  { return 'soon' }
    if ($sev -eq 'medium' -and $eff -ne 'large')          { return 'soon' }
    return 'later'
}
