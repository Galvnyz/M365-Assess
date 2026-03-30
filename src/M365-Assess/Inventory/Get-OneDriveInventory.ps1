<#
.SYNOPSIS
    Generates a per-user OneDrive inventory with storage usage and activity.
.DESCRIPTION
    Retrieves OneDrive data using the direct Graph Users/Drive API (preferred) for
    real user names and site URLs, falling back to the Reports API if the required
    permissions are not available.

    Primary path (User.Read.All): Enumerates enabled users and retrieves each user's
    OneDrive drive for storage quota. Returns real display names and UPNs regardless
    of tenant privacy settings.

    Fallback path (Reports.Read.All): Uses the Reports API usage report. Note that
    the Reports API anonymizes user-identifiable information by default. To see real
    user names and UPNs with this path, a tenant admin must disable the privacy
    setting at: Microsoft 365 Admin Center > Settings > Org Settings > Reports >
    "Display concealed user, group, and site names in all reports".

    Requires Microsoft.Graph.Authentication module and an active Graph connection.
    Preferred permission: User.Read.All. Fallback permission: Reports.Read.All.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'User.Read.All'
    PS> .\Inventory\Get-OneDriveInventory.ps1

    Returns per-user OneDrive inventory using the direct Users/Drive API.
.EXAMPLE
    PS> .\Inventory\Get-OneDriveInventory.ps1 -OutputPath '.\onedrive-inventory.csv'

    Exports the OneDrive inventory to CSV.
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
# Phase 1: Try direct Graph Users/Drive API (returns real data)
# ------------------------------------------------------------------
$usedDirectApi = $false
$results = $null

try {
    Write-Verbose "Attempting direct Users/Drive API for OneDrive inventory..."

    $allUsers = [System.Collections.Generic.List[object]]::new()
    $uri = "/v1.0/users?`$filter=accountEnabled eq true&`$select=id,displayName,userPrincipalName&`$top=999"

    do {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        if ($response.value) {
            foreach ($user in $response.value) {
                $allUsers.Add($user)
            }
        }
        $uri = $response.'@odata.nextLink'
    } while ($uri)

    if ($allUsers.Count -eq 0) {
        Write-Verbose "No enabled users found"
        return
    }

    Write-Verbose "Found $($allUsers.Count) enabled users. Checking OneDrive provisioning..."

    $resultList = [System.Collections.Generic.List[PSCustomObject]]::new()
    $counter = 0

    foreach ($user in $allUsers) {
        $counter++
        if ($counter % 25 -eq 0 -or $counter -eq 1) {
            Write-Verbose "[$counter/$($allUsers.Count)] $($user.userPrincipalName)"
        }

        try {
            $driveInfo = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$($user.id)/drive?`$select=quota,webUrl,lastModifiedDateTime"

            $storageUsedMB = $null
            $storageAllocatedMB = $null
            if ($driveInfo.quota) {
                if ($null -ne $driveInfo.quota.used) {
                    $storageUsedMB = [math]::Round([long]$driveInfo.quota.used / 1MB, 2)
                }
                if ($null -ne $driveInfo.quota.total) {
                    $storageAllocatedMB = [math]::Round([long]$driveInfo.quota.total / 1MB, 2)
                }
            }

            $resultList.Add([PSCustomObject]@{
                OwnerDisplayName   = $user.displayName
                OwnerPrincipalName = $user.userPrincipalName
                SiteUrl            = $driveInfo.webUrl
                IsDeleted          = $false
                StorageUsedMB      = $storageUsedMB
                StorageAllocatedMB = $storageAllocatedMB
                FileCount          = $null
                ActiveFileCount    = $null
                LastActivityDate   = $driveInfo.lastModifiedDateTime
            })
        }
        catch {
            # 404 = user has no OneDrive provisioned — expected, skip silently
            Write-Verbose "No OneDrive for $($user.userPrincipalName): $($_.Exception.Message)"
        }
    }

    $results = @($resultList) | Sort-Object -Property OwnerDisplayName
    $usedDirectApi = $true
    Write-Verbose "Direct API inventory complete: $($resultList.Count) OneDrive accounts"
}
catch {
    $directApiError = $_

    if ($directApiError.Exception.Message -match '401|403|Unauthorized|Forbidden|insufficient') {
        Write-Warning ("Direct Users/Drive API unavailable (missing User.Read.All permission). " +
            "Falling back to Reports API. Data may be obfuscated if tenant privacy settings are enabled.")
    }
    else {
        Write-Warning "Direct Users/Drive API failed: $($directApiError.Exception.Message). Falling back to Reports API."
    }
}

# ------------------------------------------------------------------
# Phase 2: Fallback to Reports API if direct API was not used
# ------------------------------------------------------------------
if (-not $usedDirectApi) {
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

    # Phase 3: Detect obfuscated data
    $sampleOwner = $reportData[0].'Owner Display Name'
    $sampleUpn = $reportData[0].'Owner Principal Name'
    $hexPattern = '^[0-9A-Fa-f]{16,}$'

    if (($sampleOwner -match $hexPattern) -or ($sampleUpn -match $hexPattern)) {
        Write-Warning ("Reports API data appears obfuscated (tenant privacy settings are enabled). " +
            "Owner names and UPNs are anonymized. To see real data, " +
            "a tenant admin must disable the privacy setting at: " +
            "Microsoft 365 Admin Center > Settings > Org Settings > Reports > " +
            "'Display concealed user, group, and site names in all reports'. " +
            "Alternatively, grant User.Read.All permission for the direct API path.")
    }

    Write-Verbose "Processing $($reportData.Count) OneDrive accounts from Reports API..."

    $results = foreach ($row in $reportData) {
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
    Write-Verbose "Reports API inventory complete: $($results.Count) OneDrive accounts"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported OneDrive inventory ($($results.Count) accounts) to $OutputPath"
}
else {
    Write-Output $results
}
