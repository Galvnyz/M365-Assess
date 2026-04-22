<#
.SYNOPSIS
    Generates a summary of Entra ID user counts by type and status.
.DESCRIPTION
    Queries Microsoft Graph for all users and produces aggregate counts including
    total users, licensed users, guest accounts, disabled accounts, on-prem synced
    accounts, cloud-only accounts, and users with recent sign-in activity. Useful
    for tenant health checks and security assessments.

    Uses Invoke-MgGraphRequest with pagination for reliable operation across all
    tenant types and licensing tiers.

    Requires Microsoft.Graph.Authentication module and an active Graph connection
    with User.Read.All permission. AuditLog.Read.All is optional (enables
    sign-in activity tracking).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'User.Read.All'
    PS> .\Entra\Get-UserSummary.ps1

    Displays a summary of user counts in the tenant.
.EXAMPLE
    PS> .\Entra\Get-UserSummary.ps1 -OutputPath '.\user-summary.csv'

    Exports user summary counts to CSV for reporting.
.NOTES
    M365 Assess
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
# Retrieve all users via Graph API (paginated)
# ------------------------------------------------------------------
Write-Verbose "Retrieving all users (this may take a moment in large tenants)..."

$allUsers = [System.Collections.Generic.List[object]]::new()
$selectFields = 'id,displayName,userPrincipalName,userType,accountEnabled,assignedLicenses,onPremisesSyncEnabled,signInActivity'
$uri = "/v1.0/users?`$select=$selectFields&`$top=999"

# Try with signInActivity first; fall back without it if the tenant lacks AAD Premium
$fallback = $false
do {
    try {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri -Headers @{ 'ConsistencyLevel' = 'eventual' }
    }
    catch {
        # signInActivity requires AuditLog.Read.All + AAD Premium; retry without it
        if (-not $fallback -and $_.ToString() -match 'signInActivity|AuditLog|Authorization_RequestDenied|Insufficient privileges|Neither combinator') {
            Write-Warning "SignInActivity not available (requires AuditLog.Read.All + Microsoft Entra ID P1). Retrying without it."
            $fallback = $true
            $selectFields = 'id,displayName,userPrincipalName,userType,accountEnabled,assignedLicenses,onPremisesSyncEnabled'
            $uri = "/v1.0/users?`$select=$selectFields&`$top=999"
            $allUsers.Clear()
            continue
        }
        Write-Error "Failed to retrieve users from Microsoft Graph: $_"
        return
    }

    if ($response.value) {
        foreach ($user in $response.value) {
            $allUsers.Add($user)
        }
    }

    $uri = $response.'@odata.nextLink'
} while ($uri)

$totalUsers = $allUsers.Count

if ($totalUsers -eq 0) {
    Write-Warning "No users returned from Microsoft Graph. Check User.Read.All permission."
}

Write-Verbose "Processing $totalUsers users..."

# ------------------------------------------------------------------
# Count by category
# ------------------------------------------------------------------
$licensedCount = 0
$guestCount = 0
$disabledCount = 0
$syncedCount = 0
$cloudOnlyCount = 0
$activeSignInCount = 0
$neverSignedInCount = $null
$staleMemberCount = $null

$staleThreshold = (Get-Date).AddDays(-90)

foreach ($user in $allUsers) {
    if ($user.assignedLicenses -and @($user.assignedLicenses).Count -gt 0) {
        $licensedCount++
    }

    if ($user.userType -eq 'Guest') {
        $guestCount++
    }

    if ($user.accountEnabled -eq $false) {
        $disabledCount++
    }

    if ($user.onPremisesSyncEnabled -eq $true) {
        $syncedCount++
    }
    else {
        $cloudOnlyCount++
    }

    # Sign-in activity (available only with AuditLog.Read.All + AAD Premium)
    if (-not $fallback) {
        $lastSignIn = $user.signInActivity?.lastSignInDateTime
        if ($lastSignIn) {
            $activeSignInCount++
        }
        else {
            if ($null -eq $neverSignedInCount) { $neverSignedInCount = 0 }
            $neverSignedInCount++
        }

        # Stale member: enabled member account with no sign-in in 90 days (or never)
        if ($user.accountEnabled -eq $true -and $user.userType -ne 'Guest') {
            if ($null -eq $staleMemberCount) { $staleMemberCount = 0 }
            if (-not $lastSignIn -or [datetime]$lastSignIn -lt $staleThreshold) {
                $staleMemberCount++
            }
        }
    }
}

$report = @([PSCustomObject]@{
    TotalUsers       = $totalUsers
    Licensed         = $licensedCount
    GuestUsers       = $guestCount
    DisabledUsers    = $disabledCount
    SyncedFromOnPrem = $syncedCount
    CloudOnly        = $cloudOnlyCount
    WithMFA          = $activeSignInCount
    NeverSignedIn    = $neverSignedInCount
    StaleMember      = $staleMemberCount
})

Write-Verbose "User summary: $totalUsers total, $licensedCount licensed, $guestCount guests, $disabledCount disabled"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported user summary to $OutputPath"
}
else {
    Write-Output $report
}
