function Get-BaselineTrend {
    <#
    .SYNOPSIS
        Enumerates saved baselines for a tenant and aggregates per-status counts per snapshot.
    .DESCRIPTION
        Scans the Baselines directory for folders matching *_<SafeTenant>/, reads each
        manifest.json for timestamp + version metadata, and counts the Status field
        across every security-config JSON file in the baseline. Returns a chronologically
        sorted array suitable for trend visualisation in the report.
    .PARAMETER BaselinesRoot
        Path to the Baselines directory (typically <OutputFolder>/Baselines).
    .PARAMETER TenantId
        Tenant identifier used to filter baseline folders by suffix.
    .PARAMETER MaxSnapshots
        Maximum number of most-recent snapshots to return. Defaults to 10 — enough
        context for a visible trend without cluttering the chart. Older snapshots
        are dropped.
    .OUTPUTS
        [PSCustomObject[]] One entry per baseline, sorted chronologically:
          Label, SavedAt, Version, Pass, Warn, Fail, Review, Info, Skipped, Total
    .EXAMPLE
        $trend = Get-BaselineTrend -BaselinesRoot '.\M365-Assessment\Baselines' -TenantId 'contoso.com'
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$BaselinesRoot,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [ValidateRange(1, 100)]
        [int]$MaxSnapshots = 10
    )

    if (-not (Test-Path -Path $BaselinesRoot -PathType Container)) {
        Write-Verbose "Trend: baselines root '$BaselinesRoot' does not exist"
        return @()
    }

    $safeTenant = $TenantId -replace '[^\w\.\-]', '_'
    $baselineDirs = Get-ChildItem -Path $BaselinesRoot -Directory -Filter "*_${safeTenant}" -ErrorAction SilentlyContinue

    $snapshots = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($dir in $baselineDirs) {
        try {
            $manifestPath = Join-Path -Path $dir.FullName -ChildPath 'manifest.json'
            if (-not (Test-Path -Path $manifestPath)) {
                Write-Verbose "Trend: skipped '$($dir.Name)' — no manifest.json"
                continue
            }
            $manifest = Get-Content -Path $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json

            $counts = @{ pass = 0; warn = 0; fail = 0; review = 0; info = 0; skipped = 0; total = 0 }
            $jsonFiles = Get-ChildItem -Path $dir.FullName -Filter '*.json' -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne 'manifest.json' }

            foreach ($jf in $jsonFiles) {
                $rows = Get-Content -Path $jf.FullName -Raw -ErrorAction Stop | ConvertFrom-Json
                foreach ($row in @($rows)) {
                    $counts.total++
                    switch ($row.Status) {
                        'Pass'    { $counts.pass++ }
                        'Warning' { $counts.warn++ }
                        'Fail'    { $counts.fail++ }
                        'Review'  { $counts.review++ }
                        'Info'    { $counts.info++ }
                        'Skipped' { $counts.skipped++ }
                    }
                }
            }

            $snapshots.Add([PSCustomObject]@{
                Label   = $manifest.Label
                SavedAt = $manifest.SavedAt
                Version = $manifest.AssessmentVersion
                Pass    = $counts.pass
                Warn    = $counts.warn
                Fail    = $counts.fail
                Review  = $counts.review
                Info    = $counts.info
                Skipped = $counts.skipped
                Total   = $counts.total
            })
        }
        catch {
            Write-Verbose "Trend: skipped baseline '$($dir.Name)': $_"
        }
    }

    @($snapshots | Sort-Object SavedAt | Select-Object -Last $MaxSnapshots)
}
