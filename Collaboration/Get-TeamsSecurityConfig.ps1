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
    Version: 0.5.0
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
    $settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
    })
}

# ------------------------------------------------------------------
# 1. Teams Client Configuration (external access)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams external access settings..."
    $teamsSettings = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/teamwork/teamsAppSettings' -ErrorAction Stop

    $isSideloadingAllowed = $teamsSettings['isChatResourceSpecificConsentEnabled']
    Add-Setting -Category 'Teams Apps' -Setting 'Chat Resource-Specific Consent' `
        -CurrentValue "$isSideloadingAllowed" -RecommendedValue 'False' `
        -Status $(if (-not $isSideloadingAllowed) { 'Pass' } else { 'Review' }) `
        -Remediation 'Teams admin center > Teams apps > Permission policies > Review resource-specific consent settings.'
}
catch {
    Write-Warning "Could not retrieve Teams app settings: $_"
}

# ------------------------------------------------------------------
# 1b. Teams Client Configuration — unmanaged users (CIS 8.2.2, 8.2.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams client configuration for unmanaged users..."
    $teamsClientConfig = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/teamwork/teamsClientConfiguration' -ErrorAction SilentlyContinue

    if ($teamsClientConfig) {
        $allowConsumer = $teamsClientConfig['allowTeamsConsumer']
        $allowConsumerInbound = $teamsClientConfig['allowTeamsConsumerInbound']

        Add-Setting -Category 'External Access' -Setting 'Communication with Unmanaged Teams Users' `
            -CurrentValue "$allowConsumer" -RecommendedValue 'False' `
            -Status $(if (-not $allowConsumer) { 'Pass' } else { 'Fail' }) `
            -CheckId 'TEAMS-EXTACCESS-001' `
            -Remediation 'Teams admin center > Users > External access > Teams accounts not managed by an organization > Off. Run: Set-CsTenantFederationConfiguration -AllowTeamsConsumer $false'

        Add-Setting -Category 'External Access' -Setting 'External Unmanaged Users Can Initiate Conversations' `
            -CurrentValue "$allowConsumerInbound" -RecommendedValue 'False' `
            -Status $(if (-not $allowConsumerInbound) { 'Pass' } else { 'Fail' }) `
            -CheckId 'TEAMS-EXTACCESS-002' `
            -Remediation 'Teams admin center > Users > External access > External users can initiate conversations > Off. Run: Set-CsTenantFederationConfiguration -AllowTeamsConsumerInbound $false'
    }
}
catch {
    Write-Warning "Could not retrieve Teams client configuration: $_"
}

# ------------------------------------------------------------------
# 2. Teams Meeting Policies (via beta API)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Teams meeting policy..."
    $meetingPolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/teamwork/teamsMeetingPolicy' -ErrorAction SilentlyContinue

    if ($meetingPolicy) {
        $anonymousJoin = $meetingPolicy['allowAnonymousUsersToJoinMeeting']
        Add-Setting -Category 'Meeting Policy' -Setting 'Anonymous Users Can Join Meeting' `
            -CurrentValue "$anonymousJoin" -RecommendedValue 'False' `
            -Status $(if (-not $anonymousJoin) { 'Pass' } else { 'Warning' }) `
            -CheckId 'TEAMS-MEETING-001' `
            -Remediation 'Teams admin center > Meetings > Meeting policies > Global > Anonymous users can join a meeting > Off. Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $false'

        # Anonymous/dial-in can't start meeting (CIS 8.5.2)
        $anonStart = $meetingPolicy['allowAnonymousUsersToStartMeeting']
        Add-Setting -Category 'Meeting Policy' -Setting 'Anonymous Users Can Start Meeting' `
            -CurrentValue "$anonStart" -RecommendedValue 'False' `
            -Status $(if (-not $anonStart) { 'Pass' } else { 'Fail' }) `
            -CheckId 'TEAMS-MEETING-002' `
            -Remediation 'Teams admin center > Meetings > Meeting policies > Global > Anonymous users can start a meeting > Off. Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToStartMeeting $false'

        # Auto-admitted users / lobby bypass (CIS 8.5.3)
        $autoAdmit = $meetingPolicy['autoAdmittedUsers']
        $autoAdmitPass = $autoAdmit -eq 'EveryoneInCompanyExcludingGuests' -or $autoAdmit -eq 'EveryoneInSameAndFederatedCompany' -or $autoAdmit -eq 'OrganizerOnly' -or $autoAdmit -eq 'InvitedUsers'
        Add-Setting -Category 'Meeting Policy' -Setting 'Auto-Admitted Users (Lobby Bypass)' `
            -CurrentValue "$autoAdmit" -RecommendedValue 'EveryoneInCompanyExcludingGuests or stricter' `
            -Status $(if ($autoAdmitPass) { 'Pass' } else { 'Fail' }) `
            -CheckId 'TEAMS-MEETING-003' `
            -Remediation 'Teams admin center > Meetings > Meeting policies > Global > Who can bypass the lobby > People in my org. Run: Set-CsTeamsMeetingPolicy -Identity Global -AutoAdmittedUsers EveryoneInCompanyExcludingGuests'

        # Dial-in users can't bypass lobby (CIS 8.5.4)
        $pstnBypass = $meetingPolicy['allowPSTNUsersToBypassLobby']
        Add-Setting -Category 'Meeting Policy' -Setting 'Dial-in Users Bypass Lobby' `
            -CurrentValue "$pstnBypass" -RecommendedValue 'False' `
            -Status $(if (-not $pstnBypass) { 'Pass' } else { 'Fail' }) `
            -CheckId 'TEAMS-MEETING-004' `
            -Remediation 'Teams admin center > Meetings > Meeting policies > Global > Dial-in users can bypass the lobby > Off. Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowPSTNUsersToBypassLobby $false'

        # External participants can't give/request control (CIS 8.5.7)
        $extControl = $meetingPolicy['allowExternalParticipantGiveRequestControl']
        Add-Setting -Category 'Meeting Policy' -Setting 'External Participants Can Give/Request Control' `
            -CurrentValue "$extControl" -RecommendedValue 'False' `
            -Status $(if (-not $extControl) { 'Pass' } else { 'Warning' }) `
            -CheckId 'TEAMS-MEETING-005' `
            -Remediation 'Teams admin center > Meetings > Meeting policies > Global > External participants can give or request control > Off. Run: Set-CsTeamsMeetingPolicy -Identity Global -AllowExternalParticipantGiveRequestControl $false'
    }
}
catch {
    Write-Warning "Could not retrieve Teams meeting policy via Graph: $_"
}

# ------------------------------------------------------------------
# 3. Teams Settings (tenant-level)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking tenant-level Teams settings..."
    $teamSettings = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/teamwork' -ErrorAction SilentlyContinue

    if ($teamSettings) {
        Add-Setting -Category 'Teams Settings' -Setting 'Teams Workload Active' `
            -CurrentValue 'Active' -RecommendedValue 'Active' -Status 'Pass'
    }
}
catch {
    Write-Warning "Could not retrieve Teams settings: $_"
}

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
