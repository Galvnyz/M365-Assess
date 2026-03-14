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
    'Intune'         = 'Intune'
    'SharePoint'     = 'Collaboration'
    'Teams'          = 'Collaboration'
}

$script:CollectorLabelMap = @{
    'Entra'          = 'Entra Security Config'
    'CAEvaluator'    = 'CA Policy Evaluation'
    'ExchangeOnline' = 'EXO Security Config'
    'DNS'            = 'DNS Security Config'
    'Defender'       = 'Defender Security Config'
    'Compliance'     = 'Compliance Security Config'
    'Intune'         = 'Intune Security Config'
    'SharePoint'     = 'SharePoint Security Config'
    'Teams'          = 'Teams Security Config'
}

# Ordered list for consistent display
$script:CollectorOrder = @('Entra', 'CAEvaluator', 'ExchangeOnline', 'DNS', 'Defender', 'Compliance', 'Intune', 'SharePoint', 'Teams')

function Initialize-CheckProgress {
    <#
    .SYNOPSIS
        Sets up global progress state and prints a summary of queued checks.
    .PARAMETER ControlRegistry
        Hashtable returned by Import-ControlRegistry.
    .PARAMETER ActiveSections
        Array of section names the user selected (e.g., 'Identity', 'Email').
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [hashtable]$ControlRegistry,

        [Parameter(Mandatory)]
        [string[]]$ActiveSections
    )

    # Build ordered list of automated checks for active sections
    $checksByCollector = [ordered]@{}

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

    if ($totalChecks -eq 0) { return }

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
    Write-Host ''

    # Start the Write-Progress bar
    Write-Progress -Activity 'M365 Security Assessment' -Status "0 / $totalChecks checks complete" -PercentComplete 0 -Id 1
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
    if (-not $state.CheckIds.ContainsKey($CheckId)) { return }

    $collectorName = $state.CheckIds[$CheckId]

    # Only count unique CheckIds toward progress (some collectors call
    # Add-Setting multiple times with the same CheckId, e.g., per-domain
    # password policies or multiple OWA policies).
    $isFirstOccurrence = -not $state.CountedIds.ContainsKey($CheckId)
    if ($isFirstOccurrence) {
        $state.CountedIds[$CheckId] = $true
        $state.Completed++
        $state.CollectorDone[$collectorName]++
    }

    # Print collector sub-header on first check from this collector
    if (-not $state.PrintedHeaders[$collectorName]) {
        $state.PrintedHeaders[$collectorName] = $true
        $label = $script:CollectorLabelMap[$collectorName]
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
    Write-Host "$($CheckId.PadRight(22)) $name" -ForegroundColor $color

    # Print collector footer when all unique checks in this collector are done
    $done = $state.CollectorDone[$collectorName]
    $total = $state.CollectorCounts[$collectorName]
    if ($done -eq $total) {
        Write-Host "    $([char]0x2514) $done/$total complete" -ForegroundColor DarkGray
    }

    # Update Write-Progress bar (cap at 100%)
    $pct = [math]::Min(100, [math]::Round(($state.Completed / $state.Total) * 100))
    $statusText = "$($state.Completed) / $($state.Total) checks complete"
    Write-Progress -Activity 'M365 Security Assessment' -Status $statusText -PercentComplete $pct -Id 1
}


function global:Update-ProgressStatus {
    <#
    .SYNOPSIS
        Updates the Write-Progress bar with a verbose status message.
    #>
    param([string]$Message)

    $state = $global:CheckProgressState
    if (-not $state -or $state.Total -eq 0) { return }

    $pct = if ($state.Total -gt 0) { [math]::Round(($state.Completed / $state.Total) * 100) } else { 0 }
    Write-Progress -Activity 'M365 Security Assessment' -Status $Message -PercentComplete $pct -Id 1 -CurrentOperation "$($state.Completed) / $($state.Total) checks"
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
        Write-Progress -Activity 'M365 Security Assessment' -Completed -Id 1
        Write-Host ''
        Write-Host "  $([char]0x2713) All $($state.Total) security checks complete" -ForegroundColor Green
        Write-Host ''
    }

    # Clean up globals
    Remove-Item -Path 'Function:\Update-CheckProgress' -ErrorAction SilentlyContinue
    Remove-Item -Path 'Function:\Update-ProgressStatus' -ErrorAction SilentlyContinue
    Remove-Variable -Name CheckProgressState -Scope Global -ErrorAction SilentlyContinue
}
