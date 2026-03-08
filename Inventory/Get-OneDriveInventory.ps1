<#
.SYNOPSIS
    Generates a per-user OneDrive inventory with storage usage and activity.
.DESCRIPTION
    Retrieves OneDrive usage data for all provisioned users via the Microsoft Graph
    Reports API. Reports storage used, storage allocated, file counts, and last
    activity date per user. Designed for M&A due diligence and migration planning.

    Note: The Reports API anonymizes user-identifiable information by default. To see
    real user names and UPNs, a tenant admin must disable the privacy setting at:
    Microsoft 365 Admin Center > Settings > Org Settings > Reports >
    "Display concealed user, group, and site names in all reports".

    Requires Microsoft.Graph.Authentication module and an active Graph connection
    with Reports.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Reports.Read.All'
    PS> .\Inventory\Get-OneDriveInventory.ps1

    Returns per-user OneDrive inventory for all provisioned users.
.EXAMPLE
    PS> .\Inventory\Get-OneDriveInventory.ps1 -OutputPath '.\onedrive-inventory.csv'

    Exports the OneDrive inventory to CSV.
.NOTES
    Version: 0.3.0
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

# ------------------------------------------------------------------
# Fetch OneDrive usage report via Reports API
# The API returns CSV content; download to a temp file and parse.
# ------------------------------------------------------------------
$reportUri = "/v1.0/reports/getOneDriveUsageAccountDetail(period='D7')"
Write-Verbose "Downloading OneDrive usage report from Graph Reports API..."

$tempFile = [System.IO.Path]::GetTempFileName()
try {
    Invoke-MgGraphRequest -Method GET -Uri $reportUri -OutputFilePath $tempFile
    $reportData = @(Import-Csv -Path $tempFile)
}
catch {
    Write-Error "Failed to retrieve OneDrive usage report: $_"
    return
}
finally {
    Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
}

if ($reportData.Count -eq 0) {
    Write-Verbose "No OneDrive accounts found in the usage report"
    return
}

Write-Verbose "Processing $($reportData.Count) OneDrive accounts..."

# ------------------------------------------------------------------
# Map Reports API columns to clean output
# ------------------------------------------------------------------
$results = foreach ($row in $reportData) {
    # Convert bytes to MB
    $storageUsedMB = $null
    if ($row.'Storage Used (Byte)') {
        $storageUsedMB = [math]::Round([long]$row.'Storage Used (Byte)' / 1MB, 2)
    }

    $storageAllocatedMB = $null
    if ($row.'Storage Allocated (Byte)') {
        $storageAllocatedMB = [math]::Round([long]$row.'Storage Allocated (Byte)' / 1MB, 2)
    }

    [PSCustomObject]@{
        OwnerDisplayName   = $row.'Owner Display Name'
        OwnerPrincipalName = $row.'Owner Principal Name'
        SiteUrl            = $row.'Site URL'
        IsDeleted          = $row.'Is Deleted'
        StorageUsedMB      = $storageUsedMB
        StorageAllocatedMB = $storageAllocatedMB
        FileCount          = $row.'File Count'
        ActiveFileCount    = $row.'Active File Count'
        LastActivityDate   = $row.'Last Activity Date'
    }
}

$results = @($results) | Sort-Object -Property OwnerDisplayName

Write-Verbose "Inventory complete: $($results.Count) OneDrive accounts"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported OneDrive inventory ($($results.Count) accounts) to $OutputPath"
}
else {
    Write-Output $results
}
