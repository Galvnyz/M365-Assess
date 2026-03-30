<#
.SYNOPSIS
    Reports SharePoint Online and OneDrive tenant-wide settings.
.DESCRIPTION
    Queries the Microsoft Graph SharePoint admin settings endpoint to retrieve
    tenant-level configuration for SharePoint Online and OneDrive. Covers sharing
    capabilities, external sharing restrictions, sync client policies, and Loop
    settings. Essential for M365 security assessments and collaboration governance
    reviews.

    Requires Microsoft Graph connection with SharePointTenantSettings.Read.All
    permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'SharePointTenantSettings.Read.All'
    PS> .\Collaboration\Get-SharePointOneDriveReport.ps1

    Displays SharePoint and OneDrive tenant settings in the console.
.EXAMPLE
    PS> .\Collaboration\Get-SharePointOneDriveReport.ps1 -OutputPath '.\spo-onedrive-settings.csv'

    Exports SharePoint and OneDrive tenant settings to CSV for documentation.
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

# Retrieve SharePoint tenant settings
try {
    Write-Verbose "Retrieving SharePoint and OneDrive tenant settings..."
    $spoSettings = Invoke-MgGraphRequest -Uri '/v1.0/admin/sharepoint/settings' -Method GET
}
catch {
    $statusCode = $null
    if ($_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
    }

    # Also check error message for status codes when Response object is unavailable
    $errorMsg = $_.Exception.Message
    if (-not $statusCode) {
        if ($errorMsg -match '401|Unauthorized') { $statusCode = 401 }
        elseif ($errorMsg -match '403|Forbidden') { $statusCode = 403 }
        elseif ($errorMsg -match '404|Not Found') { $statusCode = 404 }
    }

    if ($statusCode -eq 401) {
        Write-Warning "Unauthorized (401). The SharePointTenantSettings.Read.All permission may not be consented. Ensure an admin has granted consent for this scope."
        return
    }
    elseif ($statusCode -eq 403) {
        Write-Warning "Access denied (403). Ensure the app or user has the SharePointTenantSettings.Read.All permission and admin consent has been granted."
        return
    }
    elseif ($statusCode -eq 404) {
        Write-Warning "SharePoint admin settings endpoint not found (404). The tenant may not have a SharePoint Online license."
        return
    }
    else {
        Write-Error "Failed to retrieve SharePoint tenant settings: $_"
        return
    }
}

# Build the report from the settings response
$report = @([PSCustomObject]@{
    SharingCapability                  = $spoSettings.sharingCapability
    SharingDomainRestrictionMode       = $spoSettings.sharingDomainRestrictionMode
    IsResharingByExternalUsersEnabled  = $spoSettings.isResharingByExternalUsersEnabled
    IsUnmanagedSyncClientRestricted    = $spoSettings.isUnmanagedSyncClientRestricted
    TenantDefaultTimezone              = $spoSettings.tenantDefaultTimezone
    OneDriveLoopSharingCapability      = $spoSettings.oneDriveLoopSharingCapability
    IsMacSyncAppEnabled                = $spoSettings.isMacSyncAppEnabled
    IsLoopEnabled                      = $spoSettings.isLoopEnabled
})

Write-Verbose "Successfully retrieved SharePoint and OneDrive tenant settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported SharePoint/OneDrive settings to $OutputPath"
}
else {
    Write-Output $report
}
