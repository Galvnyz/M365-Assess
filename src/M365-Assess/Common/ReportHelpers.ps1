<#
.SYNOPSIS
    Pure helper functions for HTML report generation.
.DESCRIPTION
    Contains HTML escaping, badge rendering, SVG chart generation, column formatting,
    and smart data sorting functions used by Export-AssessmentReport.ps1 and its
    companion Build-SectionHtml.ps1 / Get-ReportTemplate.ps1 modules.

    Dot-source this file to make all helper functions available:
        . "$PSScriptRoot\ReportHelpers.ps1"
.NOTES
    Author: Daren9m
    Extracted from Export-AssessmentReport.ps1 for maintainability (#235).
#>

# ------------------------------------------------------------------
# HTML helper functions
# ------------------------------------------------------------------
function ConvertTo-HtmlSafe {
    param([string]$Text)
    if (-not $Text) { return '' }
    return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

function Get-StatusBadge {
    param([string]$Status)
    switch ($Status) {
        'Complete' { '<span class="badge badge-complete">Complete</span>' }
        'Skipped'  { '<span class="badge badge-skipped">Skipped</span>' }
        'Failed'   { '<span class="badge badge-failed">Failed</span>' }
        default    { "<span class='badge'>$Status</span>" }
    }
}

function Format-ColumnHeader {
    param([string]$Name)
    if (-not $Name) { return $Name }
    # Insert space between lowercase/digit and uppercase: "createdDate" -> "created Date"
    # CRITICAL: Use -creplace (case-sensitive) -- default -replace is case-insensitive
    $spaced = $Name -creplace '([a-z\d])([A-Z])', '$1 $2'
    # Insert space between consecutive uppercase and uppercase+lowercase: "MFAStatus" -> "MFA Status"
    $spaced = $spaced -creplace '([A-Z]+)([A-Z][a-z])', '$1 $2'
    return $spaced
}

function Get-SeverityBadge {
    param([string]$Severity)
    switch ($Severity) {
        'ERROR'   { '<span class="badge badge-failed">ERROR</span>' }
        'WARNING' { '<span class="badge badge-warning">WARNING</span>' }
        'INFO'    { '<span class="badge badge-info">INFO</span>' }
        default   { "<span class='badge'>$Severity</span>" }
    }
}

function Get-AssetBase64 {
    param([string]$Directory, [string[]]$Patterns)
    foreach ($pattern in $Patterns) {
        $file = Get-ChildItem -Path $Directory -Filter $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($file) {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            $ext = $file.Extension.TrimStart('.').ToLower()
            $mime = switch ($ext) {
                'jpg'  { 'image/jpeg' }
                'jpeg' { 'image/jpeg' }
                'svg'  { 'image/svg+xml' }
                default { 'image/png' }
            }
            return @{ Base64 = [Convert]::ToBase64String($bytes); Mime = $mime }
        }
    }
    return $null
}

# ------------------------------------------------------------------
# SVG chart helpers -- inline charts for the HTML report
# ------------------------------------------------------------------
function Get-SvgDonut {
    param(
        [double]$Percentage,
        [string]$CssClass = 'success',
        [string]$Label = '',
        [int]$Size = 120,
        [int]$StrokeWidth = 10
    )
    $radius = ($Size / 2) - $StrokeWidth
    $circumference = [math]::Round(2 * [math]::PI * $radius, 2)
    $dashOffset = [math]::Round($circumference * (1 - ($Percentage / 100)), 2)
    $center = $Size / 2
    $displayVal = if ($Label) { $Label } else { "$Percentage%" }
    return @"
<svg class='donut-chart' width='$Size' height='$Size' viewBox='0 0 $Size $Size' role='img' aria-label='Chart showing $displayVal'>
<circle class='donut-track' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'/>
<circle class='donut-fill donut-$CssClass' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'
  stroke-dasharray='$circumference' stroke-dashoffset='$dashOffset' stroke-linecap='round' transform='rotate(-90 $center $center)'/>
<text class='donut-text' x='$center' y='$center' text-anchor='middle' dominant-baseline='central'>$displayVal</text>
</svg>
"@
}

function Get-SvgMultiDonut {
    param(
        [array]$Segments,
        [string]$CenterLabel = '',
        [int]$Size = 130,
        [int]$StrokeWidth = 11
    )
    $radius = ($Size / 2) - $StrokeWidth
    $circumference = 2 * [math]::PI * $radius
    $center = $Size / 2
    $svg = "<svg class='donut-chart' width='$Size' height='$Size' viewBox='0 0 $Size $Size' role='img' aria-label='Chart showing $CenterLabel'>"
    $svg += "<circle class='donut-track' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth'/>"
    # Filter to visible segments and track cumulative arc to eliminate rounding gaps
    $visibleSegs = @($Segments | Where-Object { $_.Pct -gt 0 })
    $offset = 0
    $cumulativeArc = 0
    for ($i = 0; $i -lt $visibleSegs.Count; $i++) {
        $seg = $visibleSegs[$i]
        $rotDeg = [math]::Round(($offset / 100) * 360 - 90, 4)
        if ($i -eq $visibleSegs.Count - 1) {
            # Last segment closes the circle exactly -- no rounding gap possible
            $arcLen = [math]::Round($circumference - $cumulativeArc, 4)
        } else {
            $arcLen = [math]::Round(($seg.Pct / 100) * $circumference, 4)
        }
        $gapLen = [math]::Round($circumference - $arcLen, 4)
        $svg += "<circle class='donut-fill donut-$($seg.Css)' data-segment='$($seg.Css)' cx='$center' cy='$center' r='$radius' fill='none' stroke-width='$StrokeWidth' stroke-dasharray='$arcLen $gapLen' transform='rotate($rotDeg $center $center)'/>"
        $offset += $seg.Pct
        $cumulativeArc += $arcLen
    }
    $svg += "<text class='donut-text donut-text-sm' x='$center' y='$center' text-anchor='middle' dominant-baseline='central'>$CenterLabel</text>"
    $svg += "</svg>"
    return $svg
}

function Get-SvgHorizontalBar {
    param(
        [array]$Segments
    )
    $barHtml = "<div class='hbar-chart'>"
    foreach ($seg in $Segments) {
        if ($seg.Pct -gt 0) {
            $barHtml += "<div class='hbar-segment hbar-$($seg.Css)' style='width: $($seg.Pct)%;' title='$($seg.Label): $($seg.Count)'><span class='hbar-label'>$($seg.Count)</span></div>"
        }
    }
    $barHtml += "</div>"
    return $barHtml
}

function Get-SvgStackedBar {
    <#
    .SYNOPSIS
        Generates an SVG stacked horizontal bar chart with one row per service area.
    .DESCRIPTION
        Renders a multi-row SVG chart where each row is a horizontal stacked bar
        showing Pass/Fail/Warning/Review counts for a service area. Uses CSS
        variables for fill colors to support light and dark mode.
    .PARAMETER Rows
        Array of hashtables with keys: Label, Pass, Fail, Warning, Review, Total.
    .PARAMETER Width
        SVG width in pixels.
    .PARAMETER BarHeight
        Height of each bar in pixels.
    .PARAMETER Gap
        Vertical gap between rows in pixels.
    .PARAMETER LabelWidth
        Width reserved for row labels in pixels.
    .EXAMPLE
        Get-SvgStackedBar -Rows @(@{Label='Identity'; Pass=45; Fail=3; Warning=5; Review=2; Total=55})
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [array]$Rows,
        [int]$Width = 600,
        [int]$BarHeight = 22,
        [int]$Gap = 6,
        [int]$LabelWidth = 110
    )

    $legendHeight = 28
    $topPadding = 4
    $totalHeight = $topPadding + ($Rows.Count * ($BarHeight + $Gap)) - $Gap + $legendHeight + 8
    $barWidth = $Width - $LabelWidth - 50  # reserve space for count label on right

    $svg = "<svg xmlns='http://www.w3.org/2000/svg' width='$Width' height='$totalHeight' viewBox='0 0 $Width $totalHeight' role='img' aria-label='Service area breakdown chart'>"

    # Legend at top
    $legendY = $topPadding
    $legendItems = @(
        @{ Label = 'Pass'; Color = 'var(--m365a-success)' },
        @{ Label = 'Fail'; Color = 'var(--m365a-danger)' },
        @{ Label = 'Warning'; Color = 'var(--m365a-warning)' },
        @{ Label = 'Review'; Color = 'var(--m365a-review)' }
    )
    $legendX = $LabelWidth
    foreach ($item in $legendItems) {
        $svg += "<rect x='$legendX' y='$legendY' width='10' height='10' rx='2' fill='$($item.Color)'/>"
        $textX = $legendX + 14
        $svg += "<text x='$textX' y='$($legendY + 9)' font-family='Inter, sans-serif' font-size='9' fill='var(--m365a-medium-gray)'>$($item.Label)</text>"
        $legendX += 70
    }

    $barStartY = $topPadding + $legendHeight

    foreach ($row in $Rows) {
        $rowIndex = [array]::IndexOf($Rows, $row)
        $y = $barStartY + ($rowIndex * ($BarHeight + $Gap))
        $textY = $y + [math]::Round($BarHeight / 2, 0) + 4

        # Derive navigation target from label: lowercase, replace non-alphanumeric with dash
        $navTarget = 'section-' + ($row.Label -replace '[^a-zA-Z0-9]', '-').ToLower()

        # Wrap entire row in a clickable group with data-nav
        $svg += "<g class='chart-nav-link' data-nav='$navTarget' role='link' tabindex='0' aria-label='Navigate to $($row.Label) section'>"

        # Row label
        $svg += "<text x='$($LabelWidth - 8)' y='$textY' font-family='Inter, sans-serif' font-size='10' fill='var(--m365a-text)' text-anchor='end'>$($row.Label)</text>"

        $total = [int]$row.Total
        if ($total -eq 0) {
            # Empty bar track
            $svg += "<rect x='$LabelWidth' y='$y' width='$barWidth' height='$BarHeight' rx='4' fill='var(--m365a-border)' opacity='0.3'/>"
            $svg += "</g>"
            continue
        }

        # Background track
        $svg += "<rect x='$LabelWidth' y='$y' width='$barWidth' height='$BarHeight' rx='4' fill='var(--m365a-border)' opacity='0.15'/>"

        # Stacked segments: Pass, Fail, Warning, Review
        $segments = @(
            @{ Count = [int]$row.Pass; Color = 'var(--m365a-success)'; Name = 'Pass' },
            @{ Count = [int]$row.Fail; Color = 'var(--m365a-danger)'; Name = 'Fail' },
            @{ Count = [int]$row.Warning; Color = 'var(--m365a-warning)'; Name = 'Warning' },
            @{ Count = [int]$row.Review; Color = 'var(--m365a-review)'; Name = 'Review' }
        )

        $xOffset = $LabelWidth
        $isFirst = $true
        $isLast = $false
        $visibleSegs = @($segments | Where-Object { $_.Count -gt 0 })
        $segIndex = 0

        foreach ($seg in $visibleSegs) {
            $segWidth = [math]::Round(($seg.Count / $total) * $barWidth, 1)
            if ($segWidth -lt 1) { $segWidth = 1 }
            $segIndex++
            $isLast = ($segIndex -eq $visibleSegs.Count)

            # Use clip-path for rounded corners on first/last segments
            if ($isFirst -and $isLast) {
                $svg += "<rect x='$xOffset' y='$y' width='$segWidth' height='$BarHeight' rx='4' fill='$($seg.Color)'>"
            } elseif ($isFirst) {
                $clipId = "clip-first-$rowIndex"
                $svg += "<clipPath id='$clipId'><rect x='$xOffset' y='$y' width='$($segWidth + 4)' height='$BarHeight' rx='4'/></clipPath>"
                $svg += "<rect x='$xOffset' y='$y' width='$segWidth' height='$BarHeight' fill='$($seg.Color)' clip-path='url(#$clipId)'>"
            } elseif ($isLast) {
                $clipId = "clip-last-$rowIndex"
                $svg += "<clipPath id='$clipId'><rect x='$($xOffset - 4)' y='$y' width='$($segWidth + 4)' height='$BarHeight' rx='4'/></clipPath>"
                $svg += "<rect x='$xOffset' y='$y' width='$segWidth' height='$BarHeight' fill='$($seg.Color)' clip-path='url(#$clipId)'>"
            } else {
                $svg += "<rect x='$xOffset' y='$y' width='$segWidth' height='$BarHeight' fill='$($seg.Color)'>"
            }
            $svg += "<title>$($seg.Name): $($seg.Count)</title></rect>"
            $xOffset += $segWidth
            $isFirst = $false
        }

        # Total count label on right
        $countX = $LabelWidth + $barWidth + 6
        $svg += "<text x='$countX' y='$textY' font-family='Inter, sans-serif' font-size='10' fill='var(--m365a-medium-gray)'>$total</text>"

        # Close clickable row group
        $svg += "</g>"
    }

    $svg += "</svg>"
    return $svg
}

# ------------------------------------------------------------------
# Smart sorting helper -- prioritize actionable rows
# ------------------------------------------------------------------
function Get-SmartSortedData {
    param(
        [array]$Data,
        [string]$CollectorName
    )

    if (-not $Data -or $Data.Count -le 1) { return $Data }

    $columns = @($Data[0].PSObject.Properties.Name)

    # Security Config collectors: sort non-passing items first
    if ($columns -contains 'Status' -and $columns -contains 'CheckId') {
        $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Unknown' = 3; 'Pass' = 4 }
        return @($Data | Sort-Object -Property @{
            Expression = { if ($null -ne $statusPriority[$_.Status]) { $statusPriority[$_.Status] } else { 5 } }
        }, 'Category', 'Setting')
    }

    # MFA Report: show users without MFA enforcement first, admins first
    if ($CollectorName -match 'MFA') {
        $mfaStatusCol = $columns | Where-Object { $_ -match 'MFAStatus|MfaStatus|StrongAuth' }
        $adminCol = $columns | Where-Object { $_ -match 'Admin|Role|IsAdmin' }
        if ($mfaStatusCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$mfaStatusCol -match 'Enforced|Enabled') { 1 } else { 0 } }
            }, @{
                Expression = { if ($adminCol -and $_.$adminCol -and $_.$adminCol -ne 'None' -and $_.$adminCol -ne '' -and $_.$adminCol -ne 'False') { 0 } else { 1 } }
            })
        }
    }

    # Device Summary: non-compliant and non-enrolled devices first
    if ($CollectorName -match 'Device') {
        $complianceCol = $columns | Where-Object { $_ -match 'Complian' }
        $enrollCol = $columns | Where-Object { $_ -match 'Enroll|Managed|MDM' }
        if ($complianceCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$complianceCol -match 'Compliant|compliant') { 1 } else { 0 } }
            })
        }
        if ($enrollCol) {
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$enrollCol -match 'True|Yes|Enrolled') { 1 } else { 0 } }
            })
        }
    }

    # User Summary: disabled and inactive accounts first
    if ($CollectorName -match 'User Summary') {
        $enabledCol = $columns | Where-Object { $_ -match 'AccountEnabled|Enabled' }
        if ($enabledCol) {
            $signInCol = $columns | Where-Object { $_ -match 'LastSignIn|LastLogin' }
            if ($signInCol) {
                return @($Data | Sort-Object -Property @{
                    Expression = { if ($_.$enabledCol -match 'True|Yes') { 1 } else { 0 } }
                }, $signInCol)
            }
            return @($Data | Sort-Object -Property @{
                Expression = { if ($_.$enabledCol -match 'True|Yes') { 1 } else { 0 } }
            })
        }
    }

    # Security Config collectors without CIS (Status column present)
    if ($columns -contains 'Status' -and $columns -contains 'RecommendedValue') {
        $statusPriority = @{ 'Fail' = 0; 'Warning' = 1; 'Review' = 2; 'Unknown' = 3; 'Pass' = 4 }
        return @($Data | Sort-Object -Property @{
            Expression = { if ($null -ne $statusPriority[$_.Status]) { $statusPriority[$_.Status] } else { 5 } }
        })
    }

    return $Data
}
