<#
.SYNOPSIS
    Exports M365-Assess findings in consultant-workflow formats (D3 #787).
.DESCRIPTION
    Reads a completed assessment folder and produces one or more remediation
    export files keyed to specific consultant workflows: GitHub Issues markdown,
    executive-summary markdown, Jira CSV import, and a technical backlog
    markdown table.

    Outputs go to <AssessmentFolder>/Remediation/ by default. Formats can be
    selected individually via -Format; the default is all four.

    The cmdlet does NOT re-run the assessment. It reads the per-collector CSVs
    and the registry-driven horizon (now/next/later) the same way the HTML
    report and XLSX matrix do, so all three artifacts stay in agreement.
.PARAMETER AssessmentFolder
    Path to the completed assessment output folder.
.PARAMETER OutputFolder
    Where to write the export files. Defaults to <AssessmentFolder>/Remediation.
.PARAMETER Format
    One or more formats: GitHub | ExecutiveSummary | Jira | TechnicalBacklog.
    Default is all four.
.PARAMETER TenantName
    Optional tenant identifier embedded in the executive summary.
.OUTPUTS
    [string[]] Array of full paths to written files.
.EXAMPLE
    Export-M365Remediation -AssessmentFolder ./M365-Assessment/Assessment_20260426 -Format GitHub,Jira
.EXAMPLE
    Export-M365Remediation -AssessmentFolder ./M365-Assessment/Assessment_20260426 -TenantName 'Contoso'
#>

function Export-M365Remediation {
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$AssessmentFolder,

        [Parameter()]
        [string]$OutputFolder,

        [Parameter()]
        [ValidateSet('GitHub', 'ExecutiveSummary', 'Jira', 'TechnicalBacklog')]
        [string[]]$Format = @('GitHub', 'ExecutiveSummary', 'Jira', 'TechnicalBacklog'),

        [Parameter()]
        [string]$TenantName
    )

    if (-not (Test-Path -Path $AssessmentFolder -PathType Container)) {
        throw "AssessmentFolder not found: $AssessmentFolder"
    }

    if (-not $OutputFolder) {
        $OutputFolder = Join-Path -Path $AssessmentFolder -ChildPath 'Remediation'
    }
    New-Item -Path $OutputFolder -ItemType Directory -Force | Out-Null

    if (-not $TenantName) {
        $TenantName = Split-Path -Leaf $AssessmentFolder
    }

    # ---------- Load findings + remediation horizon ----------
    $laneScript = Join-Path -Path $PSScriptRoot -ChildPath 'Get-RemediationLane.ps1'
    if (-not (Get-Command -Name Get-RemediationLane -ErrorAction SilentlyContinue)) {
        if (Test-Path $laneScript) { . $laneScript }
    }
    $registryScript = Join-Path -Path $PSScriptRoot -ChildPath 'Import-ControlRegistry.ps1'
    if (-not (Get-Command -Name Import-ControlRegistry -ErrorAction SilentlyContinue)) {
        if (Test-Path $registryScript) { . $registryScript }
    }

    $registry = @{}
    $controlsPath = Join-Path -Path $PSScriptRoot -ChildPath '..\controls'
    if (Test-Path -Path $controlsPath) {
        try { $registry = Import-ControlRegistry -ControlsPath $controlsPath } catch { $registry = @{} }
    }

    # Aggregate per-collector CSVs (the same source-of-truth shape the XLSX matrix uses).
    $findings = [System.Collections.Generic.List[PSCustomObject]]::new()
    $csvFiles = Get-ChildItem -Path $AssessmentFolder -Filter '*-config*.csv' -ErrorAction SilentlyContinue
    foreach ($csv in $csvFiles) {
        Import-Csv -Path $csv.FullName | ForEach-Object {
            if ($_.CheckId -and $_.Status -in @('Fail', 'Warning', 'Review')) {
                $base = $_.CheckId -replace '\.\d+$', ''
                $reg  = if ($registry.ContainsKey($base)) { $registry[$base] } else { $null }
                $sev  = if ($reg -and $reg.riskSeverity) { $reg.riskSeverity } else { 'medium' }
                $eff  = if ($reg -and $reg.effort) { [string]$reg.effort } else { 'medium' }
                $hor  = Get-RemediationLane -Status $_.Status -Severity $sev -Effort $eff
                $findings.Add([PSCustomObject]@{
                    CheckId      = $_.CheckId
                    BaseCheckId  = $base
                    Setting      = $_.Setting
                    Category     = $_.Category
                    Status       = $_.Status
                    CurrentValue = $_.CurrentValue
                    Recommended  = $_.RecommendedValue
                    Remediation  = $_.Remediation
                    Severity     = $sev
                    Effort       = $eff
                    Horizon      = $hor
                    Impact       = if ($reg -and $reg.impact) { [string]$reg.impact } else { '' }
                    References   = if ($reg -and $reg.references) { @($reg.references) } else { @() }
                })
            }
        }
    }

    if ($findings.Count -eq 0) {
        Write-Warning "No remediation-relevant findings (Fail/Warning/Review) in: $AssessmentFolder"
        return @()
    }

    $written = [System.Collections.Generic.List[string]]::new()

    # ---------- GitHub Issues markdown ----------
    if ($Format -contains 'GitHub') {
        $ghDir = Join-Path -Path $OutputFolder -ChildPath 'github'
        New-Item -Path $ghDir -ItemType Directory -Force | Out-Null
        foreach ($f in $findings) {
            $title = "[$($f.Severity.ToUpper())] $($f.Setting)"
            $labels = @($f.Status.ToLower(), "horizon:$($f.Horizon)", "severity:$($f.Severity)") -join ', '
            $refsBlock = if ($f.References.Count -gt 0) {
                "## References`n" + (($f.References | ForEach-Object {
                    $url = if ($_ -is [hashtable]) { $_.url } else { $_.url }
                    $title = if ($_ -is [hashtable]) { $_.title } else { $_.title }
                    "- [$title]($url)"
                }) -join "`n")
            } else { '' }
            $body = @"
# $title

**CheckId:** $($f.CheckId) | **Status:** $($f.Status) | **Severity:** $($f.Severity) | **Effort:** $($f.Effort) | **Horizon:** $($f.Horizon)

**Suggested labels:** $labels

## Current state
$($f.CurrentValue)

## Recommended state
$($f.Recommended)

## Remediation
$($f.Remediation)

$refsBlock
"@
            $safeName = $f.CheckId -replace '[^A-Za-z0-9_.-]', '_'
            $path = Join-Path -Path $ghDir -ChildPath "$safeName.md"
            Set-Content -Path $path -Value $body -Encoding UTF8
            $written.Add($path)
        }
        # Helper script
        $helper = @"
# Bulk-create GitHub issues from these markdown files
# Usage:  cd github && bash create-issues.sh <owner>/<repo>
set -euo pipefail
REPO="`${1:?owner/repo required}"
for f in *.md; do
  [[ "`$f" == "create-issues.sh" || "`$f" == "README.md" ]] && continue
  TITLE=`$(head -1 "`$f" | sed 's/^# //')
  gh issue create --repo "`$REPO" --title "`$TITLE" --body-file "`$f"
done
"@
        Set-Content -Path (Join-Path $ghDir 'create-issues.sh') -Value $helper -Encoding UTF8
        $written.Add((Join-Path $ghDir 'create-issues.sh'))
    }

    # ---------- Executive summary markdown ----------
    if ($Format -contains 'ExecutiveSummary') {
        $statusCounts = @{
            Fail    = @($findings | Where-Object Status -eq 'Fail').Count
            Warning = @($findings | Where-Object Status -eq 'Warning').Count
            Review  = @($findings | Where-Object Status -eq 'Review').Count
        }
        $sevOrder = @{ critical = 0; high = 1; medium = 2; low = 3; none = 4; info = 5 }
        $topCritical = @($findings | Where-Object Status -eq 'Fail' |
            Sort-Object { $sevOrder[$_.Severity] }, CheckId | Select-Object -First 5)
        $quickWins = @($findings | Where-Object {
            $_.Status -eq 'Fail' -and ($_.Effort -eq 'small' -or $_.Effort -eq 'low')
        } | Sort-Object { $sevOrder[$_.Severity] } | Select-Object -First 5)
        $byHorizon = @{
            now   = @($findings | Where-Object Horizon -eq 'now').Count
            soon  = @($findings | Where-Object Horizon -eq 'soon').Count
            later = @($findings | Where-Object Horizon -eq 'later').Count
        }

        $exec = @"
# Executive Remediation Summary - $TenantName

Generated: $(Get-Date -Format 'yyyy-MM-dd')

## Status snapshot

| Status | Count |
|---|---|
| Fail | $($statusCounts.Fail) |
| Warning | $($statusCounts.Warning) |
| Review (manual validation) | $($statusCounts.Review) |

## Remediation horizon

| Horizon | Count | Meaning |
|---|---|---|
| Now | $($byHorizon.now) | Critical / high-impact fixes the team should start this sprint |
| Soon | $($byHorizon.soon) | Next 30-60 days |
| Later | $($byHorizon.later) | Long-tail / strategic |

## Top critical findings

$(if ($topCritical.Count -eq 0) { '_No critical failures._' } else {
    ($topCritical | ForEach-Object {
        "- **[$($_.CheckId)]** $($_.Setting) -- severity $($_.Severity), effort $($_.Effort)"
    }) -join "`n"
})

## Quick wins (high-impact, low-effort)

$(if ($quickWins.Count -eq 0) { '_No quick wins available -- failures require non-trivial effort._' } else {
    ($quickWins | ForEach-Object {
        "- **[$($_.CheckId)]** $($_.Setting) -- $($_.Severity) severity, $($_.Effort) effort"
    }) -join "`n"
})

## Next steps

1. Review the top critical findings with the security architect
2. Schedule the Now-horizon items into the next sprint
3. Use the GitHub Issues markdown export to bulk-create tracking issues
4. Re-run the assessment after the next remediation sprint to measure drift
"@
        $execPath = Join-Path -Path $OutputFolder -ChildPath 'executive-summary.md'
        Set-Content -Path $execPath -Value $exec -Encoding UTF8
        $written.Add($execPath)
    }

    # ---------- Jira CSV ----------
    if ($Format -contains 'Jira') {
        # Map M365-Assess severity to Jira priority. Jira's defaults: Highest/High/Medium/Low/Lowest.
        $priMap = @{ critical = 'Highest'; high = 'High'; medium = 'Medium'; low = 'Low'; none = 'Lowest'; info = 'Lowest' }
        $jiraRows = $findings | ForEach-Object {
            [PSCustomObject][ordered]@{
                Summary       = "[$($_.CheckId)] $($_.Setting)"
                Description   = "Status: $($_.Status). Current: $($_.CurrentValue). Recommended: $($_.Recommended). $([System.Environment]::NewLine)$([System.Environment]::NewLine)Remediation: $($_.Remediation)"
                'Issue Type'  = 'Task'
                Priority      = $priMap[$_.Severity]
                Labels        = "m365-assess $($_.Status.ToLower()) horizon-$($_.Horizon) severity-$($_.Severity)"
                Components    = $_.Category
            }
        }
        $jiraPath = Join-Path -Path $OutputFolder -ChildPath 'jira-import.csv'
        $jiraRows | Export-Csv -Path $jiraPath -NoTypeInformation -Encoding UTF8
        $written.Add($jiraPath)
    }

    # ---------- Technical backlog markdown ----------
    if ($Format -contains 'TechnicalBacklog') {
        $rows = $findings | Sort-Object @{Expression={
            switch ($_.Horizon) { 'now' { 0 } 'soon' { 1 } 'later' { 2 } default { 3 } }
        }}, Severity, CheckId
        $body = "# Technical Remediation Backlog - $TenantName`n`n"
        $body += "Generated: $(Get-Date -Format 'yyyy-MM-dd'). Total: $($rows.Count) finding(s).`n`n"
        $body += "| Horizon | CheckId | Setting | Status | Severity | Effort | Category |`n"
        $body += "|---|---|---|---|---|---|---|`n"
        foreach ($r in $rows) {
            $setting = $r.Setting -replace '\|', '\|'
            $body += "| $($r.Horizon) | $($r.CheckId) | $setting | $($r.Status) | $($r.Severity) | $($r.Effort) | $($r.Category) |`n"
        }
        $tbPath = Join-Path -Path $OutputFolder -ChildPath 'technical-backlog.md'
        Set-Content -Path $tbPath -Value $body -Encoding UTF8
        $written.Add($tbPath)
    }

    return $written.ToArray()
}
