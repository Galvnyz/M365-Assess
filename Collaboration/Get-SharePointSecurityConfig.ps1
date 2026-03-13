<#
.SYNOPSIS
    Collects SharePoint Online and OneDrive security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Microsoft Graph and SharePoint admin settings for security-relevant configuration
    including external sharing levels, default link types, re-sharing controls, sync client
    restrictions, and legacy authentication. Returns a structured inventory of settings with
    current values and CIS benchmark recommendations.

    Requires Microsoft Graph connection with SharePointTenantSettings.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'SharePointTenantSettings.Read.All'
    PS> .\Collaboration\Get-SharePointSecurityConfig.ps1

    Displays SharePoint and OneDrive security configuration settings.
.EXAMPLE
    PS> .\Collaboration\Get-SharePointSecurityConfig.ps1 -OutputPath '.\spo-security-config.csv'

    Exports the security configuration to CSV.
.NOTES
    Version: 0.7.0
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
try {
    $context = Get-MgContext
    if (-not $context) {
        Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
        return
    }
}
catch {
    Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
    return
}

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
        Update-CheckProgress -CheckId $CheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# Retrieve SharePoint tenant settings
# ------------------------------------------------------------------
$spoSettings = $null
try {
    Write-Verbose "Retrieving SharePoint tenant settings..."
    $spoSettings = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/admin/sharepoint/settings' -ErrorAction Stop
}
catch {
    Write-Warning "Could not retrieve SharePoint tenant settings: $_"
}

if (-not $spoSettings) {
    Write-Warning "No SharePoint settings retrieved. Cannot perform security assessment."
    if ($OutputPath) {
        @() | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
        Write-Output "Exported empty SPO security config to $OutputPath"
    }
    return
}

# ------------------------------------------------------------------
# 1. External Sharing Level
# ------------------------------------------------------------------
try {
    $sharingCapability = $spoSettings['sharingCapability']

    $sharingDisplay = switch ($sharingCapability) {
        'disabled'                    { 'Disabled (no external sharing)' }
        'externalUserSharingOnly'     { 'External users only (require sign-in)' }
        'externalUserAndGuestSharing' { 'External users and guests (anyone with link)' }
        'existingExternalUserSharingOnly' { 'Existing external users only' }
        default { $sharingCapability }
    }

    $sharingStatus = switch ($sharingCapability) {
        'disabled'                    { 'Pass' }
        'existingExternalUserSharingOnly' { 'Pass' }
        'externalUserSharingOnly'     { 'Review' }
        'externalUserAndGuestSharing' { 'Warning' }
        default { 'Review' }
    }

    Add-Setting -Category 'External Sharing' -Setting 'SharePoint External Sharing Level' `
        -CurrentValue $sharingDisplay `
        -RecommendedValue 'Existing external users only (or more restrictive)' `
        -Status $sharingStatus `
        -CheckId 'SPO-SHARING-001' `
        -Remediation 'Run: Set-SPOTenant -SharingCapability ExistingExternalUserSharingOnly. SharePoint admin center > Policies > Sharing.'
}
catch {
    Write-Warning "Could not check sharing capability: $_"
}

# ------------------------------------------------------------------
# 2. Resharing by External Users
# ------------------------------------------------------------------
try {
    $resharing = $spoSettings['isResharingByExternalUsersEnabled']
    Add-Setting -Category 'External Sharing' -Setting 'Resharing by External Users' `
        -CurrentValue "$resharing" -RecommendedValue 'False' `
        -Status $(if (-not $resharing) { 'Pass' } else { 'Warning' }) `
        -CheckId 'SPO-SHARING-002' `
        -Remediation 'Run: Set-SPOTenant -PreventExternalUsersFromResharing $true. SharePoint admin center > Policies > Sharing.'
}
catch {
    Write-Warning "Could not check resharing: $_"
}

# ------------------------------------------------------------------
# 3. Sharing Domain Restriction Mode
# ------------------------------------------------------------------
try {
    $domainRestriction = $spoSettings['sharingDomainRestrictionMode']

    $restrictDisplay = switch ($domainRestriction) {
        'none'       { 'No restriction' }
        'allowList'  { 'Allow list (specific domains only)' }
        'blockList'  { 'Block list (block specific domains)' }
        default { $domainRestriction }
    }

    $restrictStatus = switch ($domainRestriction) {
        'none'       { 'Review' }
        'allowList'  { 'Pass' }
        'blockList'  { 'Pass' }
        default { 'Review' }
    }

    Add-Setting -Category 'External Sharing' -Setting 'Sharing Domain Restriction' `
        -CurrentValue $restrictDisplay `
        -RecommendedValue 'Allow or Block list configured' `
        -Status $restrictStatus `
        -CheckId 'SPO-SHARING-003' `
        -Remediation 'Run: Set-SPOTenant -SharingDomainRestrictionMode AllowList -SharingAllowedDomainList "partner.com". SharePoint admin center > Policies > Sharing > Limit sharing by domain.'
}
catch {
    Write-Warning "Could not check domain restriction: $_"
}

# ------------------------------------------------------------------
# 4. Unmanaged Sync Client Restriction
# ------------------------------------------------------------------
try {
    $unmanagedSync = $spoSettings['isUnmanagedSyncClientRestricted']
    Add-Setting -Category 'Sync & Access' -Setting 'Block Sync from Unmanaged Devices' `
        -CurrentValue "$unmanagedSync" -RecommendedValue 'True' `
        -Status $(if ($unmanagedSync) { 'Pass' } else { 'Warning' }) `
        -CheckId 'SPO-SYNC-001' `
        -Remediation 'Run: Set-SPOTenantSyncClientRestriction -Enable. SharePoint admin center > Settings > Sync > Allow syncing only on computers joined to specific domains.'
}
catch {
    Write-Warning "Could not check sync client restriction: $_"
}

# ------------------------------------------------------------------
# 5. Mac Sync App
# ------------------------------------------------------------------
try {
    $macSync = $spoSettings['isMacSyncAppEnabled']
    Add-Setting -Category 'Sync & Access' -Setting 'Mac Sync App Enabled' `
        -CurrentValue "$macSync" -RecommendedValue 'Review' `
        -Status 'Info' `
        -CheckId 'SPO-SYNC-002' `
        -Remediation 'Informational — review based on organizational requirements.'
}
catch {
    Write-Warning "Could not check Mac sync: $_"
}

# ------------------------------------------------------------------
# 6. Loop Enabled
# ------------------------------------------------------------------
try {
    $loopEnabled = $spoSettings['isLoopEnabled']
    Add-Setting -Category 'Collaboration Features' -Setting 'Loop Components Enabled' `
        -CurrentValue "$loopEnabled" -RecommendedValue 'Review' `
        -Status 'Info' `
        -CheckId 'SPO-LOOP-001' `
        -Remediation 'Informational — review based on organizational requirements.'
}
catch {
    Write-Warning "Could not check Loop: $_"
}

# ------------------------------------------------------------------
# 7. OneDrive Loop Sharing Capability
# ------------------------------------------------------------------
try {
    $loopSharing = $spoSettings['oneDriveLoopSharingCapability']

    $loopSharingDisplay = switch ($loopSharing) {
        'disabled'                    { 'Disabled' }
        'externalUserSharingOnly'     { 'External users only' }
        'externalUserAndGuestSharing' { 'External users and guests' }
        'existingExternalUserSharingOnly' { 'Existing external users only' }
        default { $loopSharing }
    }

    Add-Setting -Category 'Collaboration Features' -Setting 'OneDrive Loop Sharing' `
        -CurrentValue $loopSharingDisplay -RecommendedValue 'Restricted or disabled' `
        -Status 'Info' `
        -CheckId 'SPO-LOOP-002' `
        -Remediation 'Informational — review based on organizational requirements.'
}
catch {
    Write-Warning "Could not check Loop sharing: $_"
}

# ------------------------------------------------------------------
# 8. Idle Session Timeout (via Graph beta)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking idle session timeout policy..."
    $idlePolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/activityBasedTimeoutPolicies' -ErrorAction SilentlyContinue

    if ($idlePolicy -and $idlePolicy['value'] -and @($idlePolicy['value']).Count -gt 0) {
        Add-Setting -Category 'Sync & Access' -Setting 'Idle Session Timeout Policy' `
            -CurrentValue 'Configured' -RecommendedValue 'Configured' -Status 'Pass' `
            -CheckId 'SPO-SESSION-001' `
            -Remediation 'Run: Set-SPOBrowserIdleSignOut -Enabled $true -SignOutAfter ''01:00:00''. M365 admin center > Settings > Org settings > Idle session timeout.'
    }
    else {
        Add-Setting -Category 'Sync & Access' -Setting 'Idle Session Timeout Policy' `
            -CurrentValue 'Not configured' -RecommendedValue 'Configured' -Status 'Warning' `
            -CheckId 'SPO-SESSION-001' `
            -Remediation 'Run: Set-SPOBrowserIdleSignOut -Enabled $true -SignOutAfter ''01:00:00''. M365 admin center > Settings > Org settings > Idle session timeout.'
    }
}
catch {
    Write-Warning "Could not check idle session timeout: $_"
}

# ------------------------------------------------------------------
# 9. Default Sharing Link Type (CIS 7.2.7)
# ------------------------------------------------------------------
try {
    $defaultLinkType = $spoSettings['defaultSharingLinkType']

    $linkTypeDisplay = switch ($defaultLinkType) {
        'specificPeople'  { 'Specific people (direct)' }
        'organization'    { 'People in the organization' }
        'anyone'          { 'Anyone with the link' }
        default { if ($defaultLinkType) { $defaultLinkType } else { 'Not available via API' } }
    }

    $linkTypeStatus = switch ($defaultLinkType) {
        'specificPeople'  { 'Pass' }
        'organization'    { 'Review' }
        'anyone'          { 'Fail' }
        default { 'Review' }
    }

    Add-Setting -Category 'External Sharing' -Setting 'Default Sharing Link Type' `
        -CurrentValue $linkTypeDisplay `
        -RecommendedValue 'Specific people (direct)' `
        -Status $linkTypeStatus `
        -CheckId 'SPO-SHARING-004' `
        -Remediation 'Run: Set-SPOTenant -DefaultSharingLinkType Direct. SharePoint admin center > Policies > Sharing > File and folder links > Default link type > Specific people.'
}
catch {
    Write-Warning "Could not check default sharing link type: $_"
}

# ------------------------------------------------------------------
# 10. Guest Access Expiration (CIS 7.2.9)
# ------------------------------------------------------------------
try {
    $guestExpRequired = $spoSettings['externalUserExpirationRequired']
    $guestExpDays = $spoSettings['externalUserExpireInDays']

    if ($null -eq $guestExpRequired) {
        Add-Setting -Category 'External Sharing' -Setting 'Guest Access Expiration' `
            -CurrentValue 'Not available via API' -RecommendedValue 'Enabled (30 days or less)' `
            -Status 'Review' `
            -CheckId 'SPO-SHARING-005' `
            -Remediation 'Run: Set-SPOTenant -ExternalUserExpirationRequired $true -ExternalUserExpireInDays 30. SharePoint admin center > Policies > Sharing > Guest access expiration.'
    }
    else {
        $expDisplay = if ($guestExpRequired) { "Enabled ($guestExpDays days)" } else { 'Disabled' }
        $expStatus = if ($guestExpRequired -and $guestExpDays -le 30) { 'Pass' }
                     elseif ($guestExpRequired) { 'Warning' }
                     else { 'Fail' }

        Add-Setting -Category 'External Sharing' -Setting 'Guest Access Expiration' `
            -CurrentValue $expDisplay -RecommendedValue 'Enabled (30 days or less)' `
            -Status $expStatus `
            -CheckId 'SPO-SHARING-005' `
            -Remediation 'Run: Set-SPOTenant -ExternalUserExpirationRequired $true -ExternalUserExpireInDays 30. SharePoint admin center > Policies > Sharing > Guest access expiration.'
    }
}
catch {
    Write-Warning "Could not check guest access expiration: $_"
}

# ------------------------------------------------------------------
# 11. Reauthentication with Verification Code (CIS 7.2.10)
# ------------------------------------------------------------------
try {
    $emailAttestation = $spoSettings['emailAttestationRequired']
    $emailAttestDays = $spoSettings['emailAttestationReAuthDays']

    if ($null -eq $emailAttestation) {
        Add-Setting -Category 'External Sharing' -Setting 'Reauthentication with Verification Code' `
            -CurrentValue 'Not available via API' -RecommendedValue 'Enabled (30 days or less)' `
            -Status 'Review' `
            -CheckId 'SPO-SHARING-006' `
            -Remediation 'Run: Set-SPOTenant -EmailAttestationRequired $true -EmailAttestationReAuthDays 30. SharePoint admin center > Policies > Sharing > Verification code reauthentication.'
    }
    else {
        $attestDisplay = if ($emailAttestation) { "Enabled ($emailAttestDays days)" } else { 'Disabled' }
        $attestStatus = if ($emailAttestation -and $emailAttestDays -le 30) { 'Pass' }
                        elseif ($emailAttestation) { 'Warning' }
                        else { 'Fail' }

        Add-Setting -Category 'External Sharing' -Setting 'Reauthentication with Verification Code' `
            -CurrentValue $attestDisplay -RecommendedValue 'Enabled (30 days or less)' `
            -Status $attestStatus `
            -CheckId 'SPO-SHARING-006' `
            -Remediation 'Run: Set-SPOTenant -EmailAttestationRequired $true -EmailAttestationReAuthDays 30. SharePoint admin center > Policies > Sharing > Verification code reauthentication.'
    }
}
catch {
    Write-Warning "Could not check email attestation: $_"
}

# ------------------------------------------------------------------
# 12. Default Link Permission (CIS 7.2.11)
# ------------------------------------------------------------------
try {
    $defaultPerm = $spoSettings['defaultLinkPermission']

    $permDisplay = switch ($defaultPerm) {
        'view' { 'View (read-only)' }
        'edit' { 'Edit' }
        default { if ($defaultPerm) { $defaultPerm } else { 'Not available via API' } }
    }

    $permStatus = switch ($defaultPerm) {
        'view' { 'Pass' }
        'edit' { 'Warning' }
        default { 'Review' }
    }

    Add-Setting -Category 'External Sharing' -Setting 'Default Sharing Link Permission' `
        -CurrentValue $permDisplay `
        -RecommendedValue 'View (read-only)' `
        -Status $permStatus `
        -CheckId 'SPO-SHARING-007' `
        -Remediation 'Run: Set-SPOTenant -DefaultLinkPermission View. SharePoint admin center > Policies > Sharing > File and folder links > Default permission > View.'
}
catch {
    Write-Warning "Could not check default link permission: $_"
}

# ------------------------------------------------------------------
# 13. Legacy Authentication Protocols (CIS 7.2.1)
# ------------------------------------------------------------------
try {
    $legacyAuth = $spoSettings['legacyAuthProtocolsEnabled']
    if ($null -ne $legacyAuth) {
        Add-Setting -Category 'Authentication' -Setting 'Legacy Authentication Protocols' `
            -CurrentValue "$legacyAuth" -RecommendedValue 'False' `
            -Status $(if (-not $legacyAuth) { 'Pass' } else { 'Fail' }) `
            -CheckId 'SPO-AUTH-001' `
            -Remediation 'Run: Set-SPOTenant -LegacyAuthProtocolsEnabled $false. SharePoint admin center > Policies > Access control > Apps that do not use modern authentication > Block access.'
    }
    else {
        Add-Setting -Category 'Authentication' -Setting 'Legacy Authentication Protocols' `
            -CurrentValue 'Not available via API' -RecommendedValue 'False' `
            -Status 'Review' `
            -CheckId 'SPO-AUTH-001' `
            -Remediation 'Check via SharePoint admin center > Policies > Access control > Apps that do not use modern authentication.'
    }
}
catch {
    Write-Warning "Could not check legacy authentication: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) SharePoint/OneDrive security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported SharePoint security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
