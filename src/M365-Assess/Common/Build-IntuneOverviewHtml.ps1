function Build-IntuneOverviewHtml {
    <#
    .SYNOPSIS
        Builds the Intune Overview HTML page for the assessment report.
    .DESCRIPTION
        Renders a summary page covering managed device count, compliance rate, policy
        inventory, per-category security check status, and a filterable findings table
        for all INTUNE-* checks.
    .PARAMETER Findings
        All CIS findings from the assessment ($allCisFindings).
    .PARAMETER AssessmentFolder
        Path to the assessment output folder. Used to read device summary and policy CSVs.
    .EXAMPLE
        $intuneOverviewHtml = Build-IntuneOverviewHtml -Findings $allCisFindings -AssessmentFolder $AssessmentFolder
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()]
        [PSCustomObject[]]$Findings = @(),

        [Parameter()]
        [string]$AssessmentFolder = ''
    )

    $intuneFindings = @($Findings | Where-Object { $_.CheckId -like 'INTUNE-*' })
    if ($intuneFindings.Count -eq 0) { return '' }

    # ------------------------------------------------------------------
    # Metric data from CSVs
    # ------------------------------------------------------------------
    $deviceCount        = 'N/A'
    $compliantPct       = 'N/A'
    $policyCount        = 'N/A'
    $profileCount       = 'N/A'
    $compliancePctClass = ''

    if ($AssessmentFolder -and (Test-Path -Path $AssessmentFolder)) {
        $deviceCsv = Join-Path -Path $AssessmentFolder -ChildPath '13-Device-Summary.csv'
        if (Test-Path -Path $deviceCsv) {
            $devices = @(Import-Csv -Path $deviceCsv -ErrorAction SilentlyContinue)
            if ($devices.Count -gt 0) {
                $deviceCount    = $devices.Count
                $compliantCount = @($devices | Where-Object { $_.ComplianceState -eq 'Compliant' }).Count
                $pct            = [int][Math]::Round(($compliantCount / $devices.Count) * 100)
                $compliantPct   = "$pct%"
                $compliancePctClass = if ($pct -ge 80) { 'id-metric-success' } elseif ($pct -ge 60) { 'id-metric-warning' } else { 'id-metric-danger' }
            }
        }

        $policyCsv = Join-Path -Path $AssessmentFolder -ChildPath '14-Compliance-Policies.csv'
        if (Test-Path -Path $policyCsv) {
            $policyCount = @(Import-Csv -Path $policyCsv -ErrorAction SilentlyContinue).Count
        }

        $profileCsv = Join-Path -Path $AssessmentFolder -ChildPath '15-Config-Profiles.csv'
        if (Test-Path -Path $profileCsv) {
            $profileCount = @(Import-Csv -Path $profileCsv -ErrorAction SilentlyContinue).Count
        }
    }

    # Fallback: parse INTUNE-INVENTORY-001 CurrentValue for device count
    if ($deviceCount -eq 'N/A') {
        $invCheck = $intuneFindings | Where-Object { $_.CheckId -like 'INTUNE-INVENTORY-001*' } | Select-Object -First 1
        if ($invCheck -and $invCheck.CurrentValue -match '(\d+)\s+device') {
            $deviceCount = $Matches[1]
        }
    }

    # ------------------------------------------------------------------
    # Check status summary
    # ------------------------------------------------------------------
    $passCount   = @($intuneFindings | Where-Object { $_.Status -eq 'Pass' }).Count
    $failCount   = @($intuneFindings | Where-Object { $_.Status -eq 'Fail' }).Count
    $warnCount   = @($intuneFindings | Where-Object { $_.Status -eq 'Warning' }).Count
    $reviewCount = @($intuneFindings | Where-Object { $_.Status -eq 'Review' }).Count
    $total       = $intuneFindings.Count
    $passRatePct = if ($total -gt 0) { [int][Math]::Round(($passCount / $total) * 100) } else { 0 }
    $passRateClass = if ($passRatePct -ge 80) { 'id-metric-success' } elseif ($passRatePct -ge 60) { 'id-metric-warning' } else { 'id-metric-danger' }

    # ------------------------------------------------------------------
    # Category groups sorted by worst status
    # ------------------------------------------------------------------
    $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Pass' = 3; 'Info' = 4; 'Skipped' = 5 }
    $categories = $intuneFindings | Group-Object -Property Category | ForEach-Object {
        $worstStatus = ($_.Group | Sort-Object -Property @{
            Expression = { if ($statusPriority.ContainsKey($_.Status)) { $statusPriority[$_.Status] } else { 99 } }
        } | Select-Object -First 1).Status
        [PSCustomObject]@{
            Category   = $_.Name
            Count      = $_.Group.Count
            WrstStatus = $worstStatus
            Priority   = if ($statusPriority.ContainsKey($worstStatus)) { $statusPriority[$worstStatus] } else { 99 }
        }
    } | Sort-Object -Property Priority

    $catIcons = @{
        'Compliance'               = '&#128203;'
        'Enrollment'               = '&#128241;'
        'Inventory'                = '&#128230;'
        'Automated Discovery'      = '&#128269;'
        'Portable Storage'         = '&#128190;'
        'Security'                 = '&#128737;'
        'Personal Device Enrollment' = '&#128100;'
        'Application Control'      = '&#9881;&#65039;'
        'Encryption'               = '&#128272;'
        'Windows Update'           = '&#128260;'
        'Mobile Encryption'        = '&#128241;'
        'FIPS Cryptography'        = '&#128274;'
    }

    $sortedFindings = $intuneFindings | Sort-Object -Property @(
        @{ Expression = { if ($statusPriority.ContainsKey($_.Status)) { $statusPriority[$_.Status] } else { 99 } } }
        @{ Expression = { $_.Category } }
        @{ Expression = { $_.CheckId } }
    )

    $html = [System.Text.StringBuilder]::new()
    $null = $html.AppendLine("<details class='section' id='intune-overview-section' open>")
    $null = $html.AppendLine("<summary><h2>Intune Overview</h2></summary>")

    # ------------------------------------------------------------------
    # Metric cards
    # ------------------------------------------------------------------
    $null = $html.AppendLine("<div class='email-metrics-grid'>")
    $null = $html.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#128241;</div><div class='email-metric-body'><div class='email-metric-value'>$deviceCount</div><div class='email-metric-label'>Managed Devices</div></div></div>")
    $null = $html.AppendLine("<div class='email-metric-card $compliancePctClass'><div class='email-metric-icon'>&#9989;</div><div class='email-metric-body'><div class='email-metric-value'>$compliantPct</div><div class='email-metric-label'>Compliant Devices</div></div></div>")
    $null = $html.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#128203;</div><div class='email-metric-body'><div class='email-metric-value'>$policyCount</div><div class='email-metric-label'>Compliance Policies</div></div></div>")
    $null = $html.AppendLine("<div class='email-metric-card'><div class='email-metric-icon'>&#9881;&#65039;</div><div class='email-metric-body'><div class='email-metric-value'>$profileCount</div><div class='email-metric-label'>Config Profiles</div></div></div>")
    $null = $html.AppendLine("<div class='email-metric-card $passRateClass'><div class='email-metric-icon'>&#128737;</div><div class='email-metric-body'><div class='email-metric-value'>$passRatePct%</div><div class='email-metric-label'>Checks Passing</div></div></div>")
    $null = $html.AppendLine("</div>")

    # ------------------------------------------------------------------
    # Category coverage grid
    # ------------------------------------------------------------------
    $null = $html.AppendLine("<details class='collector-detail' open>")
    $null = $html.AppendLine("<summary><h3>Security Check Coverage by Category</h3><span class='row-count'>($($categories.Count) categories, $total checks)</span></summary>")
    $null = $html.AppendLine("<div class='intune-category-grid'>")

    foreach ($cat in $categories) {
        $icon      = if ($catIcons.ContainsKey($cat.Category)) { $catIcons[$cat.Category] } else { '&#128274;' }
        $badgeCls  = switch ($cat.WrstStatus) {
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-review' }
            'Pass'    { 'badge-success' }
            default   { 'badge-neutral' }
        }
        $borderCls = switch ($cat.WrstStatus) {
            'Fail'    { 'intune-cat-fail' }
            'Warning' { 'intune-cat-warning' }
            'Review'  { 'intune-cat-review' }
            'Pass'    { 'intune-cat-pass' }
            default   { '' }
        }
        $catEncoded = ConvertTo-HtmlSafe -Text $cat.Category
        $checkWord  = if ($cat.Count -eq 1) { 'check' } else { 'checks' }
        $null = $html.AppendLine("<div class='intune-cat-card $borderCls'>")
        $null = $html.AppendLine("<div class='intune-cat-icon'>$icon</div>")
        $null = $html.AppendLine("<div class='intune-cat-body'><div class='intune-cat-name'>$catEncoded</div>")
        $null = $html.AppendLine("<div class='intune-cat-meta'><span class='badge $badgeCls'>$($cat.WrstStatus)</span>&nbsp;<span class='intune-cat-count'>$($cat.Count) $checkWord</span></div>")
        $null = $html.AppendLine("</div></div>")
    }

    $null = $html.AppendLine("</div>")   # intune-category-grid
    $null = $html.AppendLine("</details>")  # collector-detail

    # ------------------------------------------------------------------
    # Status chip filter + findings table
    # ------------------------------------------------------------------
    $null = $html.AppendLine("<div class='remediation-chip-bar'>")
    $null = $html.AppendLine("<div class='rem-chip-section'>")
    $null = $html.AppendLine("<span class='rem-filter-label'>Status:</span>")
    $null = $html.AppendLine("<div class='rem-chip-group' id='intuneStatusChips'>")
    foreach ($se in @( @('Fail',$failCount), @('Warning',$warnCount), @('Review',$reviewCount), @('Pass',$passCount) )) {
        if ($se[1] -gt 0) {
            $null = $html.AppendLine("<label class='fw-checkbox active rem-sev-chip' data-intune-status='$($se[0])' onclick='toggleIntuneChip(this); return false;'><input type='checkbox' checked hidden>$($se[0]) <span class='rem-chip-count'>$($se[1])</span></label>")
        }
    }
    $null = $html.AppendLine("</div>")
    $null = $html.AppendLine("<span class='fw-selector-actions'><button type='button' class='fw-action-btn rem-intune-all' onclick='setAllIntuneChips(this)'>All</button><button type='button' class='fw-action-btn rem-intune-none' onclick='setAllIntuneChips(this)'>None</button></span>")
    $null = $html.AppendLine("</div></div>")

    $findingWord = if ($sortedFindings.Count -eq 1) { 'check' } else { 'checks' }
    $null = $html.AppendLine("<details class='collector-detail' id='intuneTableDetail' open>")
    $null = $html.AppendLine("<summary><h3>All Intune Checks</h3><span class='row-count' id='intuneMatchCount'>($($sortedFindings.Count) $findingWord)</span></summary>")

    $null = $html.AppendLine("<div class='col-picker-bar'>")
    $null = $html.AppendLine("<button type='button' class='col-picker-toggle'>Columns &#9662;</button>")
    $null = $html.AppendLine("<div class='col-picker-panel' hidden>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneCategory' checked> Category</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneCheck' checked> Check</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneCheckId' data-col-default='hidden'> Check ID</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneStatus' checked> Status</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneSeverity' checked> Severity</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneValue' checked> Current Value</label>")
    $null = $html.AppendLine("<label class='col-picker-item'><input type='checkbox' data-col-key='IntuneRemediation' checked> Remediation</label>")
    $null = $html.AppendLine("</div></div>")

    $null = $html.AppendLine("<div class='table-wrapper'>")
    $null = $html.AppendLine("<table class='data-table' id='intuneTable'>")
    $null = $html.AppendLine("<thead><tr>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneCategory'>Category</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneCheck'>Check</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneCheckId' style='display:none'>Check ID</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneStatus'>Status</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneSeverity'>Severity</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneValue'>Current Value</th>")
    $null = $html.AppendLine("<th scope='col' data-col-key='IntuneRemediation'>Remediation</th>")
    $null = $html.AppendLine("</tr></thead><tbody>")

    foreach ($finding in $sortedFindings) {
        $statusBadge = switch ($finding.Status) {
            'Fail'    { 'badge-failed' }
            'Warning' { 'badge-warning' }
            'Review'  { 'badge-review' }
            'Pass'    { 'badge-success' }
            default   { 'badge-neutral' }
        }
        $sevBadge = switch ($finding.RiskSeverity) {
            'Critical' { 'badge-fail' }
            'High'     { 'badge-warning' }
            'Medium'   { 'badge-review' }
            default    { 'badge-neutral' }
        }
        $rowCls = switch ($finding.Status) {
            'Fail'    { 'cis-row-fail' }
            'Warning' { 'cis-row-warning' }
            'Review'  { 'cis-row-review' }
            'Pass'    { 'cis-row-pass' }
            default   { '' }
        }
        $sev         = if ($finding.RiskSeverity) { $finding.RiskSeverity } else { 'Low' }
        $catEnc      = ConvertTo-HtmlSafe -Text $finding.Category
        $checkEnc    = ConvertTo-HtmlSafe -Text $finding.Setting
        $checkIdEnc  = ConvertTo-HtmlSafe -Text $(if ($finding.CheckId) { $finding.CheckId } else { '' })
        $valueEnc    = ConvertTo-HtmlSafe -Text $finding.CurrentValue
        $remEnc      = ConvertTo-HtmlSafe -Text $(if ($finding.Remediation) { $finding.Remediation } else { '' })

        $null = $html.AppendLine("<tr class='$rowCls' data-intune-status='$($finding.Status)'>")
        $null = $html.AppendLine("<td data-col-key='IntuneCategory'>$catEnc</td>")
        $null = $html.AppendLine("<td data-col-key='IntuneCheck'>$checkEnc</td>")
        $null = $html.AppendLine("<td data-col-key='IntuneCheckId' style='display:none'>$checkIdEnc</td>")
        $null = $html.AppendLine("<td data-col-key='IntuneStatus'><span class='badge $statusBadge'>$(ConvertTo-HtmlSafe -Text $finding.Status)</span></td>")
        $null = $html.AppendLine("<td data-col-key='IntuneSeverity'><span class='badge $sevBadge'>$(ConvertTo-HtmlSafe -Text $sev)</span></td>")
        $null = $html.AppendLine("<td data-col-key='IntuneValue'>$valueEnc</td>")
        $null = $html.AppendLine("<td data-col-key='IntuneRemediation'><span class='rem-text'>$remEnc</span></td>")
        $null = $html.AppendLine("</tr>")
    }

    $null = $html.AppendLine("</tbody></table></div>")
    $null = $html.AppendLine("<p id='intuneNoResults' class='no-results' style='display:none'>No checks match the current filter selection.</p>")
    $null = $html.AppendLine("</details>")   # collector-detail table
    $null = $html.AppendLine("</details>")   # section

    return $html.ToString()
}
