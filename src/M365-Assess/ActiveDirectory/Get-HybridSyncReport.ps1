<#
.SYNOPSIS
    Reports hybrid identity sync status between on-premises Active Directory and Entra ID.
.DESCRIPTION
    Queries Microsoft Graph for organization properties to determine if hybrid sync
    (Entra Connect or Cloud Sync) is enabled and when the last sync occurred. Optionally
    queries on-premises Active Directory (if the ActiveDirectory module is available) for
    domain and forest information.

    Essential for M365 security assessments, hybrid identity reviews, and migration planning.

    Requires Microsoft Graph connection with Organization.Read.All permission. On-premises
    AD queries require the ActiveDirectory PowerShell module and domain connectivity.
.PARAMETER IncludeOnPremAD
    Attempt to query on-premises Active Directory for domain and forest details.
    Requires the ActiveDirectory PowerShell module and network connectivity to a
    domain controller. If the module is not available, a warning is emitted and the
    script continues without on-prem data.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Organization.Read.All'
    PS> .\ActiveDirectory\Get-HybridSyncReport.ps1

    Displays hybrid sync status from Entra ID organization properties.
.EXAMPLE
    PS> .\ActiveDirectory\Get-HybridSyncReport.ps1 -IncludeOnPremAD -OutputPath '.\hybrid-sync-report.csv'

    Includes on-premises AD domain/forest info and exports to CSV.
.EXAMPLE
    PS> .\ActiveDirectory\Get-HybridSyncReport.ps1 -IncludeOnPremAD -Verbose

    Shows detailed progress output including on-premises AD query attempts.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [switch]$IncludeOnPremAD,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction Stop

# Retrieve organization details
try {
    Write-Verbose "Retrieving organization details from Microsoft Graph..."
    $organizations = Get-MgOrganization
}
catch {
    Write-Error "Failed to retrieve organization details: $_"
    return
}

# Attempt on-premises AD queries if requested
$onPremDomainName = $null
$onPremForestName = $null
if ($IncludeOnPremAD) {
    try {
        $adModule = Get-Module -Name ActiveDirectory -ListAvailable -ErrorAction SilentlyContinue
        if ($adModule) {
            Write-Verbose "ActiveDirectory module found. Querying on-premises AD..."

            try {
                $adDomain = Get-ADDomain -ErrorAction Stop
                $onPremDomainName = $adDomain.DNSRoot
                Write-Verbose "On-premises domain: $onPremDomainName"
            }
            catch {
                Write-Warning "Failed to query on-premises AD domain: $_"
            }

            try {
                $adForest = Get-ADForest -ErrorAction Stop
                $onPremForestName = $adForest.Name
                Write-Verbose "On-premises forest: $onPremForestName"
            }
            catch {
                Write-Warning "Failed to query on-premises AD forest: $_"
            }
        }
        else {
            Write-Warning "ActiveDirectory PowerShell module is not installed. Skipping on-premises AD queries."
        }
    }
    catch {
        Write-Warning "Error checking for ActiveDirectory module: $_"
    }
}

# Build the report from organization properties
$report = foreach ($org in $organizations) {
    $onPremSyncEnabled = $org.OnPremisesSyncEnabled
    $lastDirSyncTime = $org.OnPremisesLastSyncDateTime
    $lastPasswordSyncTime = $org.OnPremisesLastPasswordSyncDateTime

    # Determine sync type based on available properties
    $syncType = if ($onPremSyncEnabled -eq $true) {
        if ($lastPasswordSyncTime) {
            'Entra Connect (Password Hash Sync detected)'
        }
        else {
            'Entra Connect or Cloud Sync'
        }
    }
    else {
        'Cloud-only (no hybrid sync)'
    }

    # Determine if password hash sync is enabled based on last sync timestamp
    $passwordHashSyncEnabled = if ($lastPasswordSyncTime) { $true } else { $false }

    # Determine if directory sync is configured (distinct from enabled)
    $dirSyncConfigured = if ($null -ne $onPremSyncEnabled) { $onPremSyncEnabled } else { $false }

    $resultObject = [PSCustomObject]@{
        TenantDisplayName       = $org.DisplayName
        TenantId                = $org.Id
        OnPremisesSyncEnabled   = $onPremSyncEnabled
        LastDirSyncTime         = $lastDirSyncTime
        DirSyncConfigured       = $dirSyncConfigured
        PasswordHashSyncEnabled = $passwordHashSyncEnabled
        LastPasswordSyncTime    = $lastPasswordSyncTime
        SyncType                = $syncType
        OnPremDomainName        = if ($onPremDomainName) { $onPremDomainName } else { 'N/A' }
        OnPremForestName        = if ($onPremForestName) { $onPremForestName } else { 'N/A' }
    }

    $resultObject
}

$report = @($report)

Write-Verbose "Processed hybrid sync status for $($report.Count) organization(s)"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported hybrid sync report ($($report.Count) record(s)) to $OutputPath"
}
else {
    Write-Output $report
}
