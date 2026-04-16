<#
.SYNOPSIS
    Evaluates whether Microsoft Secure Score monitoring is active for continuous
    security control oversight.
.DESCRIPTION
    Checks whether the tenant has a current Secure Score being actively updated,
    indicating continuous monitoring of security controls. Verifies the score has
    a recent createdDateTime (within 7 days) and that improvement actions are
    being tracked.

    Requires an active Microsoft Graph connection with SecurityEvents.Read.All
    permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Security\Get-DefenderSecureMonConfig.ps1

    Displays secure monitoring evaluation results.
.EXAMPLE
    PS> .\Security\Get-DefenderSecureMonConfig.ps1 -OutputPath '.\defender-securemon.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    CA.L2-3.12.3 — Monitor Security Controls on an Ongoing Basis
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = ''
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# 1. Check Secure Score for active monitoring
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Microsoft Secure Score for active monitoring...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/security/secureScores?$top=5'
        ErrorAction = 'Stop'
    }
    $secureScores = Invoke-MgGraphRequest @graphParams

    $scoreExists = $false
    $isRecent = $false
    $currentDetail = 'No Secure Score data available'

    if ($secureScores -and $secureScores['value'] -and @($secureScores['value']).Count -gt 0) {
        $latestScore = $secureScores['value'][0]
        $scoreExists = $true

        $scoreDate = $latestScore['createdDateTime']
        $currentScore = $latestScore['currentScore']
        $maxScore = $latestScore['maxScore']

        # Check if the score was updated within the last 7 days
        $scoreDateParsed = [datetime]::Parse($scoreDate)
        $daysSinceUpdate = ([datetime]::UtcNow - $scoreDateParsed).Days
        $isRecent = $daysSinceUpdate -le 7

        $percentage = if ($maxScore -gt 0) { [math]::Round(($currentScore / $maxScore) * 100, 1) } else { 0 }
        $currentDetail = "Score: $currentScore/$maxScore ($percentage%), Last updated: $scoreDate ($daysSinceUpdate days ago)"
    }

    $settingParams = @{
        Category         = 'Security Monitoring'
        Setting          = 'Microsoft Secure Score Active Monitoring'
        CurrentValue     = $currentDetail
        RecommendedValue = 'Secure Score updated within the last 7 days'
        Status           = if ($isRecent) { 'Pass' } elseif ($scoreExists) { 'Warning' } else { 'Fail' }
        CheckId          = 'DEFENDER-SECUREMON-001'
        Remediation      = 'Access Microsoft Secure Score at security.microsoft.com/securescore. Review and act on improvement recommendations regularly.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Security Monitoring'
            Setting          = 'Microsoft Secure Score Active Monitoring'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'Secure Score updated within the last 7 days'
            Status           = 'Review'
            CheckId          = 'DEFENDER-SECUREMON-001'
            Remediation      = 'Requires SecurityEvents.Read.All permission.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check Secure Score monitoring: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Defender Secure Mon'
