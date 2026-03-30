<#
.SYNOPSIS
    Generates a per-team inventory with owners, member counts, and channel counts.
.DESCRIPTION
    Enumerates all Teams-enabled Microsoft 365 groups via Microsoft Graph and collects
    per-team detail including visibility, owner list, member count, channel count, and
    archive status. Designed for M&A due diligence and migration planning.

    For each team, three additional Graph API calls are made (owners, members/$count,
    channels). On tenants with many teams this may take several minutes due to API
    rate limiting. The Graph SDK handles 429 throttling retries automatically.

    Requires Microsoft.Graph.Authentication module and an active Graph connection
    with Group.Read.All, Team.ReadBasic.All, TeamMember.Read.All, and
    Channel.ReadBasic.All permissions.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Group.Read.All','Team.ReadBasic.All','TeamMember.Read.All','Channel.ReadBasic.All'
    PS> .\Inventory\Get-TeamsInventory.ps1

    Returns per-team inventory for all teams in the tenant.
.EXAMPLE
    PS> .\Inventory\Get-TeamsInventory.ps1 -OutputPath '.\teams-inventory.csv'

    Exports the Teams inventory to CSV.
.NOTES
    M365 Assess — M&A Inventory
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

# ------------------------------------------------------------------
# Retrieve all Teams-enabled groups (paginated)
# ------------------------------------------------------------------
Write-Verbose "Retrieving Teams-enabled groups from Microsoft Graph..."

$allGroups = [System.Collections.Generic.List[object]]::new()
$uri = "/v1.0/groups?`$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&`$select=id,displayName,description,visibility,createdDateTime,mail&`$top=999"

do {
    try {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
    }
    catch {
        Write-Error "Failed to retrieve Teams groups: $_"
        return
    }

    if ($response.value) {
        foreach ($group in $response.value) {
            $allGroups.Add($group)
        }
    }

    $uri = $response.'@odata.nextLink'
} while ($uri)

if ($allGroups.Count -eq 0) {
    Write-Verbose "No Teams-enabled groups found in this tenant"
    return
}

Write-Verbose "Found $($allGroups.Count) teams. Collecting per-team detail..."

# ------------------------------------------------------------------
# Collect per-team detail (owners, member count, channels)
# ------------------------------------------------------------------
$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$counter = 0

foreach ($group in $allGroups) {
    $counter++
    if ($counter % 10 -eq 0 -or $counter -eq 1) {
        Write-Verbose "[$counter/$($allGroups.Count)] $($group.displayName)"
    }

    $teamId = $group.id

    # Get team settings (isArchived)
    $isArchived = $false
    try {
        $teamDetail = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/teams/$teamId"
        $isArchived = [bool]$teamDetail.isArchived
    }
    catch {
        Write-Warning "Could not retrieve team settings for $($group.displayName): $_"
    }

    # Get owners
    $ownerCount = 0
    $ownerList = ''
    try {
        $owners = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/groups/$teamId/owners?`$select=displayName,userPrincipalName"
        if ($owners.value) {
            $ownerCount = $owners.value.Count
            $ownerList = ($owners.value | ForEach-Object { $_.userPrincipalName }) -join '; '
        }
    }
    catch {
        Write-Warning "Could not retrieve owners for $($group.displayName): $_"
    }

    # Get member count
    $memberCount = 0
    try {
        $membersResponse = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/groups/$teamId/members?`$select=id&`$top=1" -Headers @{ 'ConsistencyLevel' = 'eventual' }
        # Use @odata.count if available, otherwise enumerate
        if ($null -ne $membersResponse.'@odata.count') {
            $memberCount = $membersResponse.'@odata.count'
        }
        else {
            # Fall back to counting via /members with $count=true
            try {
                $countResponse = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/groups/$teamId/members/`$count" -Headers @{ 'ConsistencyLevel' = 'eventual' }
                $memberCount = [int]$countResponse
            }
            catch {
                # Last resort: enumerate all members
                $allMembers = [System.Collections.Generic.List[object]]::new()
                $memberUri = "/v1.0/groups/$teamId/members?`$select=id&`$top=999"
                do {
                    $memberPage = Invoke-MgGraphRequest -Method GET -Uri $memberUri
                    if ($memberPage.value) {
                        foreach ($m in $memberPage.value) {
                            $allMembers.Add($m)
                        }
                    }
                    $memberUri = $memberPage.'@odata.nextLink'
                } while ($memberUri)
                $memberCount = $allMembers.Count
            }
        }
    }
    catch {
        Write-Warning "Could not retrieve member count for $($group.displayName): $_"
    }

    # Get channels
    $channelCount = 0
    $privateChannels = 0
    $sharedChannels = 0
    try {
        $channels = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/teams/$teamId/channels?`$select=id,displayName,membershipType"
        if ($channels.value) {
            $channelCount = $channels.value.Count
            $privateChannels = @($channels.value | Where-Object { $_.membershipType -eq 'private' }).Count
            $sharedChannels = @($channels.value | Where-Object { $_.membershipType -eq 'shared' }).Count
        }
    }
    catch {
        Write-Warning "Could not retrieve channels for $($group.displayName): $_"
    }

    $results.Add([PSCustomObject]@{
        DisplayName     = $group.displayName
        Mail            = $group.mail
        Visibility      = $group.visibility
        Description     = $group.description
        CreatedDateTime = $group.createdDateTime
        IsArchived      = $isArchived
        OwnerCount      = $ownerCount
        Owners          = $ownerList
        MemberCount     = $memberCount
        ChannelCount    = $channelCount
        PrivateChannels = $privateChannels
        SharedChannels  = $sharedChannels
    })
}

$report = @($results) | Sort-Object -Property DisplayName

Write-Verbose "Inventory complete: $($report.Count) teams"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Teams inventory ($($report.Count) teams) to $OutputPath"
}
else {
    Write-Output $report
}
