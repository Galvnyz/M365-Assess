<#
.SYNOPSIS
    Generates a per-mailbox inventory with size, type, and key properties.
.DESCRIPTION
    Enumerates all mailboxes in Exchange Online (User, Shared, Room, Equipment)
    and collects per-mailbox detail including size, item count, forwarding rules,
    litigation hold, and archive status. Designed for M&A due diligence, migration
    planning, and tenant-wide asset inventories.

    Requires ExchangeOnlineManagement module and an active Exchange Online connection.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Inventory\Get-MailboxInventory.ps1

    Returns per-mailbox inventory for all mailboxes in the tenant.
.EXAMPLE
    PS> .\Inventory\Get-MailboxInventory.ps1 -OutputPath '.\mailbox-inventory.csv'

    Exports the full mailbox inventory to CSV.
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

# Verify EXO connection
try {
    $null = Get-OrganizationConfig -ErrorAction Stop
}
catch {
    Write-Error "Not connected to Exchange Online. Run Connect-Service -Service ExchangeOnline first."
    return
}

# Retrieve all mailboxes with required properties
Write-Verbose "Retrieving all mailboxes (this may take a moment in large tenants)..."
try {
    $mailboxProperties = @(
        'DisplayName'
        'PrimarySmtpAddress'
        'RecipientTypeDetails'
        'WhenCreated'
        'ForwardingAddress'
        'ForwardingSmtpAddress'
        'DeliverToMailboxAndForward'
        'ArchiveStatus'
        'LitigationHoldEnabled'
        'RetentionPolicy'
        'HiddenFromAddressListsEnabled'
        'ExchangeObjectId'
    )
    $allMailboxes = @(Get-EXOMailbox -ResultSize Unlimited -Properties $mailboxProperties)
}
catch {
    Write-Error "Failed to retrieve mailboxes: $_"
    return
}

if ($allMailboxes.Count -eq 0) {
    Write-Verbose "No mailboxes found in this tenant"
    return
}

Write-Verbose "Processing $($allMailboxes.Count) mailboxes..."

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$counter = 0

foreach ($mbx in $allMailboxes) {
    $counter++
    if ($counter % 50 -eq 0 -or $counter -eq 1) {
        Write-Verbose "[$counter/$($allMailboxes.Count)] $($mbx.PrimarySmtpAddress)"
    }

    # Get mailbox statistics for size and item count
    $sizeMB = $null
    $itemCount = $null
    try {
        $stats = Get-EXOMailboxStatistics -Identity $mbx.ExchangeObjectId -ErrorAction Stop
        if ($stats.TotalItemSize -and $stats.TotalItemSize.ToString() -match '\(([0-9,]+)\s+bytes\)') {
            $sizeBytes = [long]($Matches[1] -replace ',', '')
            $sizeMB = [math]::Round($sizeBytes / 1MB, 2)
        }
        $itemCount = $stats.ItemCount
    }
    catch {
        Write-Warning "Could not retrieve statistics for $($mbx.PrimarySmtpAddress): $_"
    }

    $results.Add([PSCustomObject]@{
        DisplayName              = $mbx.DisplayName
        PrimarySmtpAddress       = $mbx.PrimarySmtpAddress
        RecipientTypeDetails     = $mbx.RecipientTypeDetails
        WhenCreated              = $mbx.WhenCreated
        TotalItemSizeMB          = $sizeMB
        ItemCount                = $itemCount
        ArchiveStatus            = $mbx.ArchiveStatus
        ForwardingAddress        = $mbx.ForwardingAddress
        ForwardingSmtpAddress    = $mbx.ForwardingSmtpAddress
        DeliverToMailboxAndForward = $mbx.DeliverToMailboxAndForward
        LitigationHoldEnabled    = $mbx.LitigationHoldEnabled
        RetentionPolicy          = $mbx.RetentionPolicy
        HiddenFromAddressLists   = $mbx.HiddenFromAddressListsEnabled
    })
}

Write-Verbose "Inventory complete: $($results.Count) mailboxes processed"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported mailbox inventory ($($results.Count) mailboxes) to $OutputPath"
}
else {
    Write-Output $results
}
