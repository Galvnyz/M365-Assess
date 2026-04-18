function Export-ComplianceOverview {
    <#
    .SYNOPSIS
        Renders the Compliance Overview HTML section from assessment findings.
    .DESCRIPTION
        Generates the compliance overview block including framework selector,
        coverage cards, status distribution bar, section filter, compliance
        matrix table, and embedded JSON for client-side filtering. Designed
        to be dot-sourced from Export-AssessmentReport.ps1 where helper
        functions (ConvertTo-HtmlSafe, Get-SvgHorizontalBar) are already
        defined.
    .PARAMETER Findings
        Array of finding objects with CheckId, Setting, Status, RiskSeverity,
        Section, and Frameworks hashtable.
    .PARAMETER ControlRegistry
        The control registry hashtable keyed by CheckId.
    .PARAMETER Frameworks
        Ordered array of framework definition hashtables from
        Import-FrameworkDefinitions.
    .PARAMETER FrameworkFilter
        Optional list of framework family names (CIS, NIST, etc.) to limit
        which frameworks appear in the overview.
    .PARAMETER Sections
        Array of section names from the assessment summary.
    .OUTPUTS
        System.String - HTML block for the compliance overview section.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject[]]$Findings,

        [Parameter(Mandatory)]
        [hashtable]$ControlRegistry,

        [Parameter(Mandatory)]
        [hashtable[]]$Frameworks,

        [Parameter()]
        [string[]]$FrameworkFilter,

        [Parameter()]
        [string[]]$Sections,

        [Parameter()]
        [switch]$WhiteLabel,

        [Parameter()]
        [AllowEmptyCollection()]
        [PSCustomObject[]]$FrameworkFilters
    )

    # Apply FrameworkFilter to narrow displayed frameworks
    $displayFrameworks = $Frameworks
    if ($FrameworkFilter -and $FrameworkFilter.Count -gt 0) {
        $displayFrameworks = @($Frameworks | Where-Object { $_.filterFamily -in $FrameworkFilter })
    }

    if ($displayFrameworks.Count -eq 0) {
        return ''
    }

    $html = [System.Text.StringBuilder]::new()

    $sectionHeading = 'Compliance Overview'
    $sectionDesc    = 'Security findings mapped across compliance frameworks. Use the selector below to choose which frameworks to display.'
    if ($WhiteLabel -and $FrameworkFilters -and $FrameworkFilters.Count -gt 0) {
        $subLevelFilters = @($FrameworkFilters | Where-Object { $_.HasSubLevel })
        if ($subLevelFilters.Count -eq 1) {
            $sectionHeading = "$($subLevelFilters[0].DisplayLabel) Compliance"
            $sectionDesc    = "Security findings assessed against $($subLevelFilters[0].DisplayLabel) controls."
        } elseif ($subLevelFilters.Count -gt 1) {
            $labels = ($subLevelFilters | ForEach-Object { $_.DisplayLabel }) -join ' / '
            $sectionHeading = "$labels Compliance"
            $sectionDesc    = "Security findings assessed against $labels controls."
        }
    }

    $null = $html.AppendLine("<details class='section' open>")
    $null = $html.AppendLine("<summary><h2>$(ConvertTo-HtmlSafe -Text $sectionHeading)</h2></summary>")
    $null = $html.AppendLine("<p>$sectionDesc</p>")

    # Informational disclaimer
    $null = $html.AppendLine("<div class='cis-disclaimer'>")
    $null = $html.AppendLine("<strong>Informational Notice</strong>")
    $null = $html.AppendLine("<p>This compliance assessment is provided for <strong>informational purposes only</strong> and does not constitute a comprehensive security assessment, audit, or certification. Results reflect automated checks at a point in time and should not be considered conclusive. For a thorough security evaluation, consider engaging a qualified security professional.</p>")
    $null = $html.AppendLine("</div>")

    # License-skipped notice
    if ($global:CheckProgressState -and $global:CheckProgressState.LicenseSkipped.Count -gt 0) {
        $skipCount = $global:CheckProgressState.LicenseSkipped.Count
        $planFriendlyNames = @{
            'AAD_PREMIUM_P2'                    = 'Entra ID P2'
            'ATP_ENTERPRISE'                    = 'Defender for Office 365'
            'LOCKBOX_ENTERPRISE'                = 'Customer Lockbox'
            'INTUNE_A'                          = 'Microsoft Intune'
            'INFORMATION_PROTECTION_COMPLIANCE' = 'Microsoft 365 compliance (requires Teams license)'
        }
        $skipListHtml = '<ul style="margin:6px 0 0;padding-left:20px;font-size:9pt;">'
        foreach ($entry in $global:CheckProgressState.LicenseSkipped.GetEnumerator()) {
            $info = $entry.Value
            $rawPlans = if ($info -is [hashtable] -and $info.RequiredPlans) { $info.RequiredPlans } else { @($info) }
            $planList = ($rawPlans | ForEach-Object { if ($planFriendlyNames.ContainsKey($_)) { $planFriendlyNames[$_] } else { $_ } }) -join ' or '
            $checkName = if ($info -is [hashtable] -and $info.Name) { ": $($info.Name)" } else { '' }
            $skipListHtml += "<li><strong>$($entry.Key)</strong>$checkName <span style='color:var(--m365a-medium-gray);'>&mdash; requires $planList</span></li>"
        }
        $skipListHtml += '</ul>'
        $null = $html.AppendLine("<div class='callout callout-info'><div class='callout-title'><span class='callout-icon'>&#9432;</span> License-Aware Check Gating</div><div class='callout-body'>$skipCount checks were skipped because the tenant does not have the required license service plans.$skipListHtml</div></div>")
    }

    # Pre-compute filter data
    $totalFindings = $Findings.Count
    $passCount = @($Findings | Where-Object { $_.Status -eq 'Pass' }).Count
    $failCount = @($Findings | Where-Object { $_.Status -eq 'Fail' }).Count
    $warnCount = @($Findings | Where-Object { $_.Status -eq 'Warning' }).Count
    $reviewCount = @($Findings | Where-Object { $_.Status -eq 'Review' }).Count
    $infoCount = @($Findings | Where-Object { $_.Status -eq 'Info' }).Count
    $knownStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info')
    $unknownCount = @($Findings | Where-Object { $_.Status -notin $knownStatuses }).Count
    $uniqueSections = @($Findings | Select-Object -ExpandProperty Section -ErrorAction SilentlyContinue | Where-Object { $_ } | Sort-Object -Unique)
    $severityOrder = @('Critical', 'High', 'Medium', 'Low', 'Info')
    $uniqueSeverities = @($Findings | Select-Object -ExpandProperty RiskSeverity -ErrorAction SilentlyContinue | Where-Object { $_ } | Sort-Object -Unique)
    $orderedSeverities = @($severityOrder | Where-Object { $_ -in $uniqueSeverities })

    # Collapsible filter panel
    $null = $html.AppendLine("<details class='co-filter-panel' id='coFilterPanel' open>")
    $null = $html.AppendLine("<summary class='co-filter-summary'><span class='co-filter-title'>Filters</span><span class='co-filter-badge' id='coFilterBadge' style='display:none'></span><button type='button' class='fw-action-btn co-reset-btn' id='coFilterReset'>Reset All</button></summary>")

    # Severity row
    $null = $html.AppendLine("<div class='co-filter-row' id='severityFilter'>")
    $null = $html.AppendLine("<span class='co-filter-label'>Severity:</span>")
    foreach ($sv in $orderedSeverities) {
        $svLower = $sv.ToLower()
        $svCount = @($Findings | Where-Object { $_.RiskSeverity -eq $sv }).Count
        $svClass = switch ($sv) { 'Critical' { 'badge-critical' } 'High' { 'badge-failed' } 'Medium' { 'badge-warning' } 'Low' { 'badge-info' } default { 'badge-neutral' } }
        $null = $html.AppendLine("<label class='co-chip $svClass active' data-value='$svLower'><input type='checkbox' value='$svLower' checked style='display:none'> $sv ($svCount)</label>")
    }
    $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' id='svSelectAll' class='fw-action-btn'>All</button><button type='button' id='svSelectNone' class='fw-action-btn'>None</button></span>")
    $null = $html.AppendLine("</div>")

    # Status row
    $null = $html.AppendLine("<div class='co-filter-row' id='statusFilter'>")
    $null = $html.AppendLine("<span class='co-filter-label'>Status:</span>")
    $null = $html.AppendLine("<label class='status-checkbox status-fail'><input type='checkbox' value='fail' checked> Fail ($failCount)</label>")
    if ($warnCount -gt 0) {
        $null = $html.AppendLine("<label class='status-checkbox status-warning'><input type='checkbox' value='warning' checked> Warning ($warnCount)</label>")
    }
    if ($reviewCount -gt 0) {
        $null = $html.AppendLine("<label class='status-checkbox status-review'><input type='checkbox' value='review' checked> Review ($reviewCount)</label>")
    }
    $null = $html.AppendLine("<label class='status-checkbox status-pass'><input type='checkbox' value='pass' checked> Pass ($passCount)</label>")
    if ($infoCount -gt 0) {
        $null = $html.AppendLine("<label class='status-checkbox status-info'><input type='checkbox' value='info' checked> Info ($infoCount)</label>")
    }
    if ($unknownCount -gt 0) {
        $null = $html.AppendLine("<label class='status-checkbox status-unknown'><input type='checkbox' value='unknown' checked> Unknown ($unknownCount)</label>")
    }
    if ($infoCount -gt 0) {
        $null = $html.AppendLine("<span class='info-note-inline'><span class='badge badge-neutral'>Info</span> = no pass/fail criteria; not included in pass rates</span>")
    }
    $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' id='statusSelectAll' class='fw-action-btn'>All</button><button type='button' id='statusSelectNone' class='fw-action-btn'>None</button></span>")
    $null = $html.AppendLine("</div>")

    # Framework row — hidden in white-label mode (framework is pre-selected via FrameworkFilters)
    if (-not $WhiteLabel) {
        $null = $html.AppendLine("<div class='co-filter-row' id='fwSelector'>")
        $null = $html.AppendLine("<span class='co-filter-label'>Frameworks:</span>")
        foreach ($fw in $displayFrameworks) {
            $null = $html.AppendLine("<label class='fw-checkbox'><input type='checkbox' value='$($fw.frameworkId)' checked> $($fw.label)</label>")
        }
        $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' id='fwSelectAll' class='fw-action-btn'>All</button><button type='button' id='fwSelectNone' class='fw-action-btn'>None</button></span>")
        $null = $html.AppendLine("</div>")
    } else {
        # Emit hidden inputs so JS framework-filtering logic still works
        $null = $html.AppendLine("<div id='fwSelector' style='display:none'>")
        foreach ($fw in $displayFrameworks) {
            $null = $html.AppendLine("<input type='checkbox' value='$($fw.frameworkId)' checked style='display:none'>")
        }
        $null = $html.AppendLine("</div>")
    }

    # CIS profile sub-filter (shown when cis-m365-v6 is active)
    $null = $html.AppendLine("<div class='co-filter-row' id='cisSubFilter' style='display:none'>")
    $null = $html.AppendLine("<span class='co-filter-label'>CIS Profile:</span>")
    $null = $html.AppendLine("<div class='co-profile-group'>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn active' data-profile='all'>All Profiles</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-profile='E3-L1'>E3 L1</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-profile='E3-L2'>E3 L2</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-profile='E5-L1'>E5 L1</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-profile='E5-L2'>E5 L2</button>")
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("</div>")

    # CMMC maturity level sub-filter (shown when cmmc is active)
    $null = $html.AppendLine("<div class='co-filter-row' id='cmmcSubFilter' style='display:none'>")
    $null = $html.AppendLine("<span class='co-filter-label'>CMMC Level:</span>")
    $null = $html.AppendLine("<div class='co-profile-group'>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn active' data-cmmc-level='all'>All Levels</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-cmmc-level='L1'>L1</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-cmmc-level='L2'>L2</button>")
    $null = $html.AppendLine("<button type='button' class='co-profile-btn' data-cmmc-level='L3'>L3</button>")
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("</div>")

    # Section row
    if ($uniqueSections.Count -gt 1) {
        $null = $html.AppendLine("<div class='co-filter-row' id='sectionFilter'>")
        $null = $html.AppendLine("<span class='co-filter-label'>Sections:</span>")
        foreach ($sec in $uniqueSections) {
            $secCount = @($Findings | Where-Object { $_.Section -eq $sec }).Count
            $null = $html.AppendLine("<label class='section-checkbox'><input type='checkbox' value='$(ConvertTo-HtmlSafe -Text $sec)' checked> $(ConvertTo-HtmlSafe -Text $sec) ($secCount)</label>")
        }
        $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' id='sectionSelectAll' class='fw-action-btn'>All</button><button type='button' id='sectionSelectNone' class='fw-action-btn'>None</button></span>")
        $null = $html.AppendLine("</div>")
    }

    $null = $html.AppendLine("</details>")

    # Status distribution bar chart
    if ($totalFindings -gt 0) {
        $segments = @(
            @{ Css = 'pass'; Pct = [math]::Round(($passCount / $totalFindings) * 100, 1); Count = $passCount; Label = 'Pass' }
            @{ Css = 'fail'; Pct = [math]::Round(($failCount / $totalFindings) * 100, 1); Count = $failCount; Label = 'Fail' }
            @{ Css = 'warning'; Pct = [math]::Round(($warnCount / $totalFindings) * 100, 1); Count = $warnCount; Label = 'Warning' }
            @{ Css = 'review'; Pct = [math]::Round(($reviewCount / $totalFindings) * 100, 1); Count = $reviewCount; Label = 'Review' }
        )
        if ($infoCount -gt 0) {
            $segments += @{ Css = 'info'; Pct = [math]::Round(($infoCount / $totalFindings) * 100, 1); Count = $infoCount; Label = 'Info' }
        }
        if ($unknownCount -gt 0) {
            $segments += @{ Css = 'unknown'; Pct = [math]::Round(($unknownCount / $totalFindings) * 100, 1); Count = $unknownCount; Label = 'Unknown' }
        }
        $barChart = Get-SvgHorizontalBar -Segments $segments
        $null = $html.AppendLine("<div class='compliance-status-bar'>")
        $null = $html.AppendLine("<div class='compliance-bar-header'><span class='compliance-bar-title'>Finding Status Distribution</span><span class='compliance-bar-total'>$totalFindings controls assessed</span></div>")
        $null = $html.AppendLine($barChart)
        $null = $html.AppendLine("<div class='hbar-legend'>")
        foreach ($seg in $segments) {
            if ($seg.Count -gt 0) {
                $dotClass = switch ($seg.Css) { 'pass' { 'success' } 'fail' { 'danger' } 'warning' { 'warning' } 'review' { 'info' } 'info' { 'neutral' } default { 'muted' } }
                $null = $html.AppendLine("<span class='hbar-legend-item'><span class='chart-legend-dot dot-$dotClass'></span>$($seg.Label) ($($seg.Count))</span>")
            }
        }
        $null = $html.AppendLine("</div>")
        $null = $html.AppendLine("</div>")
    }

    # Framework coverage cards (one per framework)
    $null = $html.AppendLine("<div class='exec-summary' id='fwCards'>")
    foreach ($fw in $displayFrameworks) {
        $fwId = $fw.frameworkId
        $isProfileBased = $fw.scoringMethod -eq 'profile-compliance'

        if ($isProfileBased -and $fw.profiles) {
            # Profile-based card (CIS, NIST) -- pass rate as primary, coverage bar as secondary
            $profileFindings = @($Findings | Where-Object { $_.Frameworks -and $_.Frameworks.ContainsKey($fwId) })
            $profilePass = ($profileFindings | Where-Object { $_.Status -eq 'Pass' } |
                ForEach-Object { $_.CheckId -replace '\.\d+$', '' } | Sort-Object -Unique).Count
            $profileScored = ($profileFindings | Where-Object { $_.Status -ne 'Info' } |
                ForEach-Object { $_.CheckId -replace '\.\d+$', '' } | Sort-Object -Unique).Count
            $profileScore = if ($profileScored -gt 0) { [math]::Round(($profilePass / $profileScored) * 100, 1) } else { 0 }
            $scoreDisplay = if ($profileScored -gt 0) { "$profileScore%" } else { 'N/A' }
            $scoreClass = if ($profileScored -eq 0) { '' } elseif ($profileScore -ge 80) { 'success' } elseif ($profileScore -ge 60) { 'warning' } else { 'danger' }
            $catalogTotal = $fw.totalControls
            $coverageLabel = if ($catalogTotal -gt 0) { "$profileScored of $catalogTotal assessed" } else { "$profileScored assessed" }
            $coveragePct = if ($catalogTotal -gt 0) { [math]::Min(100, [math]::Round(($profileScored / $catalogTotal) * 100, 0)) } else { 0 }
            $tooltip = if ($fw.description) { " title='$(ConvertTo-HtmlSafe -Text $fw.description)'" } else { '' }

            # Detect level-based profiles (L1/L2 suffix) for sub-metric breakdown
            $profileKeys = @($fw.profiles.PSObject.Properties.Name)
            $levelKeys = @($profileKeys | ForEach-Object { if ($_ -match '-L(\d+)$') { "L$($Matches[1])" } } | Sort-Object -Unique)
            $levelBreakdownHtml = ''
            if ($levelKeys.Count -ge 2) {
                foreach ($level in $levelKeys) {
                    $levelProfiles = @($profileKeys | Where-Object { $_ -like "*-$level" })
                    $levelFindings = @($profileFindings | Where-Object {
                        $fwData = $_.Frameworks[$fwId]
                        $fwProfiles = if ($fwData.profiles) { @($fwData.profiles) } else { @() }
                        $matched = $false
                        foreach ($lp in $levelProfiles) { if ($lp -in $fwProfiles) { $matched = $true; break } }
                        $matched
                    })
                    $lvlTotal = $levelFindings.Count
                    $lvlPass = @($levelFindings | Where-Object { $_.Status -eq 'Pass' }).Count
                    $lvlRate = if ($lvlTotal -gt 0) { [math]::Round(($lvlPass / $lvlTotal) * 100, 1) } else { 0 }
                    $lvlClass = if ($lvlTotal -eq 0) { 'neutral' } elseif ($lvlRate -ge 80) { 'success' } elseif ($lvlRate -ge 60) { 'warning' } else { 'danger' }
                    $lvlDisplay = if ($lvlTotal -gt 0) { "$lvlRate%" } else { 'N/A' }
                    $levelBreakdownHtml += "<div class='profile-level-row'><span class='profile-level-label'>$level</span><span class='badge badge-$lvlClass' style='font-size:7.5pt;padding:2px 6px;'>$lvlDisplay</span><span class='profile-level-detail'>$lvlPass/$lvlTotal pass</span></div>"
                }
            }

            $null = $html.AppendLine("<div class='stat-card fw-card $scoreClass' data-fw='$fwId' data-catalog-total='$catalogTotal'$tooltip><div class='stat-value'>$scoreDisplay</div><div class='stat-label'>$($fw.label)</div><div class='stat-sublabel'>$coverageLabel</div><div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div><div class='coverage-label'>$coveragePct% coverage</div>$levelBreakdownHtml</div>")
        }
        else {
            # Non-profile card -- pass rate as primary, coverage bar as secondary
            $mappedFindings = @($Findings | Where-Object { $_.Frameworks -and $_.Frameworks.ContainsKey($fwId) })
            $mappedControls = @($mappedFindings | ForEach-Object {
                $fwData = $_.Frameworks[$fwId]
                if ($fwData.controlId) { $fwData.controlId -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } }
            } | Sort-Object -Unique)
            $mappedCount = $mappedControls.Count
            $mappedPass = ($mappedFindings | Where-Object { $_.Status -eq 'Pass' } |
                ForEach-Object { $_.CheckId -replace '\.\d+$', '' } | Sort-Object -Unique).Count
            $mappedTotal = ($mappedFindings | Where-Object { $_.Status -ne 'Info' } |
                ForEach-Object { $_.CheckId -replace '\.\d+$', '' } | Sort-Object -Unique).Count
            $passRate = if ($mappedTotal -gt 0) { [math]::Round(($mappedPass / $mappedTotal) * 100, 1) } else { 0 }
            $passDisplay = if ($mappedTotal -gt 0) { "$passRate%" } else { 'N/A' }
            $passClass = if ($mappedTotal -eq 0) { '' } elseif ($passRate -ge 80) { 'success' } elseif ($passRate -ge 60) { 'warning' } else { 'danger' }
            $totalCount = $fw.totalControls
            $coveragePct = if ($totalCount -gt 0) { [math]::Min(100, [math]::Round(($mappedCount / $totalCount) * 100, 0)) } else { 0 }
            $coverageLabel = if ($totalCount -gt 0) { "$mappedTotal of $totalCount assessed" } else { "$mappedTotal assessed" }
            $coverageBarHtml = if ($totalCount -gt 0) { "<div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div><div class='coverage-label'>$coveragePct% coverage</div>" } else { '' }
            $tooltip = if ($fw.description) { " title='$(ConvertTo-HtmlSafe -Text $fw.description)'" } else { '' }
            $null = $html.AppendLine("<div class='stat-card fw-card $passClass' data-fw='$fwId' data-catalog-total='$totalCount'$tooltip><div class='stat-value'>$passDisplay</div><div class='stat-label'>$($fw.label)</div><div class='stat-sublabel'>$coverageLabel</div>$coverageBarHtml</div>")
        }
    }
    $null = $html.AppendLine("</div>")

    # Unified compliance matrix table (one column per framework)
    $null = $html.AppendLine("<div class='table-wrapper'>")
    $null = $html.AppendLine("<table class='data-table matrix-table' id='complianceTable'>")

    # Header row -- fixed columns + one column per framework
    $headerCols = "<th scope='col'>Control</th><th scope='col'>Description</th><th scope='col'>Status</th><th scope='col'>Severity</th>"
    foreach ($fw in $displayFrameworks) {
        $headerCols += "<th scope='col' class='fw-col' data-fw='$($fw.frameworkId)'>$($fw.label)</th>"
    }
    $null = $html.AppendLine("<thead><tr>$headerCols</tr></thead>")
    $null = $html.AppendLine("<tbody>")

    # Sort findings by CheckId (groups by collector area)
    $matrixFindings = @($Findings | Sort-Object -Property CheckId)
    foreach ($finding in $matrixFindings) {
        $statusClass = switch ($finding.Status) {
            'Pass'    { 'badge-success' }
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-info' }
            'Info'    { 'badge-neutral' }
            default   { 'badge-skipped' }
        }
        $statusBadge = "<span class='badge $statusClass'>$($finding.Status)</span>"
        $checkRef = ConvertTo-HtmlSafe -Text $finding.CheckId
        $settingText = ConvertTo-HtmlSafe -Text $finding.Setting

        $svAttr = if ($finding.RiskSeverity) { " data-sv='$($finding.RiskSeverity.ToLower())'" } else { '' }
        $cisProfilesAttr = ''
        $cisFwId = 'cis-m365-v6'
        if ($finding.Frameworks -and $finding.Frameworks.ContainsKey($cisFwId)) {
            $cisEntry = $finding.Frameworks[$cisFwId]
            if ($cisEntry.profiles -and $cisEntry.profiles.Count -gt 0) {
                $cisProfilesAttr = " data-cis-profiles='$($cisEntry.profiles -join ',')'"
            }
        }
        $cmmcLevelAttr = ''
        $cmmcFwId = 'cmmc'
        if ($finding.Frameworks -and $finding.Frameworks.ContainsKey($cmmcFwId)) {
            $cmmcEntry = $finding.Frameworks[$cmmcFwId]
            if ($cmmcEntry -and $cmmcEntry.controlId) {
                $cmmcLevels = ($cmmcEntry.controlId -split ';') |
                    ForEach-Object { if ($_ -match '\.L(\d+)-') { "L$($Matches[1])" } } |
                    Sort-Object -Unique
                if ($cmmcLevels) { $cmmcLevelAttr = " data-cmmc-level='$($cmmcLevels -join ',')'" }
            }
        }
        $null = $html.AppendLine("<tr class='cis-row-$($finding.Status.ToLower())' data-section='$(ConvertTo-HtmlSafe -Text $finding.Section)'$svAttr$cisProfilesAttr$cmmcLevelAttr>")
        $severityClass = switch ($finding.RiskSeverity) {
            'Critical' { 'badge-critical' }
            'High'     { 'badge-failed' }
            'Medium'   { 'badge-warning' }
            'Low'      { 'badge-info' }
            'Info'     { 'badge-neutral' }
            default    { 'badge-neutral' }
        }
        $severityBadge = "<span class='badge $severityClass'>$($finding.RiskSeverity)</span>"

        $null = $html.AppendLine("<td class='cis-id'>$checkRef</td>")
        $null = $html.AppendLine("<td>$settingText</td>")
        $null = $html.AppendLine("<td>$statusBadge</td>")
        $null = $html.AppendLine("<td>$severityBadge</td>")

        # One cell per framework -- profile tags inline for profile-based frameworks
        foreach ($fw in $displayFrameworks) {
            $fwId = $fw.frameworkId
            $fwData = if ($finding.Frameworks -and $finding.Frameworks.ContainsKey($fwId)) { $finding.Frameworks[$fwId] } else { $null }
            if ($fwData -and $fwData.controlId) {
                $controlId = $fwData.controlId
                $tagHtml = "<span class='fw-tag $($fw.css)'>$(ConvertTo-HtmlSafe -Text $controlId)</span>"
                # Add inline profile tags for profile-based frameworks
                if ($fwData.profiles -and $fwData.profiles.Count -gt 0) {
                    $profileTags = ($fwData.profiles | ForEach-Object { "<span class='fw-profile-tag'>$_</span>" }) -join ''
                    $tagHtml += " $profileTags"
                }
                $null = $html.AppendLine("<td class='fw-col framework-refs' data-fw='$fwId'>$tagHtml</td>")
            }
            else {
                $null = $html.AppendLine("<td class='fw-col framework-refs' data-fw='$fwId'><span class='fw-unmapped'>&mdash;</span></td>")
            }
        }
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table>")
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("<div id='complianceNoResults' class='no-results' style='display:none'><p>No findings match the current filter selection.</p></div>")

    # Embed compliance data for client-side filtering/recalculation
    $complianceJson = @($Findings | ForEach-Object {
        $fwMap = [ordered]@{}
        if ($_.Frameworks) {
            foreach ($fw in $displayFrameworks) {
                $fwId = $fw.frameworkId
                if ($_.Frameworks.ContainsKey($fwId)) {
                    $fwEntry = $_.Frameworks[$fwId]
                    $jsEntry = @{ id = $fwEntry.controlId }
                    if ($fwEntry.profiles -and $fwEntry.profiles.Count -gt 0) {
                        $jsEntry['p'] = @($fwEntry.profiles)
                    }
                    $fwMap[$fwId] = $jsEntry
                }
            }
        }
        [PSCustomObject]@{
            c  = $_.CheckId
            s  = $_.Section
            st = $_.Status
            sv = $_.RiskSeverity
            fw = $fwMap
        }
    }) | ConvertTo-Json -Compress -Depth 4
    $null = $html.AppendLine("<script>var complianceData = $complianceJson;</script>")
    $null = $html.AppendLine("</details>")

    return $html.ToString()
}
