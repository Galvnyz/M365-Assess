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
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
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
# B2B Integration (CIS 7.2.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking B2B integration for SharePoint/OneDrive..."
    # Check via beta endpoint for B2B integration property
    $betaSpoSettings = $null
    try {
        $betaSpoSettings = Invoke-MgGraphRequest -Method GET `
            -Uri '/beta/admin/sharepoint/settings' -ErrorAction Stop
    }
    catch {
        Write-Verbose "Beta SharePoint settings endpoint not available: $_"
    }

    if ($betaSpoSettings -and $null -ne $betaSpoSettings['isB2BIntegrationEnabled']) {
        $b2bEnabled = $betaSpoSettings['isB2BIntegrationEnabled']
        Add-Setting -Category 'Authentication' `
            -Setting 'SharePoint B2B Integration' `
            -CurrentValue "$b2bEnabled" -RecommendedValue 'True' `
            -Status $(if ($b2bEnabled) { 'Pass' } else { 'Fail' }) `
            -CheckId 'SPO-B2B-001' `
            -Remediation 'Enable B2B integration in SharePoint admin center > Policies > Sharing > More external sharing settings > Enable integration with Azure AD B2B.'
    }
    else {
        Add-Setting -Category 'Authentication' `
            -Setting 'SharePoint B2B Integration' `
            -CurrentValue 'Not available via Graph API' -RecommendedValue 'True' `
            -Status 'Review' `
            -CheckId 'SPO-B2B-001' `
            -Remediation 'SharePoint admin center > Policies > Sharing > More external sharing settings > check Enable integration with Azure AD B2B.'
    }
}
catch {
    Write-Warning "Could not check B2B integration: $_"
}

# ------------------------------------------------------------------
# OneDrive Sharing Restriction (CIS 7.2.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking OneDrive sharing capability..."
    if ($betaSpoSettings -and $null -ne $betaSpoSettings['oneDriveSharingCapability']) {
        $odSharing = $betaSpoSettings['oneDriveSharingCapability']
        $isRestricted = $odSharing -ne 'externalUserAndGuestSharing'

        $odDisplay = switch ($odSharing) {
            'disabled'                    { 'Disabled (no sharing)' }
            'externalUserSharingOnly'     { 'Existing guests only' }
            'externalUserAndGuestSharing' { 'Anyone (most permissive)' }
            'existingExternalUserSharingOnly' { 'Existing guests only' }
            default { $odSharing }
        }

        Add-Setting -Category 'Sharing' `
            -Setting 'OneDrive External Sharing' `
            -CurrentValue $odDisplay -RecommendedValue 'Existing guests only or more restrictive' `
            -Status $(if ($isRestricted) { 'Pass' } else { 'Fail' }) `
            -CheckId 'SPO-OD-001' `
            -Remediation 'SharePoint admin center > Policies > Sharing > OneDrive > set to "Existing guests" or more restrictive.'
    }
    else {
        Add-Setting -Category 'Sharing' `
            -Setting 'OneDrive External Sharing' `
            -CurrentValue 'Not available via Graph API' -RecommendedValue 'Restricted' `
            -Status 'Review' `
            -CheckId 'SPO-OD-001' `
            -Remediation 'SharePoint admin center > Policies > Sharing > OneDrive > verify sharing level.'
    }
}
catch {
    Write-Warning "Could not check OneDrive sharing: $_"
}

# ------------------------------------------------------------------
# Infected File Download Blocked (CIS 7.3.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking infected file download blocking..."
    if ($betaSpoSettings -and $null -ne $betaSpoSettings['disallowInfectedFileDownload']) {
        $blockInfected = $betaSpoSettings['disallowInfectedFileDownload']
        Add-Setting -Category 'Malware Protection' `
            -Setting 'Infected File Download Blocked' `
            -CurrentValue "$blockInfected" -RecommendedValue 'True' `
            -Status $(if ($blockInfected) { 'Pass' } else { 'Fail' }) `
            -CheckId 'SPO-MALWARE-002' `
            -Remediation 'Run: Set-SPOTenant -DisallowInfectedFileDownload $true. SharePoint admin center > Policies > Malware protection.'
    }
    else {
        Add-Setting -Category 'Malware Protection' `
            -Setting 'Infected File Download Blocked' `
            -CurrentValue 'Not available via Graph API' -RecommendedValue 'True' `
            -Status 'Review' `
            -CheckId 'SPO-MALWARE-002' `
            -Remediation 'Connect via SharePoint Online Management Shell: Get-SPOTenant | Select DisallowInfectedFileDownload. Set to $true if not already.'
    }
}
catch {
    Write-Warning "Could not check infected file download setting: $_"
}

# ------------------------------------------------------------------
# External Sharing Restricted by Security Group (CIS 7.2.8)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking external sharing security group restriction..."
    if ($betaSpoSettings -and $null -ne $betaSpoSettings['sharingCapability']) {
        # Security group sharing restriction is only available via SPO PowerShell
        # Graph API does not expose OnlyAllowMembersOfSpecificSecurityGroupsToShareExternally
        Add-Setting -Category 'Sharing' `
            -Setting 'External Sharing Restricted by Security Group' `
            -CurrentValue 'Requires SPO PowerShell verification' `
            -RecommendedValue 'Enabled (specific security groups only)' `
            -Status 'Review' `
            -CheckId 'SPO-SHARING-008' `
            -Remediation 'SharePoint admin center > Policies > Sharing > More external sharing settings > "Allow only users in specific security groups to share externally". Verify via: Get-SPOTenant | Select OnlyAllowMembersOfSpecificSecurityGroupsToShareExternally.'
    }
    else {
        Add-Setting -Category 'Sharing' `
            -Setting 'External Sharing Restricted by Security Group' `
            -CurrentValue 'SharePoint settings not available' `
            -RecommendedValue 'Enabled (specific security groups only)' `
            -Status 'Review' `
            -CheckId 'SPO-SHARING-008' `
            -Remediation 'SharePoint admin center > Policies > Sharing > More external sharing settings > enable security group restriction for external sharing.'
    }
}
catch {
    Write-Warning "Could not check external sharing security group restriction: $_"
}

# ------------------------------------------------------------------
# Custom Script Execution on Personal Sites (CIS 7.3.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking custom script execution on personal sites..."
    # Custom script settings are not exposed via Graph API
    # They require SPO PowerShell: Get-SPOSite -Identity <OneDrive-URL> | Select DenyAddAndCustomizePages
    Add-Setting -Category 'Script Execution' `
        -Setting 'Custom Script on Personal Sites' `
        -CurrentValue 'Requires SPO PowerShell verification' `
        -RecommendedValue 'DenyAddAndCustomizePages = Enabled' `
        -Status 'Review' `
        -CheckId 'SPO-SCRIPT-001' `
        -Remediation 'Run: Set-SPOSite -Identity <PersonalSiteUrl> -DenyAddAndCustomizePages 1. SharePoint admin center > Settings > Custom Script > prevent users from running custom script on personal sites.'
}
catch {
    Write-Warning "Could not check custom script on personal sites: $_"
}

# ------------------------------------------------------------------
# Custom Script Execution on Self-Service Sites (CIS 7.3.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking custom script execution on self-service created sites..."
    # Custom script settings are not exposed via Graph API
    # They require SPO PowerShell: Get-SPOTenant | Select DenyAddAndCustomizePagesForSitesCreatedByUser
    Add-Setting -Category 'Script Execution' `
        -Setting 'Custom Script on Self-Service Sites' `
        -CurrentValue 'Requires SPO PowerShell verification' `
        -RecommendedValue 'DenyAddAndCustomizePages = Enabled' `
        -Status 'Review' `
        -CheckId 'SPO-SCRIPT-002' `
        -Remediation 'Run: Set-SPOTenant -DenyAddAndCustomizePagesForSitesCreatedByUser 1. SharePoint admin center > Settings > Custom Script > prevent users from running custom script on self-service created sites.'
}
catch {
    Write-Warning "Could not check custom script on self-service sites: $_"
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
