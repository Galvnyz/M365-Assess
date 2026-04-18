<#
.SYNOPSIS
    Reports Microsoft Teams tenant-wide access and app settings.
.DESCRIPTION
    Queries Microsoft Graph for Teams application settings and group-level
    configuration that governs guest access, third-party app policies, and
    sideloading. Uses the beta endpoint for Teams app settings and the v1.0
    endpoint for group settings (guest access). Gracefully degrades if the
    beta endpoint is unavailable.

    Essential for M365 security assessments and Teams governance reviews.

    Requires Microsoft Graph connection with TeamSettings.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'TeamSettings.Read.All'
    PS> .\Collaboration\Get-TeamsAccessReport.ps1

    Displays Teams access and app settings in the console.
.EXAMPLE
    PS> .\Collaboration\Get-TeamsAccessReport.ps1 -OutputPath '.\teams-access-settings.csv'

    Exports Teams access settings to CSV for documentation.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Initialize result properties with defaults
$allowGuestAccess = $null
$allowGuestCreateUpdateChannels = $null
$allowThirdPartyApps = $null
$allowSideLoading = $null
$isUserPersonalScopeResourceSpecificConsentEnabled = $null

# Retrieve Teams app settings from beta endpoint
try {
    Write-Verbose "Retrieving Teams app settings from beta endpoint..."
    $teamsAppSettings = Invoke-MgGraphRequest -Uri '/beta/teamwork/teamsAppSettings' -Method GET

    $allowSideLoading = $teamsAppSettings.isChatResourceSpecificConsentEnabled
    $isUserPersonalScopeResourceSpecificConsentEnabled = $teamsAppSettings.isUserPersonalScopeResourceSpecificConsentEnabled
}
catch {
    if ("$_" -match '412|PreconditionFailed|not supported in application-only') {
        Write-Verbose "Teams app settings beta endpoint unavailable in app-only auth — some settings will be N/A."
    }
    else {
        Write-Warning "Teams app settings (beta) endpoint unavailable. Some settings will be reported as N/A. Error: $_"
    }
}

# Retrieve group settings for guest access configuration
try {
    Write-Verbose "Retrieving group settings for guest access policies..."
    $groupSettingsResponse = Invoke-MgGraphRequest -Uri '/v1.0/groupSettings' -Method GET

    $groupSettingsList = $groupSettingsResponse.value
    $guestSettings = $null

    foreach ($setting in $groupSettingsList) {
        if ($setting.displayName -eq 'Group.Unified.Guest') {
            $guestSettings = $setting
            break
        }
    }

    # If no dedicated guest setting, check Group.Unified for guest values
    if (-not $guestSettings) {
        foreach ($setting in $groupSettingsList) {
            if ($setting.displayName -eq 'Group.Unified') {
                $guestSettings = $setting
                break
            }
        }
    }

    if ($guestSettings -and $guestSettings.values) {
        foreach ($valuePair in $guestSettings.values) {
            switch ($valuePair.name) {
                'AllowGuestsToAccessGroups' {
                    $allowGuestAccess = [System.Convert]::ToBoolean($valuePair.value)
                }
                'AllowGuestsToBeGroupOwner' {
                    # Captured but not primary output; useful context
                }
                'AllowToAddGuests' {
                    if ($null -eq $allowGuestAccess) {
                        $allowGuestAccess = [System.Convert]::ToBoolean($valuePair.value)
                    }
                }
            }
        }
    }
}
catch {
    Write-Warning "Failed to retrieve group settings for guest access. Guest access values may be incomplete. Error: $_"
}

# Try to get tenant-wide Teams settings via service-specific beta endpoint
try {
    Write-Verbose "Retrieving tenant-wide Teams configuration..."
    $tenantConfig = Invoke-MgGraphRequest -Uri '/beta/teamwork' -Method GET

    if ($null -ne $tenantConfig) {
        if ($tenantConfig.PSObject.Properties.Name -contains 'isGuestAccessEnabled' -or
            $tenantConfig.ContainsKey('isGuestAccessEnabled')) {
            $allowGuestAccess = $tenantConfig.isGuestAccessEnabled
        }
        if ($tenantConfig.PSObject.Properties.Name -contains 'allowGuestCreateUpdateChannels' -or
            $tenantConfig.ContainsKey('allowGuestCreateUpdateChannels')) {
            $allowGuestCreateUpdateChannels = $tenantConfig.allowGuestCreateUpdateChannels
        }
        if ($tenantConfig.PSObject.Properties.Name -contains 'allowThirdPartyApps' -or
            $tenantConfig.ContainsKey('allowThirdPartyApps')) {
            $allowThirdPartyApps = $tenantConfig.allowThirdPartyApps
        }
    }
}
catch {
    Write-Verbose "Tenant-wide teamwork endpoint did not return extended properties (non-critical)."
}

# Build the report
$report = @([PSCustomObject]@{
    AllowGuestAccess                                    = if ($null -ne $allowGuestAccess) { $allowGuestAccess } else { 'N/A' }
    AllowGuestCreateUpdateChannels                      = if ($null -ne $allowGuestCreateUpdateChannels) { $allowGuestCreateUpdateChannels } else { 'N/A' }
    AllowThirdPartyApps                                 = if ($null -ne $allowThirdPartyApps) { $allowThirdPartyApps } else { 'N/A' }
    AllowSideLoading                                    = if ($null -ne $allowSideLoading) { $allowSideLoading } else { 'N/A' }
    IsUserPersonalScopeResourceSpecificConsentEnabled   = if ($null -ne $isUserPersonalScopeResourceSpecificConsentEnabled) { $isUserPersonalScopeResourceSpecificConsentEnabled } else { 'N/A' }
})

Write-Verbose "Successfully compiled Teams access settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Teams access settings to $OutputPath"
}
else {
    Write-Output $report
}
