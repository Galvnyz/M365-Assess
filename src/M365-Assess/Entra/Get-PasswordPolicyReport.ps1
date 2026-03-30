<#
.SYNOPSIS
    Reports domain password policies and organization authorization policy settings.
.DESCRIPTION
    Queries Microsoft Graph for domain-level password policy configuration (validity
    period, notification window) and the tenant authorization policy (cloud password
    validation, email-verified user join). Provides a consolidated view of password
    and access policies for security assessments.

    Requires Microsoft.Graph.Identity.DirectoryManagement module and the following
    permissions: Domain.Read.All, Policy.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Domain.Read.All','Policy.Read.All'
    PS> .\Entra\Get-PasswordPolicyReport.ps1

    Displays password policy settings for each domain and the org authorization policy.
.EXAMPLE
    PS> .\Entra\Get-PasswordPolicyReport.ps1 -OutputPath '.\password-policies.csv'

    Exports password policy details to CSV for documentation.
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

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction Stop

# Retrieve all domains
try {
    Write-Verbose "Retrieving domain information..."
    $domains = Get-MgDomain -All
}
catch {
    Write-Error "Failed to retrieve domain information: $_"
    return
}

# Retrieve authorization policy
try {
    Write-Verbose "Retrieving authorization policy..."
    $authPolicy = Get-MgPolicyAuthorizationPolicy
}
catch {
    Write-Error "Failed to retrieve authorization policy: $_"
    return
}

$allDomains = @($domains)
Write-Verbose "Processing password policies for $($allDomains.Count) domain(s)..."

# Extract authorization policy settings
$allowCloudPasswordValidation = $false
$allowEmailVerifiedJoin = $false

if ($authPolicy) {
    # AllowedToSignUpEmailBasedSubscriptions maps to email-verified user join
    $allowEmailVerifiedJoin = $authPolicy.AllowEmailVerifiedUsersToJoinOrganization
    # AllowedToUseSSPR / password validation for cloud users
    $allowCloudPasswordValidation = $authPolicy.AllowedToUseSSPR
}

$report = foreach ($domain in $allDomains) {
    [PSCustomObject]@{
        Domain                                      = $domain.Id
        IsDefault                                   = $domain.IsDefault
        PasswordValidityPeriod                      = $domain.PasswordValidityPeriodInDays
        PasswordNotificationWindowInDays            = $domain.PasswordNotificationWindowInDays
        AllowCloudPasswordValidation                = $allowCloudPasswordValidation
        AllowEmailVerifiedUsersToJoinOrganization   = $allowEmailVerifiedJoin
    }
}

$report = @($report) | Sort-Object -Property Domain

Write-Verbose "Found password policy settings for $($report.Count) domain(s)"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported password policy report ($($report.Count) domain(s)) to $OutputPath"
}
else {
    Write-Output $report
}
