<#
.SYNOPSIS
    Real-time streaming progress display for M365 security checks.
.DESCRIPTION
    Provides real-time feedback as security checks complete. Uses a streaming
    approach — each check is printed as it finishes, flowing naturally with
    the rest of the console output (section headers, collector results, etc.).

    Uses Write-Progress for an always-visible progress bar that shows the
    current collector and overall completion percentage.

    Designed to be dot-sourced by Invoke-M365Assessment.ps1. Exposes two
    global functions (Update-CheckProgress, Update-ProgressStatus) that
    collectors call from Add-Setting to drive real-time updates.
.NOTES
    Author:  Daren9m
#>

# ── Map registry collector names to section names and display labels ──
$script:CollectorSectionMap = @{
    'Entra'          = 'Identity'
    'CAEvaluator'    = 'Identity'
    'ExchangeOnline' = 'Email'
    'DNS'            = 'Email'
    'Defender'       = 'Security'
    'Compliance'     = 'Security'
    'StrykerReadiness' = 'Security'
    'Intune'         = 'Intune'
    'SharePoint'     = 'Collaboration'
    'Teams'          = 'Collaboration'
    'PowerBI'        = 'PowerBI'
}

$script:CollectorLabelMap = @{
    'Entra'          = 'Entra Security Config'
    'CAEvaluator'    = 'CA Policy Evaluation'
    'ExchangeOnline' = 'EXO Security Config'
    'DNS'            = 'DNS Security Config'
    'Defender'       = 'Defender Security Config'
    'Compliance'     = 'Compliance Security Config'
    'StrykerReadiness' = 'Stryker Incident Readiness'
    'Intune'         = 'Intune Security Config'
    'SharePoint'     = 'SharePoint Security Config'
    'Teams'          = 'Teams Security Config'
    'PowerBI'        = 'Power BI Security Config'
}

# Ordered list for consistent display
$script:CollectorOrder = @('Entra', 'CAEvaluator', 'ExchangeOnline', 'DNS', 'Defender', 'Compliance', 'StrykerReadiness', 'Intune', 'SharePoint', 'Teams', 'PowerBI')



function Initialize-CheckProgress {
    <#
    .SYNOPSIS
        Sets up global progress state and prints a summary of queued checks.
    .PARAMETER ControlRegistry
        Hashtable returned by Import-ControlRegistry.
    .PARAMETER ActiveSections
        Array of section names the user selected (e.g., 'Identity', 'Email').
    .PARAMETER TenantLicenses
        Hashtable from Resolve-TenantLicenses with ActiveServicePlans HashSet.
        Checks requiring service plans not in this set are skipped.
    .PARAMETER SeverityFilter
        Array of severity levels to include (e.g., @('Critical','High') for QuickScan).
        If empty or null, all severities are included.
    .PARAMETER Silent
        Initialize state without printing the summary to the console.
        Used for the initial pre-connection setup when license data is not yet available.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [hashtable]$ControlRegistry,

        [Parameter(Mandatory)]
        [string[]]$ActiveSections,

        [Parameter()]
        [hashtable]$TenantLicenses,

        [Parameter()]
        [string[]]$SeverityFilter,

        [Parameter()]
        [switch]$Silent
    )

    # Build ordered list of automated checks for active sections
    $checksByCollector = [ordered]@{}
    $licenseSkipped = @{}

    foreach ($collectorName in $script:CollectorOrder) {
        $section = $script:CollectorSectionMap[$collectorName]
        if ($section -notin $ActiveSections) { continue }

        $checks = $ControlRegistry.GetEnumerator() |
            Where-Object {
                $_.Key -ne '__cisReverseLookup' -and
                $_.Value.hasAutomatedCheck -eq $true -and
                $_.Value.collector -eq $collectorName
            } |
            ForEach-Object { $_.Value } |
            Sort-Object -Property checkId

        # Apply license gating filter
        if ($TenantLicenses -and $TenantLicenses.ActiveServicePlans.Count -gt 0) {
            $checks = @($checks | Where-Object {
                $requiredPlans = $_.licensing.requiredServicePlans
                if ($requiredPlans -and @($requiredPlans).Count -gt 0) {
                    $hasAny = $false
                    foreach ($plan in $requiredPlans) {
                        if ($TenantLicenses.ActiveServicePlans.Contains($plan)) {
                            $hasAny = $true
                            break
                        }
                    }
                    if (-not $hasAny) {
                        $licenseSkipped[$_.checkId] = @{
                            Name           = $_.name
                            RequiredPlans  = @($requiredPlans)
                        }
                        return $false
                    }
                }
                return $true
            })
        }

        # Apply severity filter (for QuickScan)
        if ($SeverityFilter -and $SeverityFilter.Count -gt 0) {
            $checks = @($checks | Where-Object {
                $_.riskSeverity -in $SeverityFilter
            })
        }

        if (@($checks).Count -gt 0) {
            $checksByCollector[$collectorName] = @($checks)
        }
    }

    $totalChecks = ($checksByCollector.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
    if (-not $totalChecks) { $totalChecks = 0 }

    # Build state
    $state = @{
        Completed         = 0
        Total             = $totalChecks
        CheckIds          = @{}      # checkId -> collector name (for validation)
        CountedIds        = @{}      # checkId -> $true (track first occurrence for counter)
        CurrentCollector  = ''
        CollectorCounts   = @{}      # collector -> total count
        CollectorDone     = @{}      # collector -> completed count
        PrintedHeaders    = @{}      # collector -> $true (header printed)
        LabelMap          = $script:CollectorLabelMap  # accessible from any scope via global state
        LicenseSkipped    = $licenseSkipped  # checkId -> required plans (for compliance overview)
    }

    # Populate check IDs and collector counts
    foreach ($collectorName in $checksByCollector.Keys) {
        $state.CollectorCounts[$collectorName] = $checksByCollector[$collectorName].Count
        $state.CollectorDone[$collectorName] = 0
        foreach ($c in $checksByCollector[$collectorName]) {
            $state.CheckIds[$c.checkId] = $collectorName
        }
    }

    $global:CheckProgressState = $state

    if ($Silent) { return }

    if ($totalChecks -eq 0) {
        Write-Host ''
        Write-Host '  No automated security checks queued for the selected sections.' -ForegroundColor DarkGray
        Write-Host ''
        return
    }

    # Print status legend so users know what the symbols mean
    Write-Host ''
    Write-Host '  Status Legend:' -ForegroundColor White
    Write-Host '    ' -NoNewline
    Write-Host "$([char]0x2713) Pass  " -ForegroundColor Green -NoNewline
    Write-Host "$([char]0x2717) Fail  " -ForegroundColor Red -NoNewline
    Write-Host '! Warning  ' -ForegroundColor Yellow -NoNewline
    Write-Host '? Review  ' -ForegroundColor Cyan -NoNewline
    Write-Host 'i Info' -ForegroundColor DarkGray

    # Print a compact summary of what's queued
    Write-Host ''
    Write-Host "  Security Checks: $totalChecks queued across $($checksByCollector.Count) collectors" -ForegroundColor Cyan
    foreach ($collectorName in $checksByCollector.Keys) {
        $label = $script:CollectorLabelMap[$collectorName]
        $count = $checksByCollector[$collectorName].Count
        Write-Host "    $([char]0x25B8) $label — $count checks" -ForegroundColor DarkGray
    }
    if ($licenseSkipped.Count -gt 0) {
        # Friendly names for common service plan IDs
        $planFriendlyNames = @{
            'AAD_PREMIUM_P2'                    = 'Entra ID P2 (Azure AD Premium P2)'
            'ATP_ENTERPRISE'                    = 'Microsoft Defender for Office 365'
            'LOCKBOX_ENTERPRISE'                = 'Customer Lockbox'
            'INTUNE_A'                          = 'Microsoft Intune'
            'INFORMATION_PROTECTION_COMPLIANCE' = 'Microsoft 365 compliance (requires Teams license)'
        }
        Write-Host "  $($licenseSkipped.Count) checks skipped (tenant lacks required license):" -ForegroundColor DarkYellow
        foreach ($skipEntry in $licenseSkipped.GetEnumerator()) {
            $skipInfo = $skipEntry.Value
            $planList = ($skipInfo.RequiredPlans | ForEach-Object {
                if ($planFriendlyNames.ContainsKey($_)) { $planFriendlyNames[$_] } else { $_ }
            }) -join ' or '
            Write-Host "    $([char]0x25B8) $($skipEntry.Key): $($skipInfo.Name)" -ForegroundColor DarkGray
            Write-Host "      Requires: $planList" -ForegroundColor DarkGray
        }
    }
    Write-Host ''

    $pct = [math]::Round($global:CheckProgressState.Completed / [math]::Max(1, $global:CheckProgressState.Total) * 100)
    Write-Progress -Activity 'M365 Security Assessment' -Status "$($global:CheckProgressState.Completed) / $($global:CheckProgressState.Total) checks complete" -PercentComplete $pct
}


function global:Update-CheckProgress {
    <#
    .SYNOPSIS
        Marks a single security check as complete in the progress display.
    .DESCRIPTION
        Called from Add-Setting inside each security config collector.
        Streams a colored line to the console and updates Write-Progress.
    #>
    param(
        [string]$CheckId,
        [string]$Setting,
        [string]$Status
    )

    $state = $global:CheckProgressState
    if (-not $state -or $state.Total -eq 0) { return }

    # Extract base CheckId (strip .N sub-number) for registry lookup and counting
    $baseCheckId = if ($CheckId -match '^(.+)\.\d+$') { $Matches[1] } else { $CheckId }

    if (-not $state.CheckIds.ContainsKey($baseCheckId)) { return }

    $collectorName = $state.CheckIds[$baseCheckId]

    # Only count unique base CheckIds toward progress (sub-numbered settings
    # share the same base, e.g., DEFENDER-ANTISPAM-001.1, .2, .3).
    $isFirstOccurrence = -not $state.CountedIds.ContainsKey($baseCheckId)
    if ($isFirstOccurrence) {
        $state.CountedIds[$baseCheckId] = $true
        $state.Completed++
        $state.CollectorDone[$collectorName]++
    }


    # Print collector sub-header on first check from this collector
    if (-not $state.PrintedHeaders[$collectorName]) {
        $state.PrintedHeaders[$collectorName] = $true
        $labelMap = if ($script:CollectorLabelMap) { $script:CollectorLabelMap } else { $global:CheckProgressState.LabelMap }
        $label = if ($labelMap) { $labelMap[$collectorName] } else { $collectorName }
        $count = $state.CollectorCounts[$collectorName]
        Write-Host "    $([char]0x250C) $label ($count checks)" -ForegroundColor White
    }

    # ── Symbol + color by status ──
    $symbol = switch ($Status) {
        'Pass'    { [char]0x2713 }
        'Fail'    { [char]0x2717 }
        'Warning' { '!' }
        'Review'  { '?' }
        'Info'    { 'i' }
        default   { [char]0x2713 }
    }
    $color = switch ($Status) {
        'Pass'    { 'Green' }
        'Fail'    { 'Red' }
        'Warning' { 'Yellow' }
        'Review'  { 'Cyan' }
        'Info'    { 'DarkGray' }
        default   { 'White' }
    }

    # Truncate setting name for clean display
    $name = $Setting
    if ($name.Length -gt 44) { $name = $name.Substring(0, 41) + '...' }

    # Stream the check result line
    Write-Host "    $([char]0x2502) " -ForegroundColor DarkGray -NoNewline
    Write-Host "$symbol " -ForegroundColor $color -NoNewline
    Write-Host "$($CheckId.PadRight(28)) $name" -ForegroundColor $color

    # Print collector footer when all unique checks in this collector are done
    $done = $state.CollectorDone[$collectorName]
    $total = $state.CollectorCounts[$collectorName]
    if ($done -eq $total) {
        Write-Host "    $([char]0x2514) $done/$total complete" -ForegroundColor DarkGray
    }

    $pct = [math]::Round($state.Completed / [math]::Max(1, $state.Total) * 100)
    Write-Progress -Activity 'M365 Security Assessment' -Status "$($state.Completed) / $($state.Total) checks complete" -PercentComplete $pct
}


function global:Update-ProgressStatus {
    <#
    .SYNOPSIS
        Updates the Write-Progress bar with a verbose status message.
    #>
    param([string]$Message)

    $state = $global:CheckProgressState
    if (-not $state -or $state.Total -eq 0) { return }

}


function Complete-CheckProgress {
    <#
    .SYNOPSIS
        Cleans up the progress display and global functions.
    #>
    [CmdletBinding()]
    param()

    $state = $global:CheckProgressState
    if ($state -and $state.Total -gt 0) {
        Write-Progress -Activity 'M365 Security Assessment' -Completed
        Write-Host ''
        Write-Host "  $([char]0x2713) All $($state.Total) security checks complete" -ForegroundColor Green
        Write-Host ''
    }

    # Clean up globals
    Remove-Item -Path 'Function:\Update-CheckProgress'    -ErrorAction SilentlyContinue
    Remove-Item -Path 'Function:\Update-ProgressStatus'   -ErrorAction SilentlyContinue
    Remove-Variable -Name CheckProgressState -Scope Global -ErrorAction SilentlyContinue
}
