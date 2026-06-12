<#
.SYNOPSIS
    Generates registry statistics blocks in docs and the coverage reference page
    from controls/registry.json.
.DESCRIPTION
    Reads the control data files (registry.json, sync-scope.json, risk-severity.json,
    learn-more.json, local-extensions.json, frameworks/*.json) and regenerates:

      - Marker-delimited stat blocks in README.md, src/M365-Assess/controls/README.md,
        and docs/user/COMPLIANCE.md (between <!-- registry-stats:NAME:begin/end -->
        comments)
      - docs/reference/COVERAGE.md in full (registry summary, per-framework mapping
        coverage, CISA SCuBA product pillars, per-collector counts)

    Every public check count and framework statistic comes from this script so the
    numbers can never drift from the shipped registry. CI runs this with -Check to
    enforce the invariant; if you change registry data, re-run this script and commit
    the regenerated docs alongside it.
.PARAMETER RepoRoot
    Repository root. Defaults to the parent of the script's directory.
.PARAMETER Check
    Compare existing file content against freshly-generated output. Exit 0 if all
    files match, exit 1 with the list of drifted files if not. Used by CI.
.EXAMPLE
    PS> ./scripts/Build-RegistryStats.ps1
    Regenerates all stat blocks and docs/reference/COVERAGE.md.
.EXAMPLE
    PS> ./scripts/Build-RegistryStats.ps1 -Check
    Used by CI; exits 1 if any generated content is out of sync.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),

    [Parameter()]
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------
# Load control data
# ------------------------------------------------------------------
$controlsPath = Join-Path -Path $RepoRoot -ChildPath 'src/M365-Assess/controls'
$registry = Get-Content -Path (Join-Path -Path $controlsPath -ChildPath 'registry.json') -Raw | ConvertFrom-Json
$scope = Get-Content -Path (Join-Path -Path $controlsPath -ChildPath 'sync-scope.json') -Raw | ConvertFrom-Json
$severity = Get-Content -Path (Join-Path -Path $controlsPath -ChildPath 'risk-severity.json') -Raw | ConvertFrom-Json
$learnMore = Get-Content -Path (Join-Path -Path $controlsPath -ChildPath 'learn-more.json') -Raw | ConvertFrom-Json
$localExt = Get-Content -Path (Join-Path -Path $controlsPath -ChildPath 'local-extensions.json') -Raw | ConvertFrom-Json

$checks = @($registry.checks)
$severityIds = @($severity.checks.PSObject.Properties.Name)
$learnMoreIds = @($learnMore.checks.PSObject.Properties.Name)

# Framework definition files shipped for the report view
$frameworkFiles = @(Get-ChildItem -Path (Join-Path -Path $controlsPath -ChildPath 'frameworks') -Filter '*.json')
$frameworkDefs = @{}
foreach ($file in $frameworkFiles) {
    $def = Get-Content -Path $file.FullName -Raw | ConvertFrom-Json
    $key = if ($def.registryKey) { $def.registryKey } else { $def.frameworkId }
    $frameworkDefs[$key] = $def
}

# ------------------------------------------------------------------
# Compute statistics
# ------------------------------------------------------------------
$checkCount = $checks.Count
$automatedCount = @($checks | Where-Object { $_.hasAutomatedCheck -eq $true }).Count
$collectors = @($scope.collectors | Sort-Object)
$collectorCount = $collectors.Count
$localExtCount = @($localExt).Count
$ratedCount = @($checks | Where-Object { $severityIds -contains $_.checkId }).Count
$unratedCount = $checkCount - $ratedCount
$learnMoreCount = @($checks | Where-Object { $learnMoreIds -contains $_.checkId }).Count
$frameworkFileCount = $frameworkFiles.Count

# Per-framework: checks mapped + distinct controls mapped (controlId may be comma-separated)
# NB: loop variable must not be named $check — it would collide with the [switch]$Check
# script parameter (PowerShell variables are case-insensitive) and throw on assignment.
$frameworkStats = @{}
foreach ($regCheck in $checks) {
    if (-not $regCheck.frameworks) { continue }
    foreach ($prop in $regCheck.frameworks.PSObject.Properties) {
        if (-not $frameworkStats.ContainsKey($prop.Name)) {
            $frameworkStats[$prop.Name] = @{
                Checks   = 0
                Controls = [System.Collections.Generic.HashSet[string]]::new()
            }
        }
        $frameworkStats[$prop.Name].Checks++
        if ($prop.Value.controlId) {
            # Split on the same delimiters as the report's group extractors
            # (tests/Behavior/Framework-Taxonomy.Tests.ps1 mirrors report-app.jsx)
            foreach ($cid in ([string]$prop.Value.controlId) -split '[;,]') {
                $trimmed = $cid.Trim()
                if ($trimmed) { [void]$frameworkStats[$prop.Name].Controls.Add($trimmed) }
            }
        }
    }
}

# CISA SCuBA product pillars from controlId prefixes (MS.<PRODUCT>.x.y).
# Labels come from scoring.products, falling back to the groups map (which the
# Framework-Taxonomy test guarantees covers every registry-mapped MS.* key).
$scubaProducts = [ordered]@{}
$scubaGroups = @{}
if ($frameworkDefs.ContainsKey('cisa-scuba')) {
    if ($frameworkDefs['cisa-scuba'].scoring.products) {
        foreach ($prop in $frameworkDefs['cisa-scuba'].scoring.products.PSObject.Properties) {
            $scubaProducts[$prop.Name.ToUpperInvariant()] = @{ Label = $prop.Value.label; Mapped = 0 }
        }
    }
    if ($frameworkDefs['cisa-scuba'].groups) {
        foreach ($prop in $frameworkDefs['cisa-scuba'].groups.PSObject.Properties) {
            $scubaGroups[$prop.Name.ToUpperInvariant()] = [string]$prop.Value
        }
    }
}
if ($frameworkStats.ContainsKey('cisa-scuba')) {
    foreach ($cid in $frameworkStats['cisa-scuba'].Controls) {
        if ($cid -match '^MS\.([A-Za-z]+)\.') {
            $product = $Matches[1].ToUpperInvariant()
            if (-not $scubaProducts.Contains($product)) {
                $label = if ($scubaGroups.ContainsKey("MS.$product")) { $scubaGroups["MS.$product"] } else { $product }
                $scubaProducts[$product] = @{ Label = $label; Mapped = 0 }
            }
            $scubaProducts[$product].Mapped++
        }
    }
}

# Per-collector counts
$collectorStats = foreach ($collector in $collectors) {
    $own = @($checks | Where-Object { $_.collector -eq $collector })
    [pscustomobject]@{
        Collector = $collector
        Checks    = $own.Count
        Rated     = @($own | Where-Object { $severityIds -contains $_.checkId }).Count
        LearnMore = @($own | Where-Object { $learnMoreIds -contains $_.checkId }).Count
    }
}

# ------------------------------------------------------------------
# Render generated content
# ------------------------------------------------------------------
$summaryBlock = "**$checkCount automated security checks** mapped across **$frameworkFileCount compliance frameworks** — counts generated from [``controls/registry.json``](src/M365-Assess/controls/registry.json); per-framework coverage in [docs/reference/COVERAGE.md](docs/reference/COVERAGE.md)."

$filesBlock = "``registry.json`` currently contains **$checkCount checks** across **$collectorCount collector families**, including **$localExtCount local extension checks**. Mappings span **$($frameworkStats.Keys.Count) framework keys**, $frameworkFileCount of which have report-view definitions in ``frameworks/``."

$checksBlock = "The assessment suite includes **$checkCount security checks** across **$collectorCount collector families** ($($collectors -join ', ')), each mapped to one or more compliance frameworks."

$registryBlock = "Framework mappings are defined in ``controls/registry.json``, which contains **$checkCount control entries** — the M365-scoped subset of the upstream CheckID registry plus **$localExtCount local extension checks**."

$coverage = [System.Text.StringBuilder]::new()
[void]$coverage.AppendLine('# Coverage Statistics')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('> Generated by `scripts/Build-RegistryStats.ps1` from `controls/registry.json` (data version ' + $registry.dataVersion + '). Do not edit by hand — regenerate with `./scripts/Build-RegistryStats.ps1`; CI fails PRs where this page drifts from the registry.')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('## Registry summary')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine("- **Checks:** $checkCount ($automatedCount automated)")
[void]$coverage.AppendLine("- **Collector families:** $collectorCount (see ``controls/sync-scope.json``)")
[void]$coverage.AppendLine("- **Local extension checks:** $localExtCount (pending upstream CheckID adoption)")
[void]$coverage.AppendLine("- **Severity-rated:** $ratedCount of $checkCount ($unratedCount unrated checks display the default Medium severity)")
[void]$coverage.AppendLine("- **Learn-more links:** $learnMoreCount of $checkCount")
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('## Per-framework mapping coverage')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('"Checks mapped" counts registry checks carrying a mapping for the framework; "distinct controls" counts the unique framework control IDs those mappings reference. Coverage relative to a framework''s full control catalog needs the framework''s own denominator — the registry only knows what is mapped, so an unmapped control is invisible here (see the SCuBA pillar table below for a worked example).')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('| Framework key | Report view | Checks mapped | Distinct controls mapped | Avg checks / control |')
[void]$coverage.AppendLine('|---|---|---|---|---|')
$orderedFw = $frameworkStats.GetEnumerator() | Sort-Object -Property @{ Expression = { $_.Value.Checks }; Descending = $true }, @{ Expression = { $_.Key } }
foreach ($fw in $orderedFw) {
    $hasView = if ($frameworkDefs.ContainsKey($fw.Key)) { 'yes' } else { '—' }
    $controlCount = $fw.Value.Controls.Count
    $depth = if ($controlCount -gt 0) { [math]::Round($fw.Value.Checks / $controlCount, 1) } else { '—' }
    [void]$coverage.AppendLine("| ``$($fw.Key)`` | $hasView | $($fw.Value.Checks) | $controlCount | $depth |")
}
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('## CISA SCuBA product pillars')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('Distinct SCuBA policy IDs mapped, by product prefix (`MS.<PRODUCT>.*`). Products with zero mapped policies are coverage gaps, not absences of the product from SCuBA.')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('| Product | Label | Distinct policies mapped |')
[void]$coverage.AppendLine('|---|---|---|')
foreach ($key in $scubaProducts.Keys) {
    [void]$coverage.AppendLine("| MS.$key | $($scubaProducts[$key].Label) | $($scubaProducts[$key].Mapped) |")
}
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('## Per-collector check counts')
[void]$coverage.AppendLine()
[void]$coverage.AppendLine('| Collector | Checks | Severity-rated | Learn-more links |')
[void]$coverage.AppendLine('|---|---|---|---|')
foreach ($row in $collectorStats) {
    [void]$coverage.AppendLine("| $($row.Collector) | $($row.Checks) | $($row.Rated) | $($row.LearnMore) |")
}

# ------------------------------------------------------------------
# Apply: marker blocks + full COVERAGE.md
# ------------------------------------------------------------------
function Update-MarkerBlock {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Content,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Replacement,

        [Parameter(Mandatory)]
        [string]$FilePath
    )

    $begin = "<!-- registry-stats:${Name}:begin -->"
    $end = "<!-- registry-stats:${Name}:end -->"
    $pattern = [regex]::Escape($begin) + '(?s).*?' + [regex]::Escape($end)
    if ($Content -notmatch $pattern) {
        throw "Marker block '$Name' not found in $FilePath - add $begin / $end markers first."
    }
    return [regex]::Replace($Content, $pattern, ($begin + "`n" + $Replacement + "`n" + $end))
}

$targets = @(
    @{ Path = 'README.md'; Blocks = @{ summary = $summaryBlock } }
    @{ Path = 'src/M365-Assess/controls/README.md'; Blocks = @{ files = $filesBlock } }
    @{ Path = 'docs/user/COMPLIANCE.md'; Blocks = @{ checks = $checksBlock; registry = $registryBlock } }
)

$drifted = [System.Collections.Generic.List[string]]::new()

foreach ($target in $targets) {
    $fullPath = Join-Path -Path $RepoRoot -ChildPath $target.Path
    # Normalize CRLF -> LF: .gitattributes 'text=auto' gives Windows runners a
    # CRLF working tree while the generated replacement blocks use LF; without
    # normalization the -Check gate reports pure line-ending noise as drift.
    $original = (Get-Content -Path $fullPath -Raw).Replace("`r`n", "`n")
    $updated = $original
    foreach ($blockName in $target.Blocks.Keys) {
        $updated = Update-MarkerBlock -Content $updated -Name $blockName -Replacement $target.Blocks[$blockName] -FilePath $target.Path
    }
    # -cne: default -ne is case-insensitive and would miss case-only drift
    if ($updated -cne $original) {
        if ($Check) {
            $drifted.Add($target.Path)
        } else {
            Set-Content -Path $fullPath -Value $updated -NoNewline
            Write-Host "updated: $($target.Path)"
        }
    }
}

$coveragePath = Join-Path -Path $RepoRoot -ChildPath 'docs/reference/COVERAGE.md'
# StringBuilder.AppendLine uses the platform newline (CRLF on Windows); pin to
# LF so the generated file is identical regardless of where it was produced.
$coverageText = $coverage.ToString().Replace("`r`n", "`n")
$existingCoverage = if (Test-Path -Path $coveragePath) { (Get-Content -Path $coveragePath -Raw).Replace("`r`n", "`n") } else { '' }
if ($coverageText -cne $existingCoverage) {
    if ($Check) {
        $drifted.Add('docs/reference/COVERAGE.md')
    } else {
        Set-Content -Path $coveragePath -Value $coverageText -NoNewline
        Write-Host 'updated: docs/reference/COVERAGE.md'
    }
}

if ($Check) {
    if ($drifted.Count -gt 0) {
        Write-Host 'Registry stats are out of sync with controls/registry.json in:'
        $drifted | ForEach-Object { Write-Host "  - $_" }
        Write-Host 'Run ./scripts/Build-RegistryStats.ps1 and commit the regenerated files.'
        exit 1
    }
    Write-Host 'Registry stats are in sync.'
}
