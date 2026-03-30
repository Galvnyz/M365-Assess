<#
.SYNOPSIS
    Collects Microsoft Forms tenant security and configuration settings.
.DESCRIPTION
    Queries Microsoft Graph for Microsoft Forms admin settings including external
    sharing controls, phishing protection, and respondent identity recording.
    Returns a structured inventory of settings with current values and CIS benchmark
    recommendations.

    Requires the following Graph API permissions:
    OrgSettings-Forms.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'OrgSettings-Forms.Read.All'
    PS> .\Collaboration\Get-FormsSecurityConfig.ps1

    Displays Microsoft Forms security configuration settings.
.EXAMPLE
    PS> .\Collaboration\Get-FormsSecurityConfig.ps1 -OutputPath '.\forms-security-config.csv'

    Exports Forms security configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Continue on errors: non-critical checks should not block remaining assessments.
$ErrorActionPreference = 'Continue'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

$settings = [System.Collections.Generic.List[PSCustomObject]]::new()
$checkIdCounter = @{}

function Add-Setting {
    param(
        [string]$Category,
        [string]$Setting,
        [string]$CurrentValue,
        [string]$RecommendedValue,
        [string]$Status,
        [string]$CheckId = '',
        [string]$Remediation = ''
    )
    # Auto-generate sub-numbered CheckId for individual setting traceability
    $subCheckId = $CheckId
    if ($CheckId) {
        if (-not $checkIdCounter.ContainsKey($CheckId)) { $checkIdCounter[$CheckId] = 0 }
        $checkIdCounter[$CheckId]++
        $subCheckId = "$CheckId.$($checkIdCounter[$CheckId])"
    }
    $settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $subCheckId
        Remediation      = $Remediation
    })
    if ($CheckId -and (Get-Command -Name Update-CheckProgress -ErrorAction SilentlyContinue)) {
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# 1. Microsoft Forms Admin Settings (CIS 3.6.x)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Microsoft Forms admin settings..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/admin/forms/settings'
        ErrorAction = 'Stop'
    }
    $formsSettings = Invoke-MgGraphRequest @graphParams

    if ($formsSettings) {
        # CIS 3.6.1 - Ensure only people in your organization can respond to forms
        $externalSend = $formsSettings['isExternalSendFormEnabled']
        $settingParams = @{
            Category         = 'External Sharing'
            Setting          = 'External Users Can Respond to Forms'
            CurrentValue     = "$externalSend"
            RecommendedValue = 'False'
            Status           = if (-not $externalSend) { 'Pass' } else { 'Fail' }
            CheckId          = 'FORMS-CONFIG-001'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Uncheck "People outside your organization can respond".'
        }
        Add-Setting @settingParams

        # CIS 3.6.1 - Ensure external collaboration on forms is restricted
        $externalCollab = $formsSettings['isExternalShareCollaborationEnabled']
        $settingParams = @{
            Category         = 'External Sharing'
            Setting          = 'External Users Can Collaborate on Forms'
            CurrentValue     = "$externalCollab"
            RecommendedValue = 'False'
            Status           = if (-not $externalCollab) { 'Pass' } else { 'Fail' }
            CheckId          = 'FORMS-CONFIG-002'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Uncheck "People outside your organization can share and collaborate on forms".'
        }
        Add-Setting @settingParams

        # External result sharing
        $externalResults = $formsSettings['isExternalShareResultEnabled']
        $settingParams = @{
            Category         = 'External Sharing'
            Setting          = 'External Users Can View Form Results'
            CurrentValue     = "$externalResults"
            RecommendedValue = 'False'
            Status           = if (-not $externalResults) { 'Pass' } else { 'Fail' }
            CheckId          = 'FORMS-CONFIG-003'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Uncheck "People outside your organization can see results summary and individual responses".'
        }
        Add-Setting @settingParams

        # CIS 3.6.2 - Phishing protection enabled
        $phishingProtection = $formsSettings['isPhishingScanEnabled']
        $settingParams = @{
            Category         = 'Security'
            Setting          = 'Phishing Protection'
            CurrentValue     = "$phishingProtection"
            RecommendedValue = 'True'
            Status           = if ($phishingProtection) { 'Pass' } else { 'Fail' }
            CheckId          = 'FORMS-CONFIG-004'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Enable "Internal phishing protection".'
        }
        Add-Setting @settingParams

        # Identity recording by default (accountability/non-repudiation)
        $recordIdentity = $formsSettings['isRecordIdentityByDefaultEnabled']
        $settingParams = @{
            Category         = 'Security'
            Setting          = 'Record Respondent Identity by Default'
            CurrentValue     = "$recordIdentity"
            RecommendedValue = 'True'
            Status           = if ($recordIdentity) { 'Pass' } else { 'Review' }
            CheckId          = 'FORMS-CONFIG-005'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Enable "Record name by default when new forms are created".'
        }
        Add-Setting @settingParams

        # Bing image/video search (external content exposure)
        $bingSearch = $formsSettings['isBingImageVideoSearchEnabled']
        $settingParams = @{
            Category         = 'Security'
            Setting          = 'Bing Image and Video Search'
            CurrentValue     = "$bingSearch"
            RecommendedValue = 'False'
            Status           = if (-not $bingSearch) { 'Pass' } else { 'Review' }
            CheckId          = 'FORMS-CONFIG-006'
            Remediation      = 'Microsoft 365 admin center > Settings > Org settings > Microsoft Forms > Uncheck "Bing search and YouTube video".'
        }
        Add-Setting @settingParams
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization_RequestDenied|Insufficient') {
        Write-Warning "Insufficient permissions to read Forms settings. Requires OrgSettings-Forms.Read.All scope. Skipping Forms security checks."
        $settingParams = @{
            Category         = 'External Sharing'
            Setting          = 'External Users Can Respond to Forms'
            CurrentValue     = 'Permission denied -- OrgSettings-Forms.Read.All required'
            RecommendedValue = 'False'
            Status           = 'Review'
            CheckId          = 'FORMS-CONFIG-001'
            Remediation      = 'Reconnect with the OrgSettings-Forms.Read.All permission scope to check Microsoft Forms settings.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not retrieve Microsoft Forms settings: $($_.Exception.Message)"
    }
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Microsoft Forms security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Forms security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
