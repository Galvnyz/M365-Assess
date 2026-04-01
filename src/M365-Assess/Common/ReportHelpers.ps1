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
