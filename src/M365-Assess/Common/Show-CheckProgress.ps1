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

$script:BackgroundPs  = $null
$script:BackgroundJob = $null
$script:State         = $null

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

# Reverse map: display label -> collector name (e.g. 'Entra Security Config' -> 'Entra')
# Used by Update-ProgressStatus to resolve "Running <label>..." messages from the orchestrator
$script:LabelToCollectorMap = @{}
foreach ($kv in $script:CollectorLabelMap.GetEnumerator()) {
    $script:LabelToCollectorMap[$kv.Value] = $kv.Key
}

# Ordered list for consistent display
$script:CollectorOrder = @('Entra', 'CAEvaluator', 'ExchangeOnline', 'DNS', 'Defender', 'Compliance', 'StrykerReadiness', 'Intune', 'SharePoint', 'Teams', 'PowerBI')

function Invoke-SpectreRenderLoop {
    <#
    .SYNOPSIS
        Starts a background PS runspace that renders a Spectre.Console live dashboard.
    .DESCRIPTION
        Launched by Initialize-CheckProgress in Spectre mode. The runspace reads from
        the synchronized $script:State hashtable every 100ms and redraws the dashboard.
        The runspace blocks on [Console]::ReadKey after $state.Complete is set.
        Close-CheckProgress calls EndInvoke to unblock and Dispose to release the runspace.
    #>
    [CmdletBinding()]
    param()

    # Capture script-level values needed inside the runspace (PSScriptRoot not available there)
    $libPath       = Join-Path -Path $PSScriptRoot -ChildPath '..\lib\Spectre.Console.dll'
    $capturedState = $script:State

    $script:BackgroundPs = [System.Management.Automation.PowerShell]::Create()
    $script:BackgroundPs.AddScript({
        param($state, $libPath)

        # Load Spectre inside the runspace
        Add-Type -Path $libPath -ErrorAction Stop

        # ── Build-Dashboard: constructs the Spectre renderable each tick ──
        # Defined inline here because the runspace has no access to the outer scope.
        function Build-Dashboard {
            param($s)

            # Escape user-supplied strings that will be interpolated into Spectre markup
            $esc = { param($v) if ($v) { [Spectre.Console.Markup]::Escape($v) } else { '' } }

            $elapsed = ([datetime]::Now - $s.StartTime).ToString('mm\:ss')
            $pct     = if ($s.Total -gt 0) { [int]($s.Completed / $s.Total * 100) } else { 0 }

            # Header status text
            $status    = if ($s.Complete) { '[green] COMPLETE [/]' } else { '[blue]running[/]' }
            $titleText = "[bold blue]M365 Security Assessment[/]  [grey]$(& $esc $s.TenantDomain) · v$(& $esc $s.Version) · $elapsed · $status[/]"

            # ── Metrics strip (5-cell table) ──
            $metrics = [Spectre.Console.Table]::new()
            $metrics.Border = [Spectre.Console.TableBorder]::None
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]CHECKS[/]'))   | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]PASS[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]FAIL[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]WARN[/]'))     | Out-Null
            $metrics.AddColumn([Spectre.Console.TableColumn]::new('[grey]SKIP[/]'))     | Out-Null
            $checksLabel = "[bold blue]$($s.Completed)[/][grey]/$($s.Total)[/]"
            $metrics.AddRow(
                $checksLabel,
                "[bold green]$($s.Pass)[/]",
                "[bold red]$($s.Fail)[/]",
                "[bold yellow]$($s.Warn)[/]",
                "[grey]$($s.Skip)[/]"
            ) | Out-Null

            # ── Section list (left sidebar) ──
            $secLines = foreach ($sec in $s.Sections) {
                switch ($sec.Status) {
                    'Complete' { "[green]✓ $((& $esc $sec.Name).PadRight(14))[/]" }
                    'Running'  { "[yellow]▶ $((& $esc $sec.Name).PadRight(14))[/]" }
                    default    { "[grey]○ $((& $esc $sec.Name).PadRight(14))[/]" }
                }
            }
            $secBlock = if ($secLines.Count -gt 0) { $secLines -join "`n" } else { '[grey](none)[/]' }

            # ── Live check stream (right panel, last 20 checks) ──
            $recentChecks = try {
                $snapshot = $s.Checks.ToArray()
                if ($snapshot.Count -gt 20) { $snapshot[($snapshot.Count - 20)..($snapshot.Count - 1)] } else { $snapshot }
            } catch { @() }

            $checkLines = foreach ($c in $recentChecks) {
                $icon  = switch ($c.Status) { 'Pass' { '[green]✓[/]' } 'Fail' { '[red]✗[/]' } 'Warning' { '[yellow]![/]' } 'Review' { '[cyan]?[/]' } default { '[grey]·[/]' } }
                $name  = if ($c.Setting.Length -gt 42) { $c.Setting.Substring(0, 39) + '...' } else { $c.Setting }
                $idStr = '[grey]' + ([Spectre.Console.Markup]::Escape($c.CheckId.ToString())).PadRight(26) + '[/]'
                "$icon $idStr $(& $esc $name)"
            }

            # Show output files on completion
            if ($s.Complete -and $s.OutputFiles.Count -gt 0) {
                $checkLines += ''
                $checkLines += '[grey]Output:[/]'
                foreach ($f in $s.OutputFiles) {
                    $checkLines += "  [blue]$(& $esc $f)[/]"
                }
            }

            $checkBlock = if ($checkLines.Count -gt 0) {
                "[grey]$(& $esc $s.CurrentCollector)[/]`n" + ($checkLines -join "`n")
            } else { '[grey]Waiting for checks...[/]' }

            # ── Body: two-column table ──
            $body = [Spectre.Console.Table]::new()
            $body.Border = [Spectre.Console.TableBorder]::Simple
            $body.AddColumn([Spectre.Console.TableColumn]::new('[grey]SECTIONS[/]').Width(18)) | Out-Null
            $body.AddColumn([Spectre.Console.TableColumn]::new('[grey]LIVE CHECKS[/]'))        | Out-Null
            $body.HideHeaders() | Out-Null
            $body.AddRow(
                [Spectre.Console.Markup]::new($secBlock),
                [Spectre.Console.Markup]::new($checkBlock)
            ) | Out-Null

            # ── Progress bar footer ──
            $filled  = [int]($pct / 100 * 40)
            $empty   = 40 - $filled
            $barFill = ([char]0x2588) * $filled   # █
            $barVoid = ([char]0x2591) * $empty    # ░
            $nextSec = ''
            $secList = @($s.Sections)
            for ($i = 0; $i -lt $secList.Count; $i++) {
                if ($secList[$i].Status -eq 'Running' -and ($i + 1) -lt $secList.Count) {
                    $nextSec = " · next: $(& $esc $secList[$i+1].Name)"
                    break
                }
            }
            $keyHint = if ($s.Complete) { '  [grey]press any key to exit[/]' } else { '' }
            $footer  = "[blue]$barFill[/][grey]$barVoid[/]  [white]$pct%[/]  $(& $esc $s.CurrentSection)$nextSec$keyHint"

            # ── Outer panel ──
            $outerGrid = [Spectre.Console.Grid]::new()
            $outerGrid.AddColumn() | Out-Null
            $outerGrid.AddRow($metrics)                                | Out-Null
            $outerGrid.AddRow($body)                                   | Out-Null
            $outerGrid.AddRow([Spectre.Console.Markup]::new($footer))  | Out-Null

            $panel = [Spectre.Console.Panel]::new($outerGrid)
            $panel.Header = [Spectre.Console.PanelHeader]::new($titleText)
            $panel.Border = [Spectre.Console.BoxBorder]::Rounded
            return $panel
        }

        # ── Live display loop ──
        $initial = [Spectre.Console.Markup]::new('[grey]Initializing...[/]')
        $live    = [Spectre.Console.AnsiConsole]::Live($initial)
        $live.AutoClear = $false

        $live.Start([Action[Spectre.Console.LiveDisplayContext]]{
            param([Spectre.Console.LiveDisplayContext]$ctx)
            while (-not $state.Complete) {
                try { $ctx.UpdateTarget((Build-Dashboard $state)) } catch { $state['LastRenderError'] = $_.ToString() }
                Start-Sleep -Milliseconds 100
            }
            # Final render with completion screen (output files + key hint)
            try { $ctx.UpdateTarget((Build-Dashboard $state)) } catch { $state['LastRenderError'] = $_.ToString() }
            # Block inside the Live context until keypress
            [Console]::ReadKey($true) | Out-Null
        })

    }) | Out-Null

    $script:BackgroundPs.AddParameter('state',   $capturedState) | Out-Null
    $script:BackgroundPs.AddParameter('libPath', $libPath)       | Out-Null

    $script:BackgroundJob = $script:BackgroundPs.BeginInvoke()
}


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
        [switch]$Silent,

        [Parameter()]
        [string]$TenantDomain = '',

        [Parameter()]
        [string]$Version = ''
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
    $script:State = [hashtable]::Synchronized(@{
        # Existing keys (preserved for backward compat + test coverage)
        Completed        = 0
        Total            = $totalChecks
        CheckIds         = @{}      # checkId -> collector name (for validation)
        CountedIds       = @{}      # checkId -> $true (track first occurrence for counter)
        CurrentCollector = ''
        CollectorCounts  = @{}      # collector -> total count
        CollectorDone    = @{}      # collector -> completed count
        PrintedHeaders   = @{}      # collector -> $true (header printed)
        LabelMap         = $script:CollectorLabelMap  # accessible from any scope via global state
        LicenseSkipped   = $licenseSkipped  # checkId -> required plans (for compliance overview)

        # New keys for Spectre mode
        Mode             = if ([Console]::IsOutputRedirected -or [Console]::IsInputRedirected -or $env:CI) { 'Fallback' } else { 'Spectre' }
        Complete         = $false
        Closed           = $false
        StartTime        = [datetime]::Now
        TenantDomain     = $TenantDomain
        Version          = $Version
        Pass             = 0
        Fail             = 0
        Warn             = 0
        Skip             = 0
        Sections         = [System.Collections.Generic.List[hashtable]]::new()
        Checks           = [System.Collections.Generic.List[hashtable]]::new()
        OutputFiles      = @()
    })
    $global:CheckProgressState = $script:State

    # Populate check IDs and collector counts
    foreach ($collectorName in $checksByCollector.Keys) {
        $script:State.CollectorCounts[$collectorName] = $checksByCollector[$collectorName].Count
        $script:State.CollectorDone[$collectorName] = 0
        foreach ($c in $checksByCollector[$collectorName]) {
            $script:State.CheckIds[$c.checkId] = $collectorName
        }
    }

    # Build ordered section list for the dashboard sidebar
    $sectionOrder = @('Identity', 'Email', 'Security', 'Intune', 'Collaboration', 'PowerBI')
    foreach ($sec in $sectionOrder) {
        if ($sec -in $ActiveSections) {
            $script:State.Sections.Add(@{ Name = $sec; Status = 'Pending' }) | Out-Null
        }
    }

    if ($Silent) { return }

    if ($script:State.Mode -eq 'Fallback') {
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
                Write-Host "    $([char]0x25B8) $($skipEntry.Key): $($skipInfo.Name)" -ForegroundColor DarkYellow
                Write-Host "      Requires: $planList" -ForegroundColor DarkGray
            }
        }
        Write-Host ''

        # Start the Write-Progress bar
        Write-Progress -Activity 'M365 Security Assessment' -Status "0 / $totalChecks checks complete" -PercentComplete 0 -Id 1
    } else {
        # Spectre mode: clear screen and start background render loop
        if ($totalChecks -eq 0) { return }
        [Console]::Clear()
        Invoke-SpectreRenderLoop
    }
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

    # Always append to Checks list (feeds the Spectre live stream)
    $state.Checks.Add(@{
        CheckId = $CheckId
        Setting = $Setting
        Status  = $Status
    }) | Out-Null

    # Update pass/fail/warn/skip counters (first occurrence only)
    if ($isFirstOccurrence) {
        switch ($Status) {
            'Pass'    { $state.Pass++ }
            'Fail'    { $state.Fail++ }
            'Warning' { $state.Warn++ }
            'Review'  { $state.Warn++ }
            'Skipped' { $state.Skip++ }
            'Info'    { }
        }
    }

    if ($state.Mode -eq 'Spectre') {
        # Dashboard reads from $state.Checks — no console output needed
        return
    }

    # ── Fallback path: existing Write-Host + Write-Progress output follows ──

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

    # Update Write-Progress bar (cap at 100%)
    $pct = [math]::Min(100, [math]::Round(($state.Completed / $state.Total) * 100))
    $statusText = "$($state.Completed) / $($state.Total) checks complete"
    Write-Progress -Activity 'M365 Security Assessment' -Status $statusText -PercentComplete $pct -Id 1
}


function global:Update-ProgressStatus {
    <#
    .SYNOPSIS
        Updates the current section/collector in the progress display.
    #>
    param([string]$Message)

    $state = $global:CheckProgressState
    if (-not $state -or $state.Total -eq 0) { return }

    # Resolve the collector name from the message.
    # The orchestrator may pass a raw collector name ('Entra') or a formatted
    # string like 'Running Entra Security Config...' — handle both.
    $collectorName = $null
    if ($script:CollectorSectionMap -and $script:CollectorSectionMap.ContainsKey($Message)) {
        # Direct match: message IS the collector name
        $collectorName = $Message
    } else {
        # Try stripping "Running " prefix and "..." suffix, then look up label
        $cleaned = $Message -replace '^Running\s+', '' -replace '\.{3}$', ''
        if ($script:LabelToCollectorMap -and $script:LabelToCollectorMap.ContainsKey($cleaned)) {
            $collectorName = $script:LabelToCollectorMap[$cleaned]
        }
    }

    # Track current section for dashboard sidebar highlighting
    if ($collectorName -and $script:CollectorSectionMap -and $script:CollectorSectionMap.ContainsKey($collectorName)) {
        $sec = $script:CollectorSectionMap[$collectorName]
        $state.CurrentSection    = $sec
        $state.CurrentCollector  = if ($script:CollectorLabelMap[$collectorName]) { $script:CollectorLabelMap[$collectorName] } else { $collectorName }

        # Transition: mark previous Running section Complete, mark current as Running
        foreach ($s in $state.Sections) {
            if ($s.Name -eq $sec)             { $s.Status = 'Running' }
            elseif ($s.Status -eq 'Running')  { $s.Status = 'Complete' }
        }
    }

    if ($state.Mode -eq 'Spectre') { return }

    # Fallback: update Write-Progress status text
    $pct = if ($state.Total -gt 0) { [math]::Round(($state.Completed / $state.Total) * 100) } else { 0 }
    Write-Progress -Activity 'M365 Security Assessment' -Status $Message -PercentComplete $pct -Id 1 -CurrentOperation "$($state.Completed) / $($state.Total) checks"
}


function Complete-CheckProgress {
    <#
    .SYNOPSIS
        Signals that all security checks are done. In Fallback mode, completes
        the progress bar and prints a summary line. In Spectre mode, sets
        $state.Complete = $true so the render loop transitions to the completion screen.
        Call Close-CheckProgress after report generation to wait for keypress and clean up.
    #>
    [CmdletBinding()]
    param()

    $state = $script:State
    if (-not $state) { return }

    $state.Complete = $true

    # Mark the last Running section as Complete
    foreach ($s in $state.Sections) {
        if ($s.Status -eq 'Running') { $s.Status = 'Complete' }
    }

    if ($state.Mode -eq 'Fallback') {
        if ($state.Total -gt 0) {
            Write-Progress -Activity 'M365 Security Assessment' -Completed -Id 1
            Write-Host ''
            Write-Host "  $([char]0x2713) All $($state.Total) security checks complete" -ForegroundColor Green
            Write-Host ''
        }
    }
    # Spectre mode: render loop sees Complete=true and shows the completion screen.
    # Main thread continues to report generation; Close-CheckProgress blocks on keypress.
}


function Close-CheckProgress {
    <#
    .SYNOPSIS
        Finalizes the progress display with output file paths, waits for keypress
        (Spectre mode), then tears down all global state and functions.
    .PARAMETER OutputFiles
        Array of absolute paths to generated output files (HTML, XLSX, etc.).
        Displayed on the completion screen in Spectre mode and printed to console in Fallback mode.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string[]]$OutputFiles = @()
    )

    $state = $script:State
    if (-not $state) { return }

    $state.OutputFiles = $OutputFiles

    if ($state.Mode -eq 'Spectre' -and $script:BackgroundPs -and $script:BackgroundJob) {
        try {
            # Blocks here until the background runspace's ReadKey returns (user presses a key)
            $script:BackgroundPs.EndInvoke($script:BackgroundJob)
        }
        catch {
            Write-Verbose "Spectre render loop error: $_"
        }
        finally {
            $script:BackgroundPs.Dispose()
            $script:BackgroundPs  = $null
            $script:BackgroundJob = $null
        }
    }
    elseif ($state.Mode -eq 'Fallback') {
        # Compact text summary for CI / non-interactive runs
        Write-Host ''
        Write-Host "  Results: $($state.Pass) pass  $($state.Fail) fail  $($state.Warn) warn  $($state.Skip) skip" -ForegroundColor Cyan
        if ($OutputFiles.Count -gt 0) {
            Write-Host '  Output:' -ForegroundColor White
            foreach ($f in $OutputFiles) {
                Write-Host "    $f" -ForegroundColor Cyan
            }
        }
        Write-Host ''
    }

    # Tear down global functions and state
    $state.Closed = $true
    Remove-Item -Path 'Function:\Update-CheckProgress'  -ErrorAction SilentlyContinue
    Remove-Item -Path 'Function:\Update-ProgressStatus' -ErrorAction SilentlyContinue
    Remove-Variable -Name CheckProgressState -Scope Global -ErrorAction SilentlyContinue
    $script:State         = $null
    $script:BackgroundPs  = $null
    $script:BackgroundJob = $null
}
