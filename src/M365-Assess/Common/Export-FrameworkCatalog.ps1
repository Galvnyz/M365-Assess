function Export-FrameworkCatalog {
    <#
    .SYNOPSIS
        Produces framework-specific catalog output from assessment findings.
    .DESCRIPTION
        Dispatches on the framework's scoring method to parse controlId strings into
        structural groups and compute coverage/pass rates per group. Returns a uniform
        GroupedResult structure for Grouped mode.
    .PARAMETER Findings
        Array of finding objects from the assessment collectors.
    .PARAMETER Framework
        Framework hashtable from Import-FrameworkDefinitions (includes scoringMethod,
        scoringData, profiles, totalControls, etc.).
    .PARAMETER ControlRegistry
        Hashtable of checkId -> registry entry, used as fallback for framework mapping.
    .PARAMETER Mode
        Rendering mode: Inline (embed in report), Grouped (return data structure),
        or Standalone (full HTML page).
    .PARAMETER OutputPath
        Output file path for Standalone mode.
    .PARAMETER TenantName
        Tenant display name for Standalone mode headers.
    .OUTPUTS
        System.Collections.Hashtable
        GroupedResult with Groups array and Summary for Grouped mode.
        System.String placeholder for Inline and Standalone modes.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject[]]$Findings,
        [Parameter(Mandatory)][hashtable]$Framework,
        [Parameter(Mandatory)][hashtable]$ControlRegistry,
        [Parameter(Mandatory)][ValidateSet('Inline','Grouped','Standalone')][string]$Mode,
        [Parameter()][string]$OutputPath,
        [Parameter()][string]$TenantName
    )

    # --- Common: resolve framework mappings and score ---
    $scoredResult = Invoke-FrameworkScoring -Findings $Findings -Framework $Framework -ControlRegistry $ControlRegistry

    if ($Mode -eq 'Grouped') {
        return $scoredResult
    }

    if ($Mode -eq 'Inline') {
        return ConvertTo-CatalogInlineHtml -Framework $Framework -ScoredResult $scoredResult -MappedFindings $scoredResult.MappedFindings
    }

    # --- Standalone mode: write complete HTML file ---
    if (-not $OutputPath) {
        throw 'Standalone mode requires the -OutputPath parameter.'
    }
    if (-not $TenantName) {
        $TenantName = 'Unknown'
    }
    $standaloneContent = ConvertTo-CatalogStandaloneHtml -Framework $Framework -ScoredResult $scoredResult -MappedFindings $scoredResult.MappedFindings -TenantName $TenantName
    $standaloneContent | Set-Content -Path $OutputPath -Encoding UTF8 -Force
    return $OutputPath
}

# ---------------------------------------------------------------------------
# Private: run scoring engine and return GroupedResult + MappedFindings
# ---------------------------------------------------------------------------
function Invoke-FrameworkScoring {
    [CmdletBinding()]
    param(
        [PSCustomObject[]]$Findings,
        [hashtable]$Framework,
        [hashtable]$ControlRegistry
    )

    $fwId = $Framework.frameworkId
    $scoringMethod = $Framework.scoringMethod
    Write-Verbose "Export-FrameworkCatalog: Processing '$fwId' with scoring method '$scoringMethod'"

    # Resolve framework mapping for each finding
    $mappedFindings = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($finding in $Findings) {
        $fwMapping = $null

        if ($finding.Frameworks -and $finding.Frameworks.PSObject.Properties.Name -contains $fwId) {
            $fwMapping = $finding.Frameworks.$fwId
        }
        elseif ($finding.Frameworks -is [hashtable] -and $finding.Frameworks.ContainsKey($fwId)) {
            $fwMapping = $finding.Frameworks[$fwId]
        }

        if (-not $fwMapping -and $finding.CheckId -and $ControlRegistry.ContainsKey($finding.CheckId)) {
            $regEntry = $ControlRegistry[$finding.CheckId]
            if ($regEntry.frameworks -and $regEntry.frameworks.PSObject.Properties.Name -contains $fwId) {
                $fwMapping = $regEntry.frameworks.$fwId
            }
            elseif ($regEntry.frameworks -is [hashtable] -and $regEntry.frameworks.ContainsKey($fwId)) {
                $fwMapping = $regEntry.frameworks[$fwId]
            }
        }

        if ($fwMapping) {
            $controlId = ''
            if ($fwMapping -is [hashtable] -and $fwMapping.ContainsKey('controlId')) {
                $controlId = [string]$fwMapping.controlId
            }
            elseif ($fwMapping.PSObject.Properties.Name -contains 'controlId') {
                $controlId = [string]$fwMapping.controlId
            }

            $profiles = @()
            if ($fwMapping -is [hashtable] -and $fwMapping.ContainsKey('profiles')) {
                $profiles = @($fwMapping.profiles)
            }
            elseif ($fwMapping.PSObject -and $fwMapping.PSObject.Properties.Name -contains 'profiles') {
                $profiles = @($fwMapping.profiles)
            }

            $mappedFindings.Add(@{
                Finding   = $finding
                ControlId = $controlId
                Profiles  = $profiles
            })
        }
    }

    Write-Verbose "Export-FrameworkCatalog: Mapped $($mappedFindings.Count) of $($Findings.Count) findings to '$fwId'"

    # Validate scoring method
    $validMethods = @(
        'profile-compliance', 'function-coverage', 'control-coverage',
        'technique-coverage', 'maturity-level', 'severity-coverage',
        'requirement-compliance', 'criteria-coverage', 'policy-compliance'
    )
    if (-not $scoringMethod -or $scoringMethod -notin $validMethods) {
        Write-Warning "Unknown scoring method '$scoringMethod' for framework '$fwId'; falling back to control-coverage."
        $scoringMethod = 'control-coverage'
    }

    # Dispatch to scoring handler
    $groups = switch ($scoringMethod) {
        'profile-compliance'      { Invoke-ProfileCompliance -Framework $Framework -MappedFindings $mappedFindings }
        'function-coverage'       { Invoke-FunctionCoverage -Framework $Framework -MappedFindings $mappedFindings }
        'control-coverage'        { Invoke-ControlCoverage -Framework $Framework -MappedFindings $mappedFindings }
        'technique-coverage'      { Invoke-TechniqueCoverage -Framework $Framework -MappedFindings $mappedFindings }
        'maturity-level'          { Invoke-MaturityLevel -Framework $Framework -MappedFindings $mappedFindings }
        'severity-coverage'       { Invoke-SeverityCoverage -Framework $Framework -MappedFindings $mappedFindings }
        'requirement-compliance'  { Invoke-RequirementCompliance -Framework $Framework -MappedFindings $mappedFindings }
        'criteria-coverage'       { Invoke-CriteriaCoverage -Framework $Framework -MappedFindings $mappedFindings }
        'policy-compliance'       { Invoke-PolicyCompliance -Framework $Framework -MappedFindings $mappedFindings }
    }

    # Sort groups by key for consistent display order
    # Scoring data key order maps: numeric (1,2,3), alpha-numeric (L1,L2,ML1,ML2), Roman (CAT-I,CAT-II)
    $groups = @($groups | Sort-Object -Property { Get-GroupSortKey -Key $_.Key })

    # Append stub rows for controls in the framework definition that have no results
    # Controls array is stored under extraData (loaded via Import-FrameworkDefinitions)
    # or directly on the framework object (passed as PSCustomObject or hashtable with 'controls' key)
    $fwControls = $null
    if ($Framework -is [hashtable]) {
        if ($Framework.ContainsKey('extraData') -and $Framework.extraData -is [hashtable] -and
            $Framework.extraData.ContainsKey('controls') -and $Framework.extraData['controls']) {
            $fwControls = $Framework.extraData['controls']
        }
        elseif ($Framework.ContainsKey('controls') -and $Framework.controls) {
            $fwControls = $Framework.controls
        }
    }
    elseif ($Framework.PSObject.Properties.Name -contains 'controls' -and $Framework.controls) {
        $fwControls = $Framework.controls
    }

    if ($fwControls -and @($fwControls).Count -gt 0) {
        $coveredIds = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
        # Add controlIds tracked by group objects (if any)
        foreach ($grp in $groups) {
            if ($grp.ControlId) { [void]$coveredIds.Add($grp.ControlId) }
        }
        # Also include controlIds from mappedFindings for accurate covered detection
        foreach ($mf in $mappedFindings) {
            if ($mf.ControlId) {
                foreach ($cid in ($mf.ControlId -split ';')) {
                    [void]$coveredIds.Add($cid.Trim())
                }
            }
        }
        foreach ($ctrl in @($fwControls)) {
            $cid = if ($ctrl -is [hashtable]) { $ctrl['controlId'] } else { $ctrl.controlId }
            if (-not $cid) { continue }
            if ($coveredIds.Contains($cid)) { continue }
            $ctrlTitle  = if ($ctrl -is [hashtable]) { $ctrl['title']  } else { $ctrl.title  }
            $ctrlDomain = if ($ctrl -is [hashtable]) { $ctrl['domain'] } else { $ctrl.domain }
            $ctrlLevel  = if ($ctrl -is [hashtable]) { $ctrl['level']  } else { $ctrl.level  }
            $groups += @{
                ControlId = $cid
                Label     = if ($ctrlTitle)  { $ctrlTitle }  else { '' }
                Domain    = if ($ctrlDomain) { $ctrlDomain } else { '' }
                Level     = if ($ctrlLevel)  { $ctrlLevel }  else { '' }
                IsGap     = $true
                Key       = $cid
                Total     = 0
                Mapped    = 0
                Covered   = 0
                Passed    = 0
                Failed    = 0
                Warning   = 0
                Review    = 0
                Other     = 0
                Findings  = @()
            }
        }
    }

    # Build summary
    $scoredFindings = @($mappedFindings | Where-Object { $_.Finding.Status -ne 'Info' })
    $totalMapped = ($scoredFindings | ForEach-Object { $_.Finding.CheckId } | Select-Object -Unique).Count
    $totalPassed = ($scoredFindings | Where-Object { $_.Finding.Status -eq 'Pass' } |
        ForEach-Object { $_.Finding.CheckId } | Select-Object -Unique).Count
    $passRate = if ($totalMapped -gt 0) { [math]::Round($totalPassed / $totalMapped, 2) } else { 0 }
    # Deduplicate covered controls across all groups by unique framework controlId
    # (profiles overlap -- E5-L1 includes E3-L1 -- so summing per-group would double-count)
    $allCoveredIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($mf in $mappedFindings) {
        if ($mf.ControlId) {
            foreach ($cid in ($mf.ControlId -split ';')) {
                [void]$allCoveredIds.Add($cid.Trim())
            }
        }
    }
    $totalCovered = $allCoveredIds.Count

    return @{
        Groups         = @($groups)
        Summary        = @{
            TotalControls  = [int]$Framework.totalControls
            MappedControls = $totalMapped
            CoveredControls = $totalCovered
            PassRate       = $passRate
        }
        MappedFindings = $mappedFindings
    }
}

# ---------------------------------------------------------------------------
# Private: render Inline HTML fragment for a single framework catalog
# ---------------------------------------------------------------------------
function ConvertTo-CatalogInlineHtml {
    [CmdletBinding()]
    param(
        [hashtable]$Framework,
        [hashtable]$ScoredResult,
        [System.Collections.Generic.List[hashtable]]$MappedFindings
    )

    $fwId = $Framework.frameworkId
    $fwLabel = $Framework.label
    $fwCss = if ($Framework.css) { $Framework.css } else { 'fw-default' }
    $summary = $ScoredResult.Summary
    $groups = $ScoredResult.Groups

    $scoringMethodLabels = @{
        'profile-compliance'     = 'Profile Compliance'
        'control-coverage'       = 'Control Coverage'
        'maturity-level'         = 'Maturity Level'
        'severity-coverage'      = 'Severity Coverage'
        'function-coverage'      = 'Function Coverage'
        'technique-coverage'     = 'Technique Coverage'
        'requirement-compliance' = 'Requirement Compliance'
        'criteria-coverage'      = 'Criteria Coverage'
        'policy-compliance'      = 'Policy Compliance'
    }
    $scoringLabel = if ($scoringMethodLabels.ContainsKey($Framework.scoringMethod)) {
        $scoringMethodLabels[$Framework.scoringMethod]
    }
    else { $Framework.scoringMethod }

    $html = [System.Text.StringBuilder]::new(4096)

    # Outer collapsible section
    $null = $html.AppendLine("<details class='section catalog-section' data-fw='$fwId'>")
    $null = $html.AppendLine("<summary><h3><span class='fw-tag $fwCss'>$fwLabel</span> Framework Catalog</h3></summary>")

    # Zero-mapped placeholder
    if ($summary.MappedControls -eq 0) {
        $null = $html.AppendLine("<p class='catalog-empty'>No assessed findings map to this framework.</p>")
        $null = $html.AppendLine("</details>")
        return $html.ToString()
    }

    # Overall summary bar
    $passRatePct = [math]::Round($summary.PassRate * 100, 1)
    $passClass = if ($passRatePct -ge 80) { 'success' } elseif ($passRatePct -ge 60) { 'warning' } else { 'danger' }
    $coveredCount = if ($summary.CoveredControls) { $summary.CoveredControls } else { $summary.MappedControls }
    $coveragePct = if ($summary.TotalControls -gt 0) { [math]::Min(100, [math]::Round(($coveredCount / $summary.TotalControls) * 100, 0)) } else { 0 }

    $null = $html.AppendLine("<div class='catalog-summary'>")
    $null = $html.AppendLine("<div class='catalog-stats'>")
    $null = $html.AppendLine("<span class='catalog-stat'><strong>Pass Rate:</strong> <span class='badge badge-$passClass' title='Percentage of assessed checks that returned Pass'>$passRatePct%</span></span>")
    if ($summary.TotalControls -gt 0) {
        $null = $html.AppendLine("<span class='catalog-stat' title='Distinct framework controls with at least one mapped check'><strong>Coverage:</strong> $coveredCount of $($summary.TotalControls) controls</span>")
    }
    $null = $html.AppendLine("<span class='catalog-stat' title='Automated checks mapped to this framework'><strong>Checks Assessed:</strong> $($summary.MappedControls)</span>")
    $null = $html.AppendLine("<span class='catalog-stat catalog-scoring' title='Scoring method: $scoringLabel'>&#9432; $scoringLabel</span>")
    $null = $html.AppendLine("</div>")
    if ($summary.TotalControls -gt 0) {
        $null = $html.AppendLine("<div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div>")
        $null = $html.AppendLine("<div class='coverage-label'>$coveragePct% coverage</div>")
    }
    $null = $html.AppendLine("</div>")

    # Group breakdown table with catalog CSV export button
    $catalogTableId = "catalog-groups-$fwId"
    $null = $html.AppendLine("<div class='catalog-filter-bar status-filter' style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;'>")
    $null = $html.AppendLine("<button class='catalog-csv-btn csv-export-btn'>Export CSV</button>")
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("<table id='$catalogTableId' class='catalog-groups' data-catalog-table='$fwId'><thead><tr>")
    $null = $html.AppendLine("<th>Group</th><th>Label</th><th title='Total controls defined in this framework group'>Total Controls</th><th title='Controls with no automated check in this assessment'>Not Automated</th><th>Coverage %</th><th>Automated Checks</th><th>Passed</th><th>Failed</th><th>Warning</th><th>Review</th><th>Pass Rate</th>")
    $null = $html.AppendLine("</tr></thead><tbody>")

    foreach ($group in $groups) {
        # Gap row: control exists in framework definition but has no automated checks
        if ($group.IsGap) {
            $idEncoded    = [System.Web.HttpUtility]::HtmlEncode([string]$group.ControlId)
            $labelEncoded = [System.Web.HttpUtility]::HtmlEncode([string]$group.Label)
            $null = $html.AppendLine("<tr class='fw-catalog-gap-row'><td><span class='fw-tag $fwCss'>$idEncoded</span></td><td>$labelEncoded</td><td colspan='9'><span class='fw-catalog-gap-badge'>No automated check</span></td></tr>")
            continue
        }

        $grpPassRate = if ($group.Mapped -gt 0) { [math]::Round(($group.Passed / $group.Mapped) * 100, 1) } else { 0 }
        $grpClass = if ($group.Mapped -eq 0) { '' } elseif ($grpPassRate -ge 80) { 'success' } elseif ($grpPassRate -ge 60) { 'warning' } else { 'danger' }

        $grpGapCount = if ($group.Total -gt 0) { $group.Total - $group.Covered } else { 0 }
        $null = $html.AppendLine("<tr>")
        $null = $html.AppendLine("<td><span class='fw-tag $fwCss'>$([System.Web.HttpUtility]::HtmlEncode([string]$group.Key))</span></td>")
        $null = $html.AppendLine("<td>$([System.Web.HttpUtility]::HtmlEncode([string]$group.Label))</td>")
        $null = $html.AppendLine("<td>$($group.Total)</td>")
        $notAutoDisplay = if ($grpGapCount -gt 0) { "<span class='fw-catalog-gap-badge' title='$grpGapCount control(s) with no automated check'>$grpGapCount</span>" } else { '0' }
        $null = $html.AppendLine("<td>$notAutoDisplay</td>")
        $coveragePctVal = if ($group.Total -gt 0) { [math]::Round(($group.Covered / $group.Total) * 100, 0) } else { 0 }
        $coverageDisplay = if ($group.Total -gt 0) { "<span title='$($group.Covered) of $($group.Total) controls'>$coveragePctVal%</span>" } else { "$($group.Covered)" }
        $null = $html.AppendLine("<td>$coverageDisplay</td>")
        $null = $html.AppendLine("<td>$($group.Mapped)</td>")
        $null = $html.AppendLine("<td>$($group.Passed)</td>")
        $null = $html.AppendLine("<td>$($group.Failed)</td>")
        $null = $html.AppendLine("<td>$($group.Warning)</td>")
        $null = $html.AppendLine("<td>$($group.Review)</td>")
        $passDisplay = if ($group.Mapped -gt 0) { "$grpPassRate%" } else { '&mdash;' }
        $badgeCss = switch ($grpClass) { 'success' { 'badge-success' } 'warning' { 'badge-warning' } 'danger' { 'badge-failed' } default { 'badge-neutral' } }
        $null = $html.AppendLine("<td><span class='badge $badgeCss'>$passDisplay</span></td>")
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table>")

    # Findings detail table (collapsible)
    $null = $html.AppendLine("<details class='catalog-findings-detail'>")
    $null = $html.AppendLine("<summary><strong>Detailed Checks ($($summary.MappedControls) mapped)</strong></summary>")
    $null = $html.AppendLine("<table class='cis-table catalog-findings'><thead><tr>")
    $null = $html.AppendLine("<th>Status</th><th>Check ID</th><th>Setting</th><th>Control ID</th><th>Severity</th>")
    $null = $html.AppendLine("</tr></thead><tbody>")

    foreach ($mf in $MappedFindings) {
        $finding = $mf.Finding
        $statusBadge = switch ($finding.Status) {
            'Pass'    { 'badge-success' }
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-info' }
            'Info'    { 'badge-neutral' }
            default   { 'badge-neutral' }
        }
        $severityBadge = switch ($finding.RiskSeverity) {
            'Critical' { 'badge-critical' }
            'High'     { 'badge-failed' }
            'Medium'   { 'badge-warning' }
            'Low'      { 'badge-info' }
            default    { 'badge-neutral' }
        }
        $controlDisplay = $mf.ControlId -replace ';', '; '
        $rowClass = if ($finding.Status -eq 'Pass') { 'cis-row-pass' } elseif ($finding.Status -eq 'Fail') { 'cis-row-fail' } else { '' }

        $null = $html.AppendLine("<tr class='$rowClass'>")
        $null = $html.AppendLine("<td><span class='badge $statusBadge'>$($finding.Status)</span></td>")
        $null = $html.AppendLine("<td class='cis-id'>$($finding.CheckId)</td>")
        $null = $html.AppendLine("<td>$($finding.Setting)</td>")
        $null = $html.AppendLine("<td><span class='fw-tag $fwCss'>$controlDisplay</span></td>")
        $null = $html.AppendLine("<td><span class='badge $severityBadge'>$($finding.RiskSeverity)</span></td>")
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table>")
    $null = $html.AppendLine("</details>")
    $null = $html.AppendLine("</details>")

    return $html.ToString()
}

# ---------------------------------------------------------------------------
# Private: render Standalone HTML document for a single framework catalog
# ---------------------------------------------------------------------------
function ConvertTo-CatalogStandaloneHtml {
    [CmdletBinding()]
    param(
        [hashtable]$Framework,
        [hashtable]$ScoredResult,
        [System.Collections.Generic.List[hashtable]]$MappedFindings,
        [string]$TenantName
    )

    $fwLabel = $Framework.label
    $fwCss = if ($Framework.css) { $Framework.css } else { 'fw-default' }
    $summary = $ScoredResult.Summary
    $groups = $ScoredResult.Groups
    $assessmentDate = Get-Date -Format 'yyyy-MM-dd HH:mm'

    $scoringMethodLabels = @{
        'profile-compliance'     = 'Profile Compliance'
        'control-coverage'       = 'Control Coverage'
        'maturity-level'         = 'Maturity Level'
        'severity-coverage'      = 'Severity Coverage'
        'function-coverage'      = 'Function Coverage'
        'technique-coverage'     = 'Technique Coverage'
        'requirement-compliance' = 'Requirement Compliance'
        'criteria-coverage'      = 'Criteria Coverage'
        'policy-compliance'      = 'Policy Compliance'
    }
    $scoringLabel = if ($scoringMethodLabels.ContainsKey($Framework.scoringMethod)) {
        $scoringMethodLabels[$Framework.scoringMethod]
    }
    else { $Framework.scoringMethod }

    # Get the inline body content (reuse the inline renderer's table logic)
    $passRatePct = [math]::Round($summary.PassRate * 100, 1)
    $passClass = if ($passRatePct -ge 80) { 'success' } elseif ($passRatePct -ge 60) { 'warning' } else { 'danger' }
    $coveredCount = if ($summary.CoveredControls) { $summary.CoveredControls } else { $summary.MappedControls }
    $coveragePct = if ($summary.TotalControls -gt 0) { [math]::Min(100, [math]::Round(($coveredCount / $summary.TotalControls) * 100, 0)) } else { 0 }

    $body = [System.Text.StringBuilder]::new(8192)

    # Cover / header section
    $null = $body.AppendLine("<div class='catalog-header'>")
    $null = $body.AppendLine("<h1><span class='fw-tag $fwCss' style='font-size: 0.9em; padding: 4px 12px;'>$fwLabel</span> Framework Catalog</h1>")
    $null = $body.AppendLine("<p class='catalog-meta'>Tenant: <strong>$TenantName</strong> &bull; Generated: $assessmentDate &bull; Scoring: $scoringLabel</p>")
    $null = $body.AppendLine("</div>")

    # Summary stats
    $null = $body.AppendLine("<div class='catalog-summary'>")
    $null = $body.AppendLine("<div class='catalog-stats'>")
    $null = $body.AppendLine("<span class='catalog-stat'><strong>Pass Rate:</strong> <span class='badge badge-$passClass' title='Percentage of assessed checks that returned Pass'>$passRatePct%</span></span>")
    if ($summary.TotalControls -gt 0) {
        $null = $body.AppendLine("<span class='catalog-stat' title='Distinct framework controls with at least one mapped check'><strong>Coverage:</strong> $coveredCount of $($summary.TotalControls) controls</span>")
    }
    $null = $body.AppendLine("<span class='catalog-stat' title='Automated checks mapped to this framework'><strong>Checks Assessed:</strong> $($summary.MappedControls)</span>")
    $null = $body.AppendLine("</div>")
    if ($summary.TotalControls -gt 0) {
        $null = $body.AppendLine("<div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div>")
        $null = $body.AppendLine("<div class='coverage-label'>$coveragePct% coverage</div>")
    }
    $null = $body.AppendLine("</div>")

    # Group breakdown table
    $null = $body.AppendLine("<h2>Group Breakdown</h2>")
    $null = $body.AppendLine("<table class='catalog-groups'><thead><tr>")
    $null = $body.AppendLine("<th>Group</th><th>Label</th><th>Coverage %</th><th>Automated Checks</th><th>Passed</th><th>Failed</th><th>Warning</th><th>Review</th><th>Pass Rate</th>")
    $null = $body.AppendLine("</tr></thead><tbody>")

    foreach ($group in $groups) {
        $grpPassRate = if ($group.Mapped -gt 0) { [math]::Round(($group.Passed / $group.Mapped) * 100, 1) } else { 0 }
        $grpClass = if ($group.Mapped -eq 0) { '' } elseif ($grpPassRate -ge 80) { 'success' } elseif ($grpPassRate -ge 60) { 'warning' } else { 'danger' }

        $null = $body.AppendLine("<tr>")
        $null = $body.AppendLine("<td><span class='fw-tag $fwCss'>$([System.Web.HttpUtility]::HtmlEncode([string]$group.Key))</span></td>")
        $null = $body.AppendLine("<td>$([System.Web.HttpUtility]::HtmlEncode([string]$group.Label))</td>")
        $coveragePctVal = if ($group.Total -gt 0) { [math]::Round(($group.Covered / $group.Total) * 100, 0) } else { 0 }
        $coverageDisplay = if ($group.Total -gt 0) { "<span title='$($group.Covered) of $($group.Total) controls'>$coveragePctVal%</span>" } else { "$($group.Covered)" }
        $null = $body.AppendLine("<td>$coverageDisplay</td>")
        $null = $body.AppendLine("<td>$($group.Mapped)</td>")
        $null = $body.AppendLine("<td>$($group.Passed)</td>")
        $null = $body.AppendLine("<td>$($group.Failed)</td>")
        $null = $body.AppendLine("<td>$($group.Warning)</td>")
        $null = $body.AppendLine("<td>$($group.Review)</td>")
        $passDisplay = if ($group.Mapped -gt 0) { "$grpPassRate%" } else { '&mdash;' }
        $badgeCss = switch ($grpClass) { 'success' { 'badge-success' } 'warning' { 'badge-warning' } 'danger' { 'badge-failed' } default { 'badge-neutral' } }
        $null = $body.AppendLine("<td><span class='badge $badgeCss'>$passDisplay</span></td>")
        $null = $body.AppendLine("</tr>")
    }
    $null = $body.AppendLine("</tbody></table>")

    # Findings detail table
    if ($MappedFindings.Count -gt 0) {
        $null = $body.AppendLine("<h2>Detailed Checks ($($summary.MappedControls) mapped)</h2>")
        $null = $body.AppendLine("<table class='cis-table catalog-findings'><thead><tr>")
        $null = $body.AppendLine("<th>Status</th><th>Check ID</th><th>Setting</th><th>Control ID</th><th>Severity</th>")
        $null = $body.AppendLine("</tr></thead><tbody>")

        foreach ($mf in $MappedFindings) {
            $finding = $mf.Finding
            $statusBadge = switch ($finding.Status) {
                'Pass'    { 'badge-success' }
                'Fail'    { 'badge-failed' }
                'Warning' { 'badge-warning' }
                'Review'  { 'badge-info' }
                'Info'    { 'badge-neutral' }
                default   { 'badge-neutral' }
            }
            $severityBadge = switch ($finding.RiskSeverity) {
                'Critical' { 'badge-critical' }
                'High'     { 'badge-failed' }
                'Medium'   { 'badge-warning' }
                'Low'      { 'badge-info' }
                default    { 'badge-neutral' }
            }
            $controlDisplay = $mf.ControlId -replace ';', '; '
            $rowClass = if ($finding.Status -eq 'Pass') { 'cis-row-pass' } elseif ($finding.Status -eq 'Fail') { 'cis-row-fail' } else { '' }

            $null = $body.AppendLine("<tr class='$rowClass'>")
            $null = $body.AppendLine("<td><span class='badge $statusBadge'>$($finding.Status)</span></td>")
            $null = $body.AppendLine("<td class='cis-id'>$($finding.CheckId)</td>")
            $null = $body.AppendLine("<td>$($finding.Setting)</td>")
            $null = $body.AppendLine("<td><span class='fw-tag $fwCss'>$controlDisplay</span></td>")
            $null = $body.AppendLine("<td><span class='badge $severityBadge'>$($finding.RiskSeverity)</span></td>")
            $null = $body.AppendLine("</tr>")
        }
        $null = $body.AppendLine("</tbody></table>")
    }
    else {
        $null = $body.AppendLine("<p class='catalog-empty'>No assessed findings map to this framework.</p>")
    }

    $bodyContent = $body.ToString()

    # Assemble full HTML document with embedded CSS
    return @"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$fwLabel Catalog - $TenantName</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --m365a-primary: #2563EB;
            --m365a-dark-primary: #1D4ED8;
            --m365a-accent: #60A5FA;
            --m365a-dark: #0F172A;
            --m365a-dark-gray: #1E293B;
            --m365a-medium-gray: #64748B;
            --m365a-light-gray: #F1F5F9;
            --m365a-border: #CBD5E1;
            --m365a-white: #ffffff;
            --m365a-success: #2ecc71;
            --m365a-warning: #f39c12;
            --m365a-danger: #e74c3c;
            --m365a-info: #3498db;
            --m365a-success-bg: #d4edda;
            --m365a-warning-bg: #fff3cd;
            --m365a-danger-bg: #f8d7da;
            --m365a-info-bg: #d1ecf1;
            --m365a-neutral: #6b7280;
            --m365a-neutral-bg: #f3f4f6;
            --m365a-body-bg: #ffffff;
            --m365a-text: #1E293B;
            --m365a-card-bg: #ffffff;
            --m365a-hover-bg: #e8f4f8;
        }
        body.dark-theme {
            --m365a-primary: #60A5FA;
            --m365a-dark-primary: #93C5FD;
            --m365a-accent: #3B82F6;
            --m365a-dark: #F1F5F9;
            --m365a-dark-gray: #E2E8F0;
            --m365a-medium-gray: #94A3B8;
            --m365a-light-gray: #1E293B;
            --m365a-border: #334155;
            --m365a-white: #0F172A;
            --m365a-body-bg: #0F172A;
            --m365a-text: #E2E8F0;
            --m365a-card-bg: #1E293B;
            --m365a-hover-bg: #1E3A5F;
            --m365a-success: #34D399;
            --m365a-warning: #FBBF24;
            --m365a-danger: #F87171;
            --m365a-info: #60A5FA;
            --m365a-success-bg: #064E3B;
            --m365a-warning-bg: #78350F;
            --m365a-danger-bg: #7F1D1D;
            --m365a-info-bg: #1E3A5F;
            --m365a-neutral: #9ca3af;
            --m365a-neutral-bg: #374151;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 13pt;
            line-height: 1.5;
            color: var(--m365a-text);
            background: var(--m365a-body-bg);
            padding: 40px;
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 { font-size: 1.8em; margin-bottom: 8px; color: var(--m365a-dark); }
        h2 { font-size: 1.3em; margin: 24px 0 12px; color: var(--m365a-dark); border-bottom: 2px solid var(--m365a-primary); padding-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10pt; }
        th { background: var(--m365a-dark); color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 9pt; }
        td { padding: 8px 12px; border-bottom: 1px solid var(--m365a-border); vertical-align: top; }
        tr:nth-child(even) { background: var(--m365a-light-gray); }
        tr:hover { background: var(--m365a-hover-bg); }
        .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 8.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .badge-success { background: var(--m365a-success-bg); color: #155724; }
        .badge-failed { background: var(--m365a-danger-bg); color: #721c24; }
        .badge-warning { background: var(--m365a-warning-bg); color: #856404; }
        .badge-info { background: var(--m365a-info-bg); color: #0c5460; }
        .badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
        .badge-critical { background: #991b1b; color: #fef2f2; }
        .fw-tag { display: inline-block; padding: 1px 5px; margin: 1px; border-radius: 3px; font-size: 0.72em; font-family: 'Consolas', 'Courier New', monospace; }
        .fw-cis    { background: #e8f0fe; color: #1a56db; }
        .fw-cis-l2 { background: #dbeafe; color: #1e40af; }
        .fw-nist   { background: #e8f0fe; color: #1a56db; }
        .fw-nist-high { background: #dbeafe; color: #1e40af; }
        .fw-nist-privacy { background: #ede9fe; color: #5b21b6; }
        .fw-csf   { background: #fef3c7; color: #92400e; }
        .fw-iso   { background: #ecfdf5; color: #065f46; }
        .fw-stig  { background: #f3e8ff; color: #6b21a8; }
        .fw-pci   { background: #fef2f2; color: #991b1b; }
        .fw-cmmc  { background: #f0fdfa; color: #134e4a; }
        .fw-hipaa { background: #fdf2f8; color: #9d174d; }
        .fw-scuba { background: #fff7ed; color: #9a3412; }
        .fw-soc2  { background: #eff6ff; color: #1e3a5f; }
        .fw-fedramp { background: #fef3c7; color: #78350f; }
        .fw-essential8 { background: #ecfdf5; color: #14532d; }
        .fw-mitre { background: #fef2f2; color: #7f1d1d; }
        .fw-cisv8 { background: #e0f2fe; color: #0c4a6e; }
        .fw-default { background: #e2e8f0; color: #334155; }
        .cis-id { font-family: 'Consolas', 'Courier New', monospace; font-size: 0.9em; white-space: nowrap; }
        .cis-row-pass { border-left: 3px solid var(--m365a-success); background-color: var(--m365a-success-bg); }
        .cis-row-fail { border-left: 3px solid var(--m365a-danger); background-color: var(--m365a-danger-bg); }
        .cis-row-pass:nth-child(even), .cis-row-fail:nth-child(even) { background-image: linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06)); }
        .coverage-bar { margin-top: 6px; background: var(--m365a-border); border-radius: 4px; height: 6px; overflow: hidden; }
        .coverage-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .catalog-summary .coverage-fill { background: var(--m365a-primary); }
        .coverage-label { font-size: 0.65em; color: var(--m365a-medium-gray); margin-top: 2px; }
        .catalog-header { margin-bottom: 24px; }
        .catalog-meta { font-size: 0.85em; color: var(--m365a-medium-gray); }
        .catalog-summary { margin-bottom: 20px; padding: 16px; background: var(--m365a-card-bg); border: 1px solid var(--m365a-border); border-radius: 6px; }
        .catalog-stats { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 4px; }
        .catalog-stat { font-size: 0.9em; }
        .catalog-empty { color: var(--m365a-medium-gray); font-style: italic; padding: 20px; }
        .theme-toggle { position: fixed; top: 16px; right: 16px; background: var(--m365a-card-bg); border: 1px solid var(--m365a-border); border-radius: 50%; width: 36px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; z-index: 100; }
        .theme-toggle:hover { transform: scale(1.1); }
        body:not(.dark-theme) .theme-icon-dark { display: none; }
        body.dark-theme .theme-icon-light { display: none; }
        body.dark-theme th { background: #1E3A5F; color: #E2E8F0; }
        body.dark-theme .badge-success { background: #065F46; color: #6EE7B7; }
        body.dark-theme .badge-failed { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .badge-warning { background: #78350F; color: #FCD34D; }
        body.dark-theme .badge-info { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
        body.dark-theme .fw-cis    { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-cis-l2 { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist   { background: #1E3A5F; color: #93C5FD; }
        body.dark-theme .fw-nist-high { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-nist-privacy { background: #2E1065; color: #C4B5FD; }
        body.dark-theme .fw-csf    { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-iso    { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-stig   { background: #3B0764; color: #C4B5FD; }
        body.dark-theme .fw-pci    { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cmmc   { background: #134E4A; color: #5EEAD4; }
        body.dark-theme .fw-hipaa  { background: #831843; color: #F9A8D4; }
        body.dark-theme .fw-scuba  { background: #7C2D12; color: #FDBA74; }
        body.dark-theme .fw-soc2   { background: #1E3A5F; color: #60A5FA; }
        body.dark-theme .fw-fedramp { background: #78350F; color: #FCD34D; }
        body.dark-theme .fw-essential8 { background: #064E3B; color: #6EE7B7; }
        body.dark-theme .fw-mitre  { background: #7F1D1D; color: #FCA5A5; }
        body.dark-theme .fw-cisv8  { background: #164E63; color: #67E8F9; }
        body.dark-theme .fw-default { background: #334155; color: #94A3B8; }
        @media print { .theme-toggle { display: none; } body { padding: 20px; } }
    </style>
</head>
<body>
    <button class="theme-toggle" onclick="document.body.classList.toggle('dark-theme')" title="Toggle dark theme">
        <span class="theme-icon-light">&#9790;</span>
        <span class="theme-icon-dark">&#9788;</span>
    </button>
    $bodyContent
    <footer style="margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--m365a-border); font-size: 0.75em; color: var(--m365a-medium-gray);">
        Generated by M365-Assess Framework Catalog Engine
    </footer>
</body>
</html>
"@
}

# ---------------------------------------------------------------------------
# Private helper: build a group hashtable from a bucket of findings
# ---------------------------------------------------------------------------
function Build-ScoringGroup {
    [CmdletBinding()]
    param(
        [string]$Key,
        [string]$Label,
        [int]$Total,
        [System.Collections.Generic.List[PSCustomObject]]$GroupFindings,
        [int]$Covered = -1
    )

    $scored = @($GroupFindings | Where-Object { $_.Status -ne 'Info' } |
        Select-Object -Property CheckId -Unique)
    $passed = @($GroupFindings | Where-Object { $_.Status -eq 'Pass' } |
        Select-Object -Property CheckId -Unique)
    $failed = @($GroupFindings | Where-Object { $_.Status -eq 'Fail' } |
        Select-Object -Property CheckId -Unique)
    $warning = @($GroupFindings | Where-Object { $_.Status -eq 'Warning' } |
        Select-Object -Property CheckId -Unique)
    $review = @($GroupFindings | Where-Object { $_.Status -eq 'Review' } |
        Select-Object -Property CheckId -Unique)
    $other = $scored.Count - $passed.Count - $failed.Count - $warning.Count - $review.Count
    if ($other -lt 0) { $other = 0 }

    # Covered = unique framework controls with findings (if tracked by scorer)
    # Falls back to Mapped when scorer doesn't track coverage
    $coveredCount = if ($Covered -ge 0) { $Covered } else { $scored.Count }

    @{
        Key      = $Key
        Label    = $Label
        Total    = $Total
        Mapped   = $scored.Count
        Covered  = $coveredCount
        Passed   = $passed.Count
        Failed   = $failed.Count
        Warning  = $warning.Count
        Review   = $review.Count
        Other    = $other
        Findings = @($GroupFindings)
    }
}

# ---------------------------------------------------------------------------
# Private helper: resolve the scoring data sub-object by trying common keys
# ---------------------------------------------------------------------------
function Get-ScoringSubObject {
    [CmdletBinding()]
    param(
        [hashtable]$Framework,
        [string]$Key
    )

    $sd = $Framework.scoringData
    if (-not $sd) { return $null }

    # scoringData is a hashtable; try direct key lookup
    if ($sd -is [hashtable] -and $sd.ContainsKey($Key)) {
        $val = $sd[$Key]
    }
    elseif ($sd.PSObject -and $sd.PSObject.Properties.Name -contains $Key) {
        $val = $sd.$Key
    }
    else {
        return $null
    }

    # Convert PSCustomObject to hashtable for consistent .Keys usage
    if ($val -is [System.Management.Automation.PSCustomObject]) {
        $ht = @{}
        foreach ($prop in $val.PSObject.Properties) {
            $ht[$prop.Name] = $prop.Value
        }
        return $ht
    }
    return $val
}

# ---------------------------------------------------------------------------
# Private helper: generate a sortable key for group ordering
# Handles: numeric (1,2,3), alpha-numeric (L1,L2,ML1,GV,ID,PR), Roman (CAT-I,CAT-II)
# ---------------------------------------------------------------------------
function Get-GroupSortKey {
    [CmdletBinding()]
    param([string]$Key)

    # Roman numeral suffix (CAT-I, CAT-II, CAT-III)
    $romanMap = @{ 'I' = 1; 'II' = 2; 'III' = 3; 'IV' = 4; 'V' = 5 }
    if ($Key -match '-([IV]+)$') {
        $prefix = $Key -replace '-[IV]+$', ''
        $romanVal = if ($romanMap.ContainsKey($Matches[1])) { $romanMap[$Matches[1]] } else { 99 }
        return '{0}-{1:D3}' -f $prefix, $romanVal
    }

    # Alpha prefix + numeric suffix (L1, L2, ML1, ML2, IG1, IG2)
    if ($Key -match '^([A-Za-z]+)(\d+)$') {
        return '{0}{1:D3}' -f $Matches[1], [int]$Matches[2]
    }

    # Pure numeric (5, 6, 7, 8)
    if ($Key -match '^\d+$') {
        return '{0:D5}' -f [int]$Key
    }

    # CSF function order (canonical: GV=1, ID=2, PR=3, DE=4, RS=5, RC=6)
    $csfOrder = @{ 'GV' = 1; 'ID' = 2; 'PR' = 3; 'DE' = 4; 'RS' = 5; 'RC' = 6 }
    if ($csfOrder.ContainsKey($Key)) {
        return '{0:D3}' -f $csfOrder[$Key]
    }

    # Fallback: alphabetic
    return $Key
}

# ---------------------------------------------------------------------------
# 1. profile-compliance
# ---------------------------------------------------------------------------
function Invoke-ProfileCompliance {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $profileDefs = $Framework.profiles
    if (-not $profileDefs -or $profileDefs.Count -eq 0) {
        # Fallback: try scoringData.profiles
        $profileDefs = Get-ScoringSubObject -Framework $Framework -Key 'profiles'
    }
    if (-not $profileDefs -or $profileDefs.Count -eq 0) {
        return @(Build-ScoringGroup -Key 'All' -Label 'All Controls' -Total ([int]$Framework.totalControls) -GroupFindings ([System.Collections.Generic.List[PSCustomObject]]::new()))
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($profileKey in $profileDefs.Keys) {
        $profileInfo = $profileDefs[$profileKey]
        $label = if ($profileInfo -is [hashtable] -and $profileInfo.ContainsKey('label')) { $profileInfo.label } else { $profileKey }
        $controlCount = if ($profileInfo -is [hashtable] -and $profileInfo.ContainsKey('controlCount')) { [int]$profileInfo.controlCount } else { 0 }

        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredControlIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($mf in $MappedFindings) {
            # If finding has profiles array, check membership; otherwise include in all profiles
            $inProfile = $false
            if ($mf.Profiles -and $mf.Profiles.Count -gt 0) {
                if ($profileKey -in $mf.Profiles) { $inProfile = $true }
            }
            else {
                $inProfile = $true
            }

            if ($inProfile) {
                $bucket.Add($mf.Finding)
                # Track unique framework controlIds (e.g. CIS "1.1.1") not CheckIds
                # to avoid inflating coverage when multiple checks map to same control
                if ($mf.ControlId) {
                    foreach ($cid in ($mf.ControlId -split ';')) {
                        [void]$coveredControlIds.Add($cid.Trim())
                    }
                }
            }
        }

        $groups.Add((Build-ScoringGroup -Key $profileKey -Label $label -Total $controlCount -GroupFindings $bucket -Covered $coveredControlIds.Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 2. function-coverage (NIST CSF)
# ---------------------------------------------------------------------------
function Invoke-FunctionCoverage {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $functions = Get-ScoringSubObject -Framework $Framework -Key 'functions'
    if (-not $functions) {
        return @(Build-ScoringGroup -Key 'All' -Label 'All Functions' -Total ([int]$Framework.totalControls) -GroupFindings ([System.Collections.Generic.List[PSCustomObject]]::new()))
    }

    # Build buckets keyed by function code + track unique controlIds per group
    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $functions.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            if ($trimmed -match '^([A-Z]{2})\.') {
                $funcKey = $Matches[1]
                if ($buckets.ContainsKey($funcKey)) {
                    $buckets[$funcKey].Add($mf.Finding)
                    [void]$coveredIds[$funcKey].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $functions.Keys) {
        $funcInfo = $functions[$key]
        $label = if ($funcInfo.label) { $funcInfo.label } else { $key }
        $total = if ($funcInfo.subcategories) { [int]$funcInfo.subcategories } else { 0 }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 3. control-coverage (ISO 27001)
# ---------------------------------------------------------------------------
function Invoke-ControlCoverage {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $themes = Get-ScoringSubObject -Framework $Framework -Key 'themes'
    if (-not $themes) {
        # Generic fallback: single group
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Controls' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $themes.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            # Pattern: A.{clause}.{control} -- extract clause number at index 1
            $segments = $trimmed -split '\.'
            if ($segments.Count -ge 2) {
                $clauseKey = $segments[1]
                if ($buckets.ContainsKey($clauseKey)) {
                    $buckets[$clauseKey].Add($mf.Finding)
                    [void]$coveredIds[$clauseKey].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $themes.Keys) {
        $themeInfo = $themes[$key]
        $label = if ($themeInfo.label) { $themeInfo.label } else { $key }
        $total = if ($themeInfo.controlCount) { [int]$themeInfo.controlCount } else { 0 }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 4. technique-coverage (MITRE ATT&CK)
# ---------------------------------------------------------------------------
function Invoke-TechniqueCoverage {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $tactics = Get-ScoringSubObject -Framework $Framework -Key 'tactics'

    # Load technique-to-tactic map
    $mapPath = Join-Path -Path $PSScriptRoot -ChildPath '../controls/mitre-technique-map.json'
    $techMap = @{}
    if (Test-Path -Path $mapPath) {
        $mapRaw = Get-Content -Path $mapPath -Raw | ConvertFrom-Json
        if ($mapRaw.map) {
            foreach ($prop in $mapRaw.map.PSObject.Properties) {
                $techMap[$prop.Name] = $prop.Value
            }
        }
    }
    else {
        Write-Warning "MITRE technique map not found at: $mapPath"
    }

    if (-not $tactics) {
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Techniques' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $tactics.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }
    $buckets['Unmapped'] = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            if ($techMap.ContainsKey($trimmed)) {
                $tacticCode = $techMap[$trimmed]
                if ($buckets.ContainsKey($tacticCode)) {
                    $buckets[$tacticCode].Add($mf.Finding)
                    [void]$coveredIds[$tacticCode].Add($trimmed)
                }
                else {
                    $buckets['Unmapped'].Add($mf.Finding)
                }
            }
            else {
                $buckets['Unmapped'].Add($mf.Finding)
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $tactics.Keys) {
        $tacticInfo = $tactics[$key]
        $label = if ($tacticInfo.label) { $tacticInfo.label } else { $key }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }

    # Add Unmapped group only if it has findings
    if ($buckets['Unmapped'].Count -gt 0) {
        $groups.Add((Build-ScoringGroup -Key 'Unmapped' -Label 'Unmapped Techniques' -Total 0 -GroupFindings $buckets['Unmapped']))
    }

    return @($groups)
}

# ---------------------------------------------------------------------------
# 5. maturity-level (Essential Eight, CMMC)
# ---------------------------------------------------------------------------
function Invoke-MaturityLevel {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $levels = Get-ScoringSubObject -Framework $Framework -Key 'maturityLevels'
    if (-not $levels) {
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Levels' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $fwId = $Framework.frameworkId
    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $levels.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    if ($fwId -eq 'essential-eight') {
        foreach ($mf in $MappedFindings) {
            $parts = $mf.ControlId -split ';'
            foreach ($part in $parts) {
                $trimmed = $part.Trim()
                $levelKey = ($trimmed -split '-')[0]
                if ($buckets.ContainsKey($levelKey)) {
                    $buckets[$levelKey].Add($mf.Finding)
                    [void]$coveredIds[$levelKey].Add($trimmed)
                }
            }
        }
    }
    elseif ($fwId -eq 'cmmc') {
        # Cumulative upward: finding goes in its minimum level bucket and all higher buckets.
        # Level is encoded in the controlId (e.g. AC.L1-, ACL2.-, RA.L3-).
        # L3 compliance requires meeting L1+L2+L3, so a finding at minimum L1 appears in all.
        foreach ($mf in $MappedFindings) {
            $minLevelNum = 3  # default to L3 if no level marker found
            $parts = $mf.ControlId -split ';'
            foreach ($part in $parts) {
                if ($part -match 'L([123])') {
                    $lvl = [int]$Matches[1]
                    if ($lvl -lt $minLevelNum) { $minLevelNum = $lvl }
                }
            }
            foreach ($key in $levels.Keys) {
                if ($key -match 'L(\d+)' -and [int]$Matches[1] -ge $minLevelNum) {
                    $buckets[$key].Add($mf.Finding)
                    foreach ($part in $parts) { [void]$coveredIds[$key].Add($part.Trim()) }
                }
            }
        }
    }
    else {
        foreach ($mf in $MappedFindings) {
            $parts = $mf.ControlId -split ';'
            foreach ($part in $parts) {
                $trimmed = $part.Trim()
                $levelKey = ($trimmed -split '-')[0]
                if ($buckets.ContainsKey($levelKey)) {
                    $buckets[$levelKey].Add($mf.Finding)
                    [void]$coveredIds[$levelKey].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $levels.Keys) {
        $levelInfo = $levels[$key]
        $label = if ($levelInfo.label) { $levelInfo.label } else { $key }
        $total = if ($levelInfo.practiceCount) { [int]$levelInfo.practiceCount } else { 0 }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 6. severity-coverage (STIG)
# ---------------------------------------------------------------------------
function Invoke-SeverityCoverage {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $categories = Get-ScoringSubObject -Framework $Framework -Key 'categories'
    if (-not $categories -or $categories.Count -eq 0) {
        # Single "All" group
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Findings' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    # STIG V-numbers don't encode severity category, so distribute to all categories
    $buckets = @{}
    foreach ($key in $categories.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) {
            $buckets[$key].Add($mf.Finding)
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $categories.Keys) {
        $catInfo = $categories[$key]
        $label = if ($catInfo.label) { $catInfo.label } else { $key }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 7. requirement-compliance (PCI DSS)
# ---------------------------------------------------------------------------
function Invoke-RequirementCompliance {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $requirements = Get-ScoringSubObject -Framework $Framework -Key 'requirements'
    if (-not $requirements) {
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Requirements' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $requirements.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            $segments = $trimmed -split '\.'
            if ($segments.Count -ge 1) {
                $reqKey = $segments[0]
                if ($buckets.ContainsKey($reqKey)) {
                    $buckets[$reqKey].Add($mf.Finding)
                    [void]$coveredIds[$reqKey].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $requirements.Keys) {
        $reqInfo = $requirements[$key]
        $label = if ($reqInfo.label) { $reqInfo.label } else { "Requirement $key" }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 8. criteria-coverage (SOC 2, HIPAA)
# ---------------------------------------------------------------------------
function Invoke-CriteriaCoverage {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $criteria = Get-ScoringSubObject -Framework $Framework -Key 'criteria'
    if (-not $criteria) {
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Criteria' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $fwId = $Framework.frameworkId
    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $criteria.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()

            if ($fwId -eq 'soc2') {
                if ($buckets.ContainsKey($trimmed)) {
                    $buckets[$trimmed].Add($mf.Finding)
                    [void]$coveredIds[$trimmed].Add($trimmed)
                }
                else {
                    foreach ($cKey in $criteria.Keys) {
                        if ($trimmed.StartsWith($cKey) -or $cKey.StartsWith($trimmed)) {
                            $buckets[$cKey].Add($mf.Finding)
                            [void]$coveredIds[$cKey].Add($trimmed)
                        }
                    }
                }
            }
            elseif ($fwId -eq 'hipaa') {
                $section = ($trimmed -split '\(')[0]
                if ($buckets.ContainsKey($section)) {
                    $buckets[$section].Add($mf.Finding)
                    [void]$coveredIds[$section].Add($trimmed)
                }
            }
            else {
                if ($buckets.ContainsKey($trimmed)) {
                    $buckets[$trimmed].Add($mf.Finding)
                    [void]$coveredIds[$trimmed].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $criteria.Keys) {
        $critInfo = $criteria[$key]
        $label = if ($critInfo.label) { $critInfo.label } else { $key }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}

# ---------------------------------------------------------------------------
# 9. policy-compliance (CISA SCuBA)
# ---------------------------------------------------------------------------
function Invoke-PolicyCompliance {
    [CmdletBinding()]
    param([hashtable]$Framework, [System.Collections.Generic.List[hashtable]]$MappedFindings)

    $products = Get-ScoringSubObject -Framework $Framework -Key 'products'
    if (-not $products) {
        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) { $bucket.Add($mf.Finding) }
        return @(Build-ScoringGroup -Key 'All' -Label 'All Products' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    $coveredIds = @{}
    foreach ($key in $products.Keys) {
        $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new()
        $coveredIds[$key] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            $segments = $trimmed -split '\.'
            if ($segments.Count -ge 2) {
                $productKey = $segments[1]
                if ($buckets.ContainsKey($productKey)) {
                    $buckets[$productKey].Add($mf.Finding)
                    [void]$coveredIds[$productKey].Add($trimmed)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $products.Keys) {
        $prodInfo = $products[$key]
        $label = if ($prodInfo.label) { $prodInfo.label } else { $key }
        $groups.Add((Build-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key] -Covered $coveredIds[$key].Count))
    }
    return @($groups)
}
