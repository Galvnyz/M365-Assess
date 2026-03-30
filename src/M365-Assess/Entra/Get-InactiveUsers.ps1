<#
.SYNOPSIS
    Finds Entra ID users who have not signed in for a specified number of days.
.DESCRIPTION
    Queries Microsoft Graph for user accounts and their last sign-in activity.
    Returns users whose last interactive or non-interactive sign-in exceeds the
    specified threshold. Useful for identifying stale accounts during security
    reviews and tenant cleanups.

    Requires Microsoft.Graph.Users module and User.Read.All permission.
.PARAMETER DaysInactive
    Number of days since last sign-in to consider a user inactive. Defaults to 90.
.PARAMETER IncludeGuests
    Include guest (B2B) accounts in the results. By default only members are returned.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'User.Read.All','AuditLog.Read.All'
    PS> .\Entra\Get-InactiveUsers.ps1 -DaysInactive 90

    Lists all member users who have not signed in for 90+ days.
.EXAMPLE
    PS> .\Entra\Get-InactiveUsers.ps1 -DaysInactive 30 -IncludeGuests -OutputPath '.\inactive-users.csv'

    Exports all users (members and guests) inactive for 30+ days to CSV.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 365)]
    [int]$DaysInactive = 90,

    [Parameter()]
    [switch]$IncludeGuests,

    [Parameter()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

$cutoffDate = (Get-Date).AddDays(-$DaysInactive).ToString('yyyy-MM-ddTHH:mm:ssZ')

# Build the filter
$filter = "accountEnabled eq true"
if (-not $IncludeGuests) {
    $filter += " and userType eq 'Member'"
}

Write-Verbose "Querying users with filter: $filter"
Write-Verbose "Inactive threshold: $DaysInactive days (before $cutoffDate)"

try {
    $selectProperties = @(
        'Id'
        'DisplayName'
        'UserPrincipalName'
        'UserType'
        'AccountEnabled'
        'CreatedDateTime'
        'SignInActivity'
    )

    $users = Get-MgUser -Filter $filter -Property $selectProperties -All
}
catch {
    Write-Error "Failed to query users from Microsoft Graph: $_"
    return
}

$inactiveUsers = foreach ($user in $users) {
    $lastSignIn = $user.SignInActivity.LastSignInDateTime
    $lastNonInteractive = $user.SignInActivity.LastNonInteractiveSignInDateTime

    # Use the most recent of interactive or non-interactive sign-in
    $lastActivity = @($lastSignIn, $lastNonInteractive) |
        Where-Object { $_ } |
        Sort-Object -Descending |
        Select-Object -First 1

    # Include if never signed in or last activity before cutoff
    $isInactive = (-not $lastActivity) -or ($lastActivity -lt $cutoffDate)

    if ($isInactive) {
        [PSCustomObject]@{
            DisplayName       = $user.DisplayName
            UserPrincipalName = $user.UserPrincipalName
            UserType          = $user.UserType
            AccountEnabled    = $user.AccountEnabled
            LastSignIn        = $lastSignIn
            LastNonInteractiveSignIn = $lastNonInteractive
            LastActivity      = $lastActivity
            DaysSinceActivity = if ($lastActivity) { [math]::Round(((Get-Date) - [datetime]$lastActivity).TotalDays) } else { 'Never' }
            CreatedDate       = $user.CreatedDateTime
        }
    }
}

$inactiveUsers = @($inactiveUsers) | Sort-Object -Property DaysSinceActivity -Descending

Write-Verbose "Found $($inactiveUsers.Count) inactive users"

if ($OutputPath) {
    $inactiveUsers | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($inactiveUsers.Count) inactive users to $OutputPath"
}
else {
    Write-Output $inactiveUsers
}
