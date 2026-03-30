<#
.SYNOPSIS
    Collects Microsoft Teams security and meeting configuration settings.
.DESCRIPTION
    Queries Microsoft Graph for Teams security-relevant settings including meeting
    policies, external access, messaging policies, and third-party app restrictions.
    Returns a structured inventory of settings with current values and CIS benchmark
    recommendations.

    Requires the following Graph API permissions:
    TeamSettings.Read.All, TeamworkAppSettings.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'TeamSettings.Read.All','TeamworkAppSettings.Read.All'
    PS> .\Collaboration\Get-TeamsSecurityConfig.ps1

    Displays Teams security configuration settings.
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
$context = Get-MgContext

# Detect app-only auth — Teams Graph APIs (/v1.0/teamwork/*) do not support
# application-only context and return HTTP 412 "not supported in application-only context".
$isAppOnly = $context.AuthType -eq 'AppOnly' -or (-not $context.Account -and $context.AppName)
if ($isAppOnly) {
    Write-Warning "Teams Graph APIs do not support app-only (certificate) authentication. Teams security checks require delegated (interactive) auth. Skipping Teams collector."
    Write-Output @()
    return
}

# Detect whether the tenant has any Teams-capable licenses.
# If no Teams service plans are assigned, the /teamwork/* Graph endpoints return
# 400/404 errors, producing misleading warnings in the assessment log.
try {
    $subscribedSkus = Get-MgSubscribedSku -ErrorAction Stop
    $teamsServicePlanIds = @(
        '57ff2da0-773e-42df-b2af-ffb7a2317929'  # TEAMS1 (standard Teams service plan)
        '4a51bca5-1eff-43f5-878c-177680f191af'  # TEAMS1 (Gov)
    )
    $hasTeams = $false
    foreach ($sku in $subscribedSkus) {
        if ($sku.ConsumedUnits -gt 0) {
            foreach ($sp in $sku.ServicePlans) {
                if ($sp.ServicePlanId -in $teamsServicePlanIds -and $sp.ProvisioningStatus -ne 'Disabled') {
                    $hasTeams = $true
                    break
                }
            }
        }
        if ($hasTeams) { break }
    }
    if (-not $hasTeams) {
        Write-Warning "No Teams licenses detected in this tenant. Skipping Teams security checks to avoid false errors."
        Write-Output @()
        return
    }
}
catch {
    # If we can't check licenses, proceed with Teams checks and let them fail naturally
    Write-Warning "Could not verify Teams licensing: $($_.Exception.Message). Proceeding with Teams checks."
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
# 1. Teams Client Configuration (external access)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams external access settings..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/teamwork/teamsAppSettings'
        ErrorAction = 'Stop'
    }
    $teamsSettings = Invoke-MgGraphRequest @graphParams

    $isSideloadingAllowed = $teamsSettings['isChatResourceSpecificConsentEnabled']
    $settingParams = @{
        Category         = 'Teams Apps'
        Setting          = 'Chat Resource-Specific Consent'
        CurrentValue     = "$isSideloadingAllowed"
        RecommendedValue = 'False'
        Status           = if (-not $isSideloadingAllowed) { 'Pass' } else { 'Review' }
        CheckId          = 'TEAMS-APPS-001'
        Remediation      = 'Run: Set-CsTeamsAppPermissionPolicy -DefaultCatalogAppsType AllowedAppList. Teams admin center > Teams apps > Permission policies.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not retrieve Teams app settings: $_"
}

# ------------------------------------------------------------------
# 1b. Teams Client Configuration — unmanaged users (CIS 8.2.2, 8.2.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams client configuration for unmanaged users..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/teamwork/teamsClientConfiguration'
        ErrorAction = 'Stop'
    }
    $teamsClientConfig = Invoke-MgGraphRequest @graphParams

    if ($teamsClientConfig) {
        $allowConsumer = $teamsClientConfig['allowTeamsConsumer']
        $allowConsumerInbound = $teamsClientConfig['allowTeamsConsumerInbound']

        $settingParams = @{
            Category         = 'External Access'
            Setting          = 'Communication with Unmanaged Teams Users'
            CurrentValue     = "$allowConsumer"
            RecommendedValue = 'False'
            Status           = if (-not $allowConsumer) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-EXTACCESS-001'
            Remediation      = 'Run: Set-CsTenantFederationConfiguration -AllowTeamsConsumer $false. Teams admin center > Users > External access > Teams accounts not managed by an organization > Off.'
        }
        Add-Setting @settingParams

        $settingParams = @{
            Category         = 'External Access'
            Setting          = 'External Unmanaged Users Can Initiate Conversations'
            CurrentValue     = "$allowConsumerInbound"
            RecommendedValue = 'False'
            Status           = if (-not $allowConsumerInbound) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-EXTACCESS-002'
            Remediation      = 'Run: Set-CsTenantFederationConfiguration -AllowTeamsConsumerInbound $false. Teams admin center > Users > External access > External users can initiate conversations > Off.'
        }
        Add-Setting @settingParams

        # CIS 8.1.1 — Third-party cloud storage restricted
        $cloudStorageKeys = @('allowDropBox', 'allowBox', 'allowGoogleDrive', 'allowShareFile', 'allowEgnyte')
        $enabledStores = @()
        foreach ($key in $cloudStorageKeys) {
            if ($teamsClientConfig.ContainsKey($key) -and $teamsClientConfig[$key]) {
                $enabledStores += $key -replace '^allow', ''
            }
        }
        $cloudStorageStatus = if ($enabledStores.Count -eq 0) { 'Pass' } else { 'Fail' }
        $settingParams = @{
            Category         = 'Client Configuration'
            Setting          = 'Third-Party Cloud Storage'
            CurrentValue     = if ($enabledStores.Count -eq 0) { 'All disabled' } else { "Enabled: $($enabledStores -join ', ')" }
            RecommendedValue = 'All disabled'
            Status           = $cloudStorageStatus
            CheckId          = 'TEAMS-CLIENT-001'
            Remediation      = 'Run: Set-CsTeamsClientConfiguration -AllowDropBox $false -AllowBox $false -AllowGoogleDrive $false -AllowShareFile $false -AllowEgnyte $false. Teams admin center > Messaging policies > Manage third-party storage.'
        }
        Add-Setting @settingParams

        # CIS 8.1.2 — Channel email disabled
        $allowEmail = $teamsClientConfig['allowEmailIntoChannel']
        $settingParams = @{
            Category         = 'Client Configuration'
            Setting          = 'Email Into Channel'
            CurrentValue     = "$allowEmail"
            RecommendedValue = 'False'
            Status           = if (-not $allowEmail) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-CLIENT-002'
            Remediation      = 'Run: Set-CsTeamsClientConfiguration -AllowEmailIntoChannel $false. Teams admin center > Teams settings > Email integration > Users can send emails to a channel email address > Off.'
        }
        Add-Setting @settingParams

        # CIS 8.2.1 — External domain access restricted
        $allowFederated = $teamsClientConfig['allowFederatedUsers']
        $allowedDomains = $teamsClientConfig['allowedDomains']
        $domainRestricted = (-not $allowFederated) -or ($allowedDomains -and $allowedDomains.Count -gt 0)
        $settingParams = @{
            Category         = 'External Access'
            Setting          = 'External Domain Access'
            CurrentValue     = if (-not $allowFederated) { 'Disabled' } elseif ($allowedDomains -and $allowedDomains.Count -gt 0) { "Restricted to $($allowedDomains.Count) domains" } else { 'Open to all domains' }
            RecommendedValue = 'Disabled or restricted to specific domains'
            Status           = if ($domainRestricted) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-EXTACCESS-003'
            Remediation      = 'Run: Set-CsTenantFederationConfiguration -AllowFederatedUsers $false (or restrict with -AllowedDomains). Teams admin center > Users > External access > Choose which external domains your users have access to > Allow only specific external domains.'
        }
        Add-Setting @settingParams

        # CIS 8.2.4 — Skype for Business interop disabled
        $allowPublicUsers = $teamsClientConfig['allowPublicUsers']
        $settingParams = @{
            Category         = 'External Access'
            Setting          = 'Skype for Business/Consumer Interop'
            CurrentValue     = "$allowPublicUsers"
            RecommendedValue = 'False'
            Status           = if (-not $allowPublicUsers) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-EXTACCESS-004'
            Remediation      = 'Run: Set-CsTenantFederationConfiguration -AllowPublicUsers $false. Teams admin center > Users > External access > Skype users > Off.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Teams client configuration endpoint unavailable: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# 2. Teams Meeting Policies (via beta API)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams meeting policy..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/teamwork/teamsMeetingPolicy'
        ErrorAction = 'Stop'
    }
    $meetingPolicy = Invoke-MgGraphRequest @graphParams

    if ($meetingPolicy) {
        $anonymousJoin = $meetingPolicy['allowAnonymousUsersToJoinMeeting']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Anonymous Users Can Join Meeting'
            CurrentValue     = "$anonymousJoin"
            RecommendedValue = 'False'
            Status           = if (-not $anonymousJoin) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-001'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $false. Teams admin center > Meetings > Meeting policies > Global > Anonymous users can join a meeting > Off.'
        }
        Add-Setting @settingParams

        # Anonymous/dial-in can't start meeting (CIS 8.5.2)
        $anonStart = $meetingPolicy['allowAnonymousUsersToStartMeeting']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Anonymous Users Can Start Meeting'
            CurrentValue     = "$anonStart"
            RecommendedValue = 'False'
            Status           = if (-not $anonStart) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-002'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToStartMeeting $false. Teams admin center > Meetings > Meeting policies > Global > Anonymous users can start a meeting > Off.'
        }
        Add-Setting @settingParams

        # Auto-admitted users / lobby bypass (CIS 8.5.3)
        $autoAdmit = $meetingPolicy['autoAdmittedUsers']
        $autoAdmitPass = $autoAdmit -eq 'EveryoneInCompanyExcludingGuests' -or $autoAdmit -eq 'EveryoneInSameAndFederatedCompany' -or $autoAdmit -eq 'OrganizerOnly' -or $autoAdmit -eq 'InvitedUsers'
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Auto-Admitted Users (Lobby Bypass)'
            CurrentValue     = "$autoAdmit"
            RecommendedValue = 'EveryoneInCompanyExcludingGuests or stricter'
            Status           = if ($autoAdmitPass) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-003'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AutoAdmittedUsers EveryoneInCompanyExcludingGuests. Teams admin center > Meetings > Meeting policies > Global > Who can bypass the lobby > People in my org.'
        }
        Add-Setting @settingParams

        # Dial-in users can't bypass lobby (CIS 8.5.4)
        $pstnBypass = $meetingPolicy['allowPSTNUsersToBypassLobby']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Dial-in Users Bypass Lobby'
            CurrentValue     = "$pstnBypass"
            RecommendedValue = 'False'
            Status           = if (-not $pstnBypass) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-004'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowPSTNUsersToBypassLobby $false. Teams admin center > Meetings > Meeting policies > Global > Dial-in users can bypass the lobby > Off.'
        }
        Add-Setting @settingParams

        # External participants can't give/request control (CIS 8.5.7)
        $extControl = $meetingPolicy['allowExternalParticipantGiveRequestControl']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'External Participants Can Give/Request Control'
            CurrentValue     = "$extControl"
            RecommendedValue = 'False'
            Status           = if (-not $extControl) { 'Pass' } else { 'Warning' }
            CheckId          = 'TEAMS-MEETING-005'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowExternalParticipantGiveRequestControl $false. Teams admin center > Meetings > Meeting policies > Global > External participants can give or request control > Off.'
        }
        Add-Setting @settingParams

        # CIS 8.5.5 — Anonymous meeting chat blocked
        $meetingChat = $meetingPolicy['meetingChatEnabledType']
        $chatPass = $meetingChat -ne 'Enabled'
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Meeting Chat for Anonymous Users'
            CurrentValue     = "$meetingChat"
            RecommendedValue = 'Disabled or EnabledExceptAnonymous'
            Status           = if ($chatPass) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-006'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -MeetingChatEnabledType EnabledExceptAnonymous. Teams admin center > Meetings > Meeting policies > Global > Meeting chat > On for everyone except anonymous users.'
        }
        Add-Setting @settingParams

        # CIS 8.5.6 — Only organizers can present
        $presenterRole = $meetingPolicy['designatedPresenterRoleMode']
        $presenterPass = $presenterRole -eq 'OrganizerOnlyUserOverride'
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Default Presenter Role'
            CurrentValue     = "$presenterRole"
            RecommendedValue = 'OrganizerOnlyUserOverride'
            Status           = if ($presenterPass) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-007'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -DesignatedPresenterRoleMode OrganizerOnlyUserOverride. Teams admin center > Meetings > Meeting policies > Global > Who can present > Only organizers.'
        }
        Add-Setting @settingParams

        # CIS 8.5.8 — External meeting chat off
        $extMeetingChat = $meetingPolicy['allowExternalNonTrustedMeetingChat']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'External Meeting Chat (Non-Trusted)'
            CurrentValue     = "$extMeetingChat"
            RecommendedValue = 'False'
            Status           = if (-not $extMeetingChat) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-008'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowExternalNonTrustedMeetingChat $false. Teams admin center > Meetings > Meeting policies > Global > External meeting chat > Off.'
        }
        Add-Setting @settingParams

        # CIS 8.5.9 — Cloud recording off by default
        $cloudRecording = $meetingPolicy['allowCloudRecording']
        $settingParams = @{
            Category         = 'Meeting Policy'
            Setting          = 'Cloud Recording'
            CurrentValue     = "$cloudRecording"
            RecommendedValue = 'False'
            Status           = if (-not $cloudRecording) { 'Pass' } else { 'Fail' }
            CheckId          = 'TEAMS-MEETING-009'
            Remediation      = 'Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowCloudRecording $false. Teams admin center > Meetings > Meeting policies > Global > Cloud recording > Off.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Teams meeting policy endpoint unavailable: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# 3. Teams Settings (tenant-level)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking tenant-level Teams settings..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/teamwork'
        ErrorAction = 'Stop'
    }
    $teamSettings = Invoke-MgGraphRequest @graphParams

    if ($teamSettings) {
        $settingParams = @{
            Category         = 'Teams Settings'
            Setting          = 'Teams Workload Active'
            CurrentValue     = 'Active'
            RecommendedValue = 'Active'
            Status           = 'Info'
            CheckId          = 'TEAMS-INFO-001'
            Remediation      = 'Informational — confirms Teams service connectivity.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Teams settings endpoint unavailable: $($_.Exception.Message)"
}

# ------------------------------------------------------------------
# Teams App Permission Policies (CIS 8.4.1 - Review)
# ------------------------------------------------------------------
$settingParams = @{
    Category         = 'Teams Apps'
    Setting          = 'Third-Party App Permission Policies'
    CurrentValue     = 'Cannot be fully checked via API'
    RecommendedValue = 'Block third-party apps or restrict to approved list'
    Status           = 'Review'
    CheckId          = 'TEAMS-APPS-002'
    Remediation      = 'Teams admin center > Teams apps > Permission policies > Org-wide app settings > Third-party apps > Off (or restrict to approved apps).'
}
Add-Setting @settingParams

# ------------------------------------------------------------------
# Teams Report a Security Concern (CIS 8.6.1 - Review)
# ------------------------------------------------------------------
$settingParams = @{
    Category         = 'Teams Settings'
    Setting          = 'Report a Security Concern Enabled'
    CurrentValue     = 'Cannot be checked via API'
    RecommendedValue = 'Enabled in messaging policies'
    Status           = 'Review'
    CheckId          = 'TEAMS-REPORTING-001'
    Remediation      = 'Teams admin center > Messaging policies > Global (Org-wide default) > Report a security concern > On.'
}
Add-Setting @settingParams

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Teams security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Teams security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
