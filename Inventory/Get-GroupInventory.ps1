<#
.SYNOPSIS
    Generates a per-group inventory of distribution lists, mail-enabled security groups,
    and Microsoft 365 groups.
.DESCRIPTION
    Enumerates all distribution lists, mail-enabled security groups, and Microsoft 365
    (Unified) groups in Exchange Online. Reports member counts, owners, group type, and
    key settings. Designed for M&A due diligence and migration planning.

    For large tenants with many distribution groups, use -SkipMemberCount to skip
    per-group member enumeration and improve performance.

    Requires ExchangeOnlineManagement module and an active Exchange Online connection.
.PARAMETER SkipMemberCount
    Skip per-distribution-group member enumeration. Member counts will show as N/A
    for distribution lists and mail-enabled security groups. M365 group member counts
    are always available via GroupMemberCount property.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Inventory\Get-GroupInventory.ps1

    Returns inventory of all distribution lists, security groups, and M365 groups.
.EXAMPLE
    PS> .\Inventory\Get-GroupInventory.ps1 -SkipMemberCount -OutputPath '.\group-inventory.csv'

    Exports group inventory without per-DL member counts (faster on large tenants).
.NOTES
    M365 Assess — M&A Inventory
#>
[CmdletBinding()]
param(
    [Parameter()]
    [switch]$SkipMemberCount,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify EXO connection
try {
    $null = Get-OrganizationConfig -ErrorAction Stop
}
catch {
    Write-Error "Not connected to Exchange Online. Run Connect-Service -Service ExchangeOnline first."
    return
}

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

# ------------------------------------------------------------------
# Distribution groups and mail-enabled security groups
# ------------------------------------------------------------------
Write-Verbose "Retrieving distribution groups..."
try {
    $distributionGroups = @(Get-DistributionGroup -ResultSize Unlimited)
}
catch {
    Write-Warning "Failed to retrieve distribution groups: $_"
    $distributionGroups = @()
}

Write-Verbose "Processing $($distributionGroups.Count) distribution groups..."
$counter = 0

foreach ($group in $distributionGroups) {
    $counter++
    if ($counter % 25 -eq 0 -or $counter -eq 1) {
        Write-Verbose "[$counter/$($distributionGroups.Count)] $($group.PrimarySmtpAddress)"
    }

    # Determine group type
    $groupType = if ($group.RecipientTypeDetails -eq 'MailUniversalSecurityGroup') {
        'MailEnabledSecurity'
    }
    else {
        'DistributionList'
    }

    # Get member count (unless skipped)
    $memberCount = 'N/A'
    if (-not $SkipMemberCount) {
        try {
            $members = @(Get-DistributionGroupMember -Identity $group.PrimarySmtpAddress -ResultSize Unlimited)
            $memberCount = $members.Count
        }
        catch {
            Write-Warning "Could not retrieve members for $($group.PrimarySmtpAddress): $_"
        }
    }

    # Format owners
    $managedBy = ''
    if ($group.ManagedBy) {
        $managedBy = ($group.ManagedBy | ForEach-Object { $_.ToString() }) -join '; '
    }

    $results.Add([PSCustomObject]@{
        DisplayName              = $group.DisplayName
        PrimarySmtpAddress       = $group.PrimarySmtpAddress
        GroupType                = $groupType
        MemberCount              = $memberCount
        ExternalMemberCount      = ''
        ManagedBy                = $managedBy
        WhenCreated              = $group.WhenCreated
        AccessType               = ''
        HiddenFromAddressLists   = $group.HiddenFromAddressListsEnabled
        RequireSenderAuthentication = $group.RequireSenderAuthenticationEnabled
    })
}

# ------------------------------------------------------------------
# Microsoft 365 (Unified) groups
# ------------------------------------------------------------------
Write-Verbose "Retrieving Microsoft 365 groups..."
try {
    $m365Groups = @(Get-UnifiedGroup -ResultSize Unlimited -IncludeAllProperties)
}
catch {
    Write-Warning "Failed to retrieve Microsoft 365 groups: $_"
    $m365Groups = @()
}

Write-Verbose "Processing $($m365Groups.Count) Microsoft 365 groups..."
$counter = 0

foreach ($group in $m365Groups) {
    $counter++
    if ($counter % 25 -eq 0 -or $counter -eq 1) {
        Write-Verbose "[$counter/$($m365Groups.Count)] $($group.PrimarySmtpAddress)"
    }

    # Format owners
    $managedBy = ''
    if ($group.ManagedBy) {
        $managedBy = ($group.ManagedBy | ForEach-Object { $_.ToString() }) -join '; '
    }

    $results.Add([PSCustomObject]@{
        DisplayName              = $group.DisplayName
        PrimarySmtpAddress       = $group.PrimarySmtpAddress
        GroupType                = 'M365Group'
        MemberCount              = $group.GroupMemberCount
        ExternalMemberCount      = $group.GroupExternalMemberCount
        ManagedBy                = $managedBy
        WhenCreated              = $group.WhenCreated
        AccessType               = $group.AccessType
        HiddenFromAddressLists   = $group.HiddenFromAddressListsEnabled
        RequireSenderAuthentication = $group.RequireSenderAuthenticationEnabled
    })
}

if ($results.Count -eq 0) {
    Write-Verbose "No groups found in this tenant"
    return
}

$report = @($results) | Sort-Object -Property GroupType, DisplayName

Write-Verbose "Inventory complete: $($report.Count) groups ($($distributionGroups.Count) DLs, $($m365Groups.Count) M365 groups)"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported group inventory ($($report.Count) groups) to $OutputPath"
}
else {
    Write-Output $report
}
