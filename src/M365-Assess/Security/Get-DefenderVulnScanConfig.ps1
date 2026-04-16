<#
.SYNOPSIS
    Evaluates whether Microsoft Defender for Endpoint vulnerability scanning is
    active in the tenant.
.DESCRIPTION
    Checks whether Defender for Endpoint Vulnerability Management is operational
    by querying Microsoft Secure Score for vulnerability management related controls
    and checking for Defender for Endpoint onboarding evidence.

    Requires an active Microsoft Graph connection with SecurityEvents.Read.All
    permission. Full functionality requires Defender for Endpoint P2 (E5).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Security\Get-DefenderVulnScanConfig.ps1

    Displays vulnerability scanning evaluation results.
.EXAMPLE
    PS> .\Security\Get-DefenderVulnScanConfig.ps1 -OutputPath '.\defender-vulnscan.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    RA.L2-3.11.2 — Scan for Vulnerabilities Periodically
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
# 1. Check Secure Score for vulnerability management indicators
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Secure Score for vulnerability management controls...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/security/secureScores?$top=1'
        ErrorAction = 'Stop'
    }
    $secureScores = Invoke-MgGraphRequest @graphParams

    $scoreExists = $false
    $vulnManagementActive = $false
    $currentDetail = 'No Secure Score data available'

    if ($secureScores -and $secureScores['value'] -and @($secureScores['value']).Count -gt 0) {
        $latestScore = $secureScores['value'][0]
        $scoreExists = $true
        $scoreDate = $latestScore['createdDateTime']
        $enabledServices = $latestScore['enabledServices']

        # Check if MDE or vulnerability-related services are present
        if ($enabledServices) {
            $mdeEnabled = @($enabledServices) -match 'HasMDEP2|DefenderForEndpoint|WindowsDefenderATP'
            if ($mdeEnabled.Count -gt 0) {
                $vulnManagementActive = $true
            }
        }

        # Check control scores for vulnerability-related actions
        $controlScores = $latestScore['controlScores']
        if ($controlScores) {
            $vulnControls = @($controlScores | Where-Object {
                $_['controlName'] -match 'Vulnerability|TurnOnMDE|OnboardDevices'
            })
            if ($vulnControls.Count -gt 0) {
                $vulnManagementActive = $true
            }
        }

        $currentDetail = "Secure Score date: $scoreDate, MDE active: $vulnManagementActive"
    }

    $settingParams = @{
        Category         = 'Vulnerability Scanning'
        Setting          = 'Defender for Endpoint Vulnerability Management Active'
        CurrentValue     = $currentDetail
        RecommendedValue = 'Defender for Endpoint with Vulnerability Management enabled'
        Status           = if ($vulnManagementActive) { 'Pass' } elseif ($scoreExists) { 'Warning' } else { 'Fail' }
        CheckId          = 'DEFENDER-VULNSCAN-001'
        Remediation      = 'Enable Microsoft Defender for Endpoint. Navigate to security.microsoft.com > Vulnerability management to review coverage. Ensure devices are onboarded to MDE.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Vulnerability Scanning'
            Setting          = 'Defender for Endpoint Vulnerability Management Active'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'Defender for Endpoint with Vulnerability Management enabled'
            Status           = 'Review'
            CheckId          = 'DEFENDER-VULNSCAN-001'
            Remediation      = 'Requires SecurityEvents.Read.All permission and Defender for Endpoint P2 (E5) license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check vulnerability scanning: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Defender Vuln Scan'
