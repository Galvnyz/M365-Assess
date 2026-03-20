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

    if ($Mode -eq 'Standalone') {
        return '<!-- Standalone mode not yet implemented -->'
    }

    # --- Common: resolve framework mappings and score ---
    $scoredResult = Invoke-FrameworkScoring -Findings $Findings -Framework $Framework -ControlRegistry $ControlRegistry

    if ($Mode -eq 'Grouped') {
        return $scoredResult
    }

    # --- Inline mode: render HTML fragment ---
    return ConvertTo-CatalogInlineHtml -Framework $Framework -ScoredResult $scoredResult -MappedFindings $scoredResult.MappedFindings
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

    # Build summary
    $totalMapped = ($mappedFindings | ForEach-Object { $_.Finding.CheckId } | Select-Object -Unique).Count
    $totalPassed = ($mappedFindings | Where-Object { $_.Finding.Status -eq 'Pass' } |
        ForEach-Object { $_.Finding.CheckId } | Select-Object -Unique).Count
    $passRate = if ($totalMapped -gt 0) { [math]::Round($totalPassed / $totalMapped, 2) } else { 0 }

    return @{
        Groups         = @($groups)
        Summary        = @{
            TotalControls  = [int]$Framework.totalControls
            MappedControls = $totalMapped
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
    $coveragePct = if ($summary.TotalControls -gt 0) { [math]::Min(100, [math]::Round(($summary.MappedControls / $summary.TotalControls) * 100, 0)) } else { 0 }

    $null = $html.AppendLine("<div class='catalog-summary'>")
    $null = $html.AppendLine("<div class='catalog-stats'>")
    $null = $html.AppendLine("<span class='catalog-stat'><strong>Pass Rate:</strong> <span class='badge badge-$passClass'>$passRatePct%</span></span>")
    $null = $html.AppendLine("<span class='catalog-stat'><strong>Mapped:</strong> $($summary.MappedControls) of $($summary.TotalControls) controls</span>")
    $null = $html.AppendLine("<span class='catalog-stat'><strong>Scoring:</strong> $($Framework.scoringMethod)</span>")
    $null = $html.AppendLine("</div>")
    if ($summary.TotalControls -gt 0) {
        $null = $html.AppendLine("<div class='coverage-bar'><div class='coverage-fill' style='width: $coveragePct%'></div></div>")
        $null = $html.AppendLine("<div class='coverage-label'>$coveragePct% coverage</div>")
    }
    $null = $html.AppendLine("</div>")

    # Group breakdown table
    $null = $html.AppendLine("<table class='catalog-groups'><thead><tr>")
    $null = $html.AppendLine("<th>Group</th><th>Label</th><th>Mapped</th><th>Passed</th><th>Failed</th><th>Other</th><th>Pass Rate</th>")
    $null = $html.AppendLine("</tr></thead><tbody>")

    foreach ($group in $groups) {
        $grpPassRate = if ($group.Mapped -gt 0) { [math]::Round(($group.Passed / $group.Mapped) * 100, 1) } else { 0 }
        $grpClass = if ($group.Mapped -eq 0) { '' } elseif ($grpPassRate -ge 80) { 'success' } elseif ($grpPassRate -ge 60) { 'warning' } else { 'danger' }

        $null = $html.AppendLine("<tr>")
        $null = $html.AppendLine("<td><span class='fw-tag $fwCss'>$($group.Key)</span></td>")
        $null = $html.AppendLine("<td>$($group.Label)</td>")
        $totalDisplay = if ($group.Total -gt 0) { "$($group.Mapped)/$($group.Total)" } else { "$($group.Mapped)" }
        $null = $html.AppendLine("<td>$totalDisplay</td>")
        $null = $html.AppendLine("<td>$($group.Passed)</td>")
        $null = $html.AppendLine("<td>$($group.Failed)</td>")
        $null = $html.AppendLine("<td>$($group.Other)</td>")
        $passDisplay = if ($group.Mapped -gt 0) { "$grpPassRate%" } else { '&mdash;' }
        $badgeCss = switch ($grpClass) { 'success' { 'badge-success' } 'warning' { 'badge-warning' } 'danger' { 'badge-failed' } default { 'badge-neutral' } }
        $null = $html.AppendLine("<td><span class='badge $badgeCss'>$passDisplay</span></td>")
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table>")

    # Findings detail table (collapsible)
    $null = $html.AppendLine("<details class='catalog-findings-detail'>")
    $null = $html.AppendLine("<summary><strong>Detailed Findings ($($summary.MappedControls) mapped)</strong></summary>")
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
# Private helper: build a group hashtable from a bucket of findings
# ---------------------------------------------------------------------------
function New-ScoringGroup {
    [CmdletBinding()]
    param(
        [string]$Key,
        [string]$Label,
        [int]$Total,
        [System.Collections.Generic.List[PSCustomObject]]$GroupFindings
    )

    $unique = @($GroupFindings | Select-Object -Property CheckId -Unique)
    $passed = @($GroupFindings | Where-Object { $_.Status -eq 'Pass' } |
        Select-Object -Property CheckId -Unique)
    $failed = @($GroupFindings | Where-Object { $_.Status -eq 'Fail' } |
        Select-Object -Property CheckId -Unique)
    $other = $unique.Count - $passed.Count - $failed.Count
    if ($other -lt 0) { $other = 0 }

    @{
        Key      = $Key
        Label    = $Label
        Total    = $Total
        Mapped   = $unique.Count
        Passed   = $passed.Count
        Failed   = $failed.Count
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Controls' -Total ([int]$Framework.totalControls) -GroupFindings ([System.Collections.Generic.List[PSCustomObject]]::new()))
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($profileKey in $profileDefs.Keys) {
        $profileInfo = $profileDefs[$profileKey]
        $label = if ($profileInfo -is [hashtable] -and $profileInfo.ContainsKey('label')) { $profileInfo.label } else { $profileKey }
        $controlCount = if ($profileInfo -is [hashtable] -and $profileInfo.ContainsKey('controlCount')) { [int]$profileInfo.controlCount } else { 0 }

        $bucket = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($mf in $MappedFindings) {
            # If finding has profiles array, check membership; otherwise include in all profiles
            if ($mf.Profiles -and $mf.Profiles.Count -gt 0) {
                if ($profileKey -in $mf.Profiles) {
                    $bucket.Add($mf.Finding)
                }
            }
            else {
                $bucket.Add($mf.Finding)
            }
        }

        $groups.Add((New-ScoringGroup -Key $profileKey -Label $label -Total $controlCount -GroupFindings $bucket))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Functions' -Total ([int]$Framework.totalControls) -GroupFindings ([System.Collections.Generic.List[PSCustomObject]]::new()))
    }

    # Build buckets keyed by function code
    $buckets = @{}
    foreach ($key in $functions.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            if ($trimmed -match '^([A-Z]{2})\.') {
                $funcKey = $Matches[1]
                if ($buckets.ContainsKey($funcKey)) {
                    $buckets[$funcKey].Add($mf.Finding)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $functions.Keys) {
        $funcInfo = $functions[$key]
        $label = if ($funcInfo.label) { $funcInfo.label } else { $key }
        $total = if ($funcInfo.subcategories) { [int]$funcInfo.subcategories } else { 0 }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Controls' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    foreach ($key in $themes.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

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
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $themes.Keys) {
        $themeInfo = $themes[$key]
        $label = if ($themeInfo.label) { $themeInfo.label } else { $key }
        $total = if ($themeInfo.controlCount) { [int]$themeInfo.controlCount } else { 0 }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Techniques' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    foreach ($key in $tactics.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }
    $buckets['Unmapped'] = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            if ($techMap.ContainsKey($trimmed)) {
                $tacticCode = $techMap[$trimmed]
                if ($buckets.ContainsKey($tacticCode)) {
                    $buckets[$tacticCode].Add($mf.Finding)
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
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
    }

    # Add Unmapped group only if it has findings
    if ($buckets['Unmapped'].Count -gt 0) {
        $groups.Add((New-ScoringGroup -Key 'Unmapped' -Label 'Unmapped Techniques' -Total 0 -GroupFindings $buckets['Unmapped']))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Levels' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $fwId = $Framework.frameworkId
    $buckets = @{}
    foreach ($key in $levels.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

    if ($fwId -eq 'essential-eight') {
        # ControlIds look like ML1-P4;ML2-P4;ML3-P4 -- take prefix before '-'
        foreach ($mf in $MappedFindings) {
            $parts = $mf.ControlId -split ';'
            foreach ($part in $parts) {
                $trimmed = $part.Trim()
                $levelKey = ($trimmed -split '-')[0]
                if ($buckets.ContainsKey($levelKey)) {
                    $buckets[$levelKey].Add($mf.Finding)
                }
            }
        }
    }
    elseif ($fwId -eq 'cmmc') {
        # CMMC controlIds are NIST 800-171 practice numbers like 3.1.5;3.1.6
        # Show cumulative coverage per level's practiceCount denominator
        # All mapped findings count toward each level (cumulative)
        foreach ($key in $levels.Keys) {
            foreach ($mf in $MappedFindings) {
                $buckets[$key].Add($mf.Finding)
            }
        }
    }
    else {
        # Generic maturity-level: try prefix before '-'
        foreach ($mf in $MappedFindings) {
            $parts = $mf.ControlId -split ';'
            foreach ($part in $parts) {
                $trimmed = $part.Trim()
                $levelKey = ($trimmed -split '-')[0]
                if ($buckets.ContainsKey($levelKey)) {
                    $buckets[$levelKey].Add($mf.Finding)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $levels.Keys) {
        $levelInfo = $levels[$key]
        $label = if ($levelInfo.label) { $levelInfo.label } else { $key }
        $total = if ($levelInfo.practiceCount) { [int]$levelInfo.practiceCount } else { 0 }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total $total -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Findings' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
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
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Requirements' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    foreach ($key in $requirements.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            # Pattern: {req}.{sub}.x -- take first segment before '.'
            $segments = $trimmed -split '\.'
            if ($segments.Count -ge 1) {
                $reqKey = $segments[0]
                if ($buckets.ContainsKey($reqKey)) {
                    $buckets[$reqKey].Add($mf.Finding)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $requirements.Keys) {
        $reqInfo = $requirements[$key]
        $label = if ($reqInfo.label) { $reqInfo.label } else { "Requirement $key" }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Criteria' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $fwId = $Framework.frameworkId
    $buckets = @{}
    foreach ($key in $criteria.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()

            if ($fwId -eq 'soc2') {
                # Exact match against criteria keys (CC6.1, CC6.2, etc.)
                if ($buckets.ContainsKey($trimmed)) {
                    $buckets[$trimmed].Add($mf.Finding)
                }
                else {
                    # Try matching by prefix (e.g., CC5 matches CC5)
                    foreach ($cKey in $criteria.Keys) {
                        if ($trimmed.StartsWith($cKey) -or $cKey.StartsWith($trimmed)) {
                            $buckets[$cKey].Add($mf.Finding)
                        }
                    }
                }
            }
            elseif ($fwId -eq 'hipaa') {
                # Split on '(' and take [0] to get section (e.g., "§164.312")
                $section = ($trimmed -split '\(')[0]
                if ($buckets.ContainsKey($section)) {
                    $buckets[$section].Add($mf.Finding)
                }
            }
            else {
                # Generic: exact match
                if ($buckets.ContainsKey($trimmed)) {
                    $buckets[$trimmed].Add($mf.Finding)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $criteria.Keys) {
        $critInfo = $criteria[$key]
        $label = if ($critInfo.label) { $critInfo.label } else { $key }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
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
        return @(New-ScoringGroup -Key 'All' -Label 'All Products' -Total ([int]$Framework.totalControls) -GroupFindings $bucket)
    }

    $buckets = @{}
    foreach ($key in $products.Keys) { $buckets[$key] = [System.Collections.Generic.List[PSCustomObject]]::new() }

    foreach ($mf in $MappedFindings) {
        $parts = $mf.ControlId -split ';'
        foreach ($part in $parts) {
            $trimmed = $part.Trim()
            # Pattern: MS.{product}.{number}v{version} -- split on '.', take index 1
            $segments = $trimmed -split '\.'
            if ($segments.Count -ge 2) {
                $productKey = $segments[1]
                if ($buckets.ContainsKey($productKey)) {
                    $buckets[$productKey].Add($mf.Finding)
                }
            }
        }
    }

    $groups = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($key in $products.Keys) {
        $prodInfo = $products[$key]
        $label = if ($prodInfo.label) { $prodInfo.label } else { $key }
        $groups.Add((New-ScoringGroup -Key $key -Label $label -Total 0 -GroupFindings $buckets[$key]))
    }
    return @($groups)
}
