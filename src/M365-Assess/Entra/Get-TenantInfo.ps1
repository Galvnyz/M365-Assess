<#
.SYNOPSIS
    Collects Entra ID tenant information including org details, verified domains, and security defaults status.
.DESCRIPTION
    Queries Microsoft Graph for organization metadata, verified domains, and the security defaults
    enforcement policy. Returns a consolidated tenant overview useful for M365 security assessments
    and tenant documentation.

    Requires Microsoft.Graph.Identity.DirectoryManagement and Microsoft.Graph.Identity.SignIns
    modules and the following permissions:
    Organization.Read.All, Domain.Read.All, Policy.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Organization.Read.All','Domain.Read.All','Policy.Read.All'
    PS> .\Entra\Get-TenantInfo.ps1

    Displays tenant organization info, verified domains, and security defaults status.
.EXAMPLE
    PS> .\Entra\Get-TenantInfo.ps1 -OutputPath '.\tenant-info.csv'

    Exports tenant information to CSV for documentation.
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

# Ensure required Graph submodules are loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction Stop
Import-Module -Name Microsoft.Graph.Identity.SignIns -ErrorAction Stop

# Retrieve organization details
try {
    Write-Verbose "Retrieving organization details..."
    $organization = Get-MgOrganization
}
catch {
    Write-Error "Failed to retrieve organization details: $_"
    return
}

# Retrieve domains
try {
    Write-Verbose "Retrieving tenant domains..."
    $domains = Get-MgDomain
}
catch {
    Write-Error "Failed to retrieve domain information: $_"
    return
}

# Retrieve security defaults policy (non-fatal — falls back to N/A)
# Uses Invoke-MgGraphRequest to avoid dependency on specific Graph SDK cmdlet
# names which vary between SDK versions (v1.x vs v2.x).
$securityDefaults = $null
try {
    Write-Verbose "Retrieving security defaults enforcement policy..."
    $securityDefaults = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -ErrorAction Stop
}
catch {
    Write-Verbose "Could not retrieve security defaults policy — will report N/A"
}

# Build the report
$verifiedDomains = $domains |
    Where-Object { $_.IsVerified -eq $true } |
    Select-Object -ExpandProperty Id
$verifiedDomainsJoined = ($verifiedDomains | Sort-Object) -join '; '

$defaultDomain = $domains |
    Where-Object { $_.IsDefault -eq $true } |
    Select-Object -First 1 -ExpandProperty Id

# Handle multiple organizations (typically just one)
$report = foreach ($org in $organization) {
    $provisioningErrorCount = if ($org.OnPremisesProvisioningErrors) { @($org.OnPremisesProvisioningErrors).Count } else { 0 }
    [PSCustomObject]@{
        OrgDisplayName                     = $org.DisplayName
        TenantId                           = $org.Id
        VerifiedDomains                    = $verifiedDomainsJoined
        DefaultDomain                      = $defaultDomain
        SecurityDefaultsEnabled            = if ($null -ne $securityDefaults) { $securityDefaults['isEnabled'] } else { 'N/A' }
        CreatedDateTime                    = $org.CreatedDateTime
        OnPremisesSyncEnabled              = $org.OnPremisesSyncEnabled
        OnPremisesLastSyncDateTime         = $org.OnPremisesLastSyncDateTime
        OnPremisesLastPasswordSyncDateTime = $org.OnPremisesLastPasswordSyncDateTime
        OnPremisesProvisioningErrorCount   = $provisioningErrorCount
    }
}

$report = @($report)

Write-Verbose "Retrieved tenant info for $($report.Count) organization(s)"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported tenant info ($($report.Count) record(s)) to $OutputPath"
}
else {
    Write-Output $report
}
