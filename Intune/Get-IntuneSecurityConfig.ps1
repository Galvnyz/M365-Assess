<#
.SYNOPSIS
    Evaluates Intune/Endpoint Manager security settings against CIS requirements.
.DESCRIPTION
    Checks device compliance and enrollment configurations for proper security
    posture. Produces pass/fail verdicts via Add-Setting for each control.

    Requires an active Microsoft Graph connection with DeviceManagementConfiguration
    permissions.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph
    PS> .\Intune\Get-IntuneSecurityConfig.ps1

    Displays Intune security evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneSecurityConfig.ps1 -OutputPath '.\intune-security-config.csv'

    Exports the Intune evaluation to CSV.
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

# Stop on errors: API failures should halt this collector rather than produce partial results.
$ErrorActionPreference = 'Stop'

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
# 1. Device Compliance - Non-compliant default (CIS 4.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking device compliance default action..."
    $complianceSettings = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/deviceManagement/settings' -ErrorAction Stop

    $markNonCompliant = $complianceSettings['deviceComplianceCheckinThresholdDays']
    # A low threshold (or specific config) means devices are flagged quickly
    if ($null -ne $markNonCompliant) {
        Add-Setting -Category 'Device Compliance' `
            -Setting 'Non-Compliant Default Threshold' `
            -CurrentValue "$markNonCompliant days" `
            -RecommendedValue 'Devices without policy marked non-compliant' `
            -Status $(if ([int]$markNonCompliant -le 30) { 'Pass' } else { 'Warning' }) `
            -CheckId 'INTUNE-COMPLIANCE-001' `
            -Remediation 'Intune admin center > Devices > Compliance > Compliance policy settings > Mark devices with no compliance policy assigned as > Not compliant.'
    }
    else {
        Add-Setting -Category 'Device Compliance' `
            -Setting 'Non-Compliant Default Threshold' `
            -CurrentValue 'Setting not available' `
            -RecommendedValue 'Devices without policy marked non-compliant' `
            -Status 'Review' `
            -CheckId 'INTUNE-COMPLIANCE-001' `
            -Remediation 'Intune admin center > Devices > Compliance > Compliance policy settings > verify non-compliant default.'
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        Add-Setting -Category 'Device Compliance' `
            -Setting 'Non-Compliant Default Threshold' `
            -CurrentValue 'Insufficient permissions or license (Intune required)' `
            -RecommendedValue 'Devices without policy marked non-compliant' `
            -Status 'Review' `
            -CheckId 'INTUNE-COMPLIANCE-001' `
            -Remediation 'This check requires Intune license and DeviceManagementConfiguration.Read.All permission.'
    }
    else {
        Write-Warning "Could not check device compliance settings: $_"
    }
}

# ------------------------------------------------------------------
# 2. Device Enrollment Restrictions (CIS 4.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking device enrollment restrictions..."
    $enrollConfigs = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/deviceManagement/deviceEnrollmentConfigurations' -ErrorAction Stop

    $enrollConfigList = if ($enrollConfigs -and $enrollConfigs['value']) { @($enrollConfigs['value']) } else { @() }
    $platformRestrictions = $enrollConfigList | Where-Object {
        $_['@odata.type'] -eq '#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration'
    }

    if ($platformRestrictions) {
        # Check if personal devices are blocked on major platforms
        $personalBlocked = $true
        foreach ($restriction in $platformRestrictions) {
            $platforms = @('iosRestriction', 'androidRestriction', 'windowsRestriction')
            foreach ($platform in $platforms) {
                $config = $restriction[$platform]
                if ($config -and $config['personalDeviceEnrollmentBlocked'] -ne $true) {
                    $personalBlocked = $false
                }
            }
        }

        Add-Setting -Category 'Device Enrollment' `
            -Setting 'Personal Device Enrollment Blocked' `
            -CurrentValue $(if ($personalBlocked) { 'Blocked on all platforms' } else { 'Allowed on some platforms' }) `
            -RecommendedValue 'Block personal device enrollment' `
            -Status $(if ($personalBlocked) { 'Pass' } else { 'Fail' }) `
            -CheckId 'INTUNE-ENROLL-001' `
            -Remediation 'Intune admin center > Devices > Enrollment > Device platform restrictions > Edit default policy > Block personally owned devices for each platform.'
    }
    else {
        Add-Setting -Category 'Device Enrollment' `
            -Setting 'Personal Device Enrollment Blocked' `
            -CurrentValue 'No platform restriction policies found' `
            -RecommendedValue 'Block personal device enrollment' `
            -Status 'Fail' `
            -CheckId 'INTUNE-ENROLL-001' `
            -Remediation 'Configure device enrollment restrictions. Intune admin center > Devices > Enrollment > Device platform restrictions > Create platform restriction.'
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        Add-Setting -Category 'Device Enrollment' `
            -Setting 'Personal Device Enrollment Blocked' `
            -CurrentValue 'Insufficient permissions or license (Intune required)' `
            -RecommendedValue 'Block personal device enrollment' `
            -Status 'Review' `
            -CheckId 'INTUNE-ENROLL-001' `
            -Remediation 'This check requires Intune license and DeviceManagementConfiguration.Read.All permission.'
    }
    else {
        Write-Warning "Could not check device enrollment restrictions: $_"
    }
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Intune security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Intune security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
