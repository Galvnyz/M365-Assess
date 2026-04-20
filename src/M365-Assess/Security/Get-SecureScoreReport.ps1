<#
.SYNOPSIS
    Retrieves the latest Microsoft Secure Score and per-control breakdown.
.DESCRIPTION
    Queries Microsoft Graph for the most recent Secure Score snapshot and reports
    the overall score summary (current, max, percentage) along with the average
    comparative score. Optionally exports a detailed improvement actions breakdown
    to a separate CSV file for remediation planning and client reporting.

    Requires Microsoft.Graph.Security module and SecurityEvents.Read.All permission.
.PARAMETER OutputPath
    Optional path to export the score summary as CSV. If not specified, results are
    returned to the pipeline.
.PARAMETER ImprovementActionsPath
    Optional path to export the per-control improvement actions breakdown as CSV.
    If not specified, improvement actions are not exported separately.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'SecurityEvents.Read.All'
    PS> .\Security\Get-SecureScoreReport.ps1

    Displays the latest Secure Score summary to the console.
.EXAMPLE
    PS> .\Security\Get-SecureScoreReport.ps1 -OutputPath '.\secure-score.csv' -ImprovementActionsPath '.\improvement-actions.csv'

    Exports the score summary and improvement actions to separate CSV files.
.EXAMPLE
    PS> .\Security\Get-SecureScoreReport.ps1 -Verbose

    Displays the latest Secure Score with verbose processing details.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [string]$ImprovementActionsPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Security -ErrorAction Stop

# Retrieve the most recent Secure Score
Write-Verbose "Retrieving Secure Score history (up to 180 days)..."
try {
    $secureScores = Get-MgSecuritySecureScore -Top 180 -Sort 'createdDateTime desc'
}
catch {
    Write-Error "Failed to retrieve Secure Score. Ensure SecurityEvents.Read.All permission is granted: $_"
    return
}

if (-not $secureScores -or @($secureScores).Count -eq 0) {
    Write-Warning "No Secure Score data found for this tenant."
    return
}

$latestScore = @($secureScores)[0]

# Calculate the percentage
$currentScore = $latestScore.CurrentScore
$maxScore = $latestScore.MaxScore
$percentage = if ($maxScore -gt 0) {
    [math]::Round(($currentScore / $maxScore) * 100, 2)
}
else {
    0
}

# Extract the average comparative score from the AverageComparativeScores collection
# Graph SDK may not deserialize nested types — check AdditionalProperties fallback
$averageComparative = 0
if ($latestScore.AverageComparativeScores) {
    $averageEntry = $latestScore.AverageComparativeScores |
        Where-Object {
            ($_.Basis -eq 'AllTenants') -or
            ($_.AdditionalProperties -and $_.AdditionalProperties['basis'] -eq 'AllTenants')
        } |
        Select-Object -First 1
    if ($averageEntry) {
        $averageComparative = if ($null -ne $averageEntry.AverageScore -and $averageEntry.AverageScore -gt 0) {
            $averageEntry.AverageScore
        } elseif ($averageEntry.AdditionalProperties -and $averageEntry.AdditionalProperties.ContainsKey('averageScore')) {
            $averageEntry.AdditionalProperties['averageScore']
        } else {
            0
        }
    }
}

Write-Verbose "Secure Score: $currentScore / $maxScore ($percentage%) as of $($latestScore.CreatedDateTime)"

# Compute Microsoft-managed vs customer-earned score split via control profiles.
# Microsoft-managed controls have actionType = 'ProviderGenerated'. Add $top=250
# to avoid the default 100-item page limit (Secure Score has 290+ controls).
$microsoftScore = 0.0
$customerScore  = 0.0
try {
    $profilesResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/security/secureScoreControlProfiles?$top=250' -ErrorAction Stop
    $profileMap = @{}
    foreach ($prof in $profilesResp.value) {
        $profileMap[$prof.id] = $prof.actionType
    }
    foreach ($ctrl in $latestScore.ControlScores) {
        $earned = if ($null -ne $ctrl.Score) { [double]$ctrl.Score } else { 0.0 }
        if ($profileMap[$ctrl.ControlName] -eq 'ProviderGenerated') {
            $microsoftScore += $earned
        } else {
            $customerScore += $earned
        }
    }
    $microsoftScore = [math]::Round($microsoftScore, 2)
    $customerScore  = [math]::Round($customerScore, 2)
}
catch {
    Write-Verbose "Could not compute score split from control profiles: $_"
}

# Build one row per historical snapshot (newest-first from Graph).
# AverageComparativeScore is only populated for the latest entry — the API returns
# it only on the most recent snapshot and it would be stale/wrong for older dates.
$allScoreRows = [System.Collections.Generic.List[PSCustomObject]]::new()
$isLatest = $true
foreach ($snapshot in $secureScores) {
    $snapshotMax = if ($snapshot.MaxScore -gt 0) { $snapshot.MaxScore } else { 1 }
    $snapshotPct = [math]::Round(($snapshot.CurrentScore / $snapshotMax) * 100, 2)
    $allScoreRows.Add([PSCustomObject]@{
        CurrentScore            = $snapshot.CurrentScore
        MaxScore                = $snapshot.MaxScore
        Percentage              = $snapshotPct
        CreatedDateTime         = $snapshot.CreatedDateTime
        AverageComparativeScore = if ($isLatest) { $averageComparative } else { 0 }
        MicrosoftScore          = if ($isLatest) { $microsoftScore } else { $null }
        CustomerScore           = if ($isLatest) { $customerScore } else { $null }
    })
    $isLatest = $false
}
$scoreSummary = $allScoreRows[0]

# Process improvement actions from ControlScores
$improvementActions = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($latestScore.ControlScores -and $latestScore.ControlScores.Count -gt 0) {
    Write-Verbose "Processing $($latestScore.ControlScores.Count) control scores..."

    foreach ($control in $latestScore.ControlScores) {
        # Extract additional properties from the AdditionalProperties dictionary
        $additionalProps = $control.AdditionalProperties

        $category = if ($additionalProps -and $additionalProps.ContainsKey('controlCategory')) {
            $additionalProps['controlCategory']
        }
        else {
            'N/A'
        }

        $implementationStatus = if ($additionalProps -and $additionalProps.ContainsKey('implementationStatus')) {
            $additionalProps['implementationStatus']
        }
        else {
            'N/A'
        }

        $userImpact = if ($additionalProps -and $additionalProps.ContainsKey('userImpact')) {
            $additionalProps['userImpact']
        }
        else {
            'N/A'
        }

        $threats = if ($additionalProps -and $additionalProps.ContainsKey('threats')) {
            $threatList = $additionalProps['threats']
            if ($threatList -is [System.Collections.IEnumerable] -and $threatList -isnot [string]) {
                ($threatList | ForEach-Object { $_.ToString() }) -join '; '
            }
            else {
                [string]$threatList
            }
        }
        else {
            'N/A'
        }

        $scoreImpact = if ($control.ScoreInPercentage) {
            $control.ScoreInPercentage
        }
        elseif ($additionalProps -and $additionalProps.ContainsKey('scoreInPercentage')) {
            $additionalProps['scoreInPercentage']
        }
        else {
            0
        }

        $controlCurrentScore = if ($null -ne $control.Score) {
            $control.Score
        }
        else {
            0
        }

        $controlMaxScore = if ($additionalProps -and $additionalProps.ContainsKey('maxScore')) {
            $additionalProps['maxScore']
        }
        else {
            0
        }

        $improvementActions.Add([PSCustomObject]@{
            ActionName           = $control.ControlName
            Category             = $category
            ScoreImpact          = $scoreImpact
            CurrentScore         = $controlCurrentScore
            MaxScore             = $controlMaxScore
            ImplementationStatus = $implementationStatus
            UserImpact           = $userImpact
            Threats              = $threats
        })
    }
}
else {
    Write-Verbose "No control score data found in the latest Secure Score."
}

# Export improvement actions if path is specified
if ($ImprovementActionsPath -and $improvementActions.Count -gt 0) {
    $improvementActions | Export-Csv -Path $ImprovementActionsPath -NoTypeInformation -Encoding UTF8
    Write-Verbose "Exported $($improvementActions.Count) improvement actions to $ImprovementActionsPath"
}

# Output the score summary
if ($OutputPath) {
    $allScoreRows | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Secure Score summary to $OutputPath"
    if ($ImprovementActionsPath -and $improvementActions.Count -gt 0) {
        Write-Output "Exported $($improvementActions.Count) improvement actions to $ImprovementActionsPath"
    }
}
else {
    Write-Output $scoreSummary
    if ($improvementActions.Count -gt 0 -and -not $ImprovementActionsPath) {
        Write-Verbose "Use -ImprovementActionsPath to export the $($improvementActions.Count) improvement actions to CSV."
    }
}
