<#
.SYNOPSIS
    Reports all Conditional Access policies in the Entra ID tenant.
.DESCRIPTION
    Queries Microsoft Graph for every Conditional Access policy and produces a
    flattened report showing policy state, conditions, grant controls, and session
    controls. Essential for reviewing Zero Trust posture and identifying policy gaps
    during security assessments.

    Requires Microsoft.Graph.Identity.SignIns module and Policy.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Policy.Read.All'
    PS> .\Entra\Get-ConditionalAccessReport.ps1

    Displays all Conditional Access policies with their configuration details.
.EXAMPLE
    PS> .\Entra\Get-ConditionalAccessReport.ps1 -OutputPath '.\ca-policies.csv'

    Exports Conditional Access policy details to CSV.
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
Import-Module -Name Microsoft.Graph.Identity.SignIns -ErrorAction Stop

# Retrieve all Conditional Access policies
try {
    Write-Verbose "Retrieving Conditional Access policies..."
    $policies = Get-MgIdentityConditionalAccessPolicy -All
}
catch {
    Write-Error "Failed to retrieve Conditional Access policies: $_"
    return
}

$allPolicies = @($policies)
Write-Verbose "Processing $($allPolicies.Count) Conditional Access policies..."

if ($allPolicies.Count -eq 0) {
    Write-Verbose "No Conditional Access policies found"
    return
}

# Build GUID-to-UPN lookup for user references in CA policies
$guidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$userGuids = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in $allPolicies) {
    foreach ($uid in @($p.Conditions.Users.IncludeUsers; $p.Conditions.Users.ExcludeUsers)) {
        if ($uid -match $guidPattern) { [void]$userGuids.Add($uid) }
    }
}
$guidToUpn = @{}
if ($userGuids.Count -gt 0) {
    Write-Verbose "Resolving $($userGuids.Count) user GUID(s) to UPN..."
    foreach ($guid in $userGuids) {
        try {
            $user = Get-MgUser -UserId $guid -Property UserPrincipalName -ErrorAction Stop
            $guidToUpn[$guid] = $user.UserPrincipalName
        }
        catch {
            $guidToUpn[$guid] = $guid
        }
    }
}

# Helper: resolve user IDs to display names (UPN for GUIDs, pass-through for 'All'/'GuestsOrExternalUsers')
function Resolve-UserDisplay {
    param([string[]]$UserIds)
    if (-not $UserIds) { return '' }
    $resolved = foreach ($uid in $UserIds) {
        if ($guidToUpn.ContainsKey($uid)) { $guidToUpn[$uid] } else { $uid }
    }
    ($resolved | Sort-Object) -join '; '
}

$report = foreach ($policy in $allPolicies) {
    # Flatten included users (resolve GUIDs to UPN)
    $includeUsers = Resolve-UserDisplay -UserIds $policy.Conditions.Users.IncludeUsers

    # Flatten excluded users (resolve GUIDs to UPN)
    $excludeUsers = Resolve-UserDisplay -UserIds $policy.Conditions.Users.ExcludeUsers

    # Flatten included applications
    $includeApps = if ($policy.Conditions.Applications.IncludeApplications) {
        ($policy.Conditions.Applications.IncludeApplications | Sort-Object) -join '; '
    }
    else {
        ''
    }

    # Flatten grant controls
    $grantControls = if ($policy.GrantControls.BuiltInControls) {
        $controlsList = @($policy.GrantControls.BuiltInControls)
        $operator = $policy.GrantControls.Operator
        if ($controlsList.Count -gt 1 -and $operator) {
            ($controlsList -join " $operator ")
        }
        else {
            $controlsList -join '; '
        }
    }
    else {
        ''
    }

    # Flatten session controls
    $sessionControlsList = @()
    if ($policy.SessionControls.SignInFrequency.IsEnabled) {
        $freq = $policy.SessionControls.SignInFrequency
        $sessionControlsList += "SignInFrequency: $($freq.Value) $($freq.Type)"
    }
    if ($policy.SessionControls.PersistentBrowser.IsEnabled) {
        $sessionControlsList += "PersistentBrowser: $($policy.SessionControls.PersistentBrowser.Mode)"
    }
    if ($policy.SessionControls.CloudAppSecurity.IsEnabled) {
        $sessionControlsList += "CloudAppSecurity: $($policy.SessionControls.CloudAppSecurity.CloudAppSecurityType)"
    }
    if ($policy.SessionControls.ApplicationEnforcedRestrictions.IsEnabled) {
        $sessionControlsList += "AppEnforcedRestrictions"
    }
    $sessionControls = $sessionControlsList -join '; '

    [PSCustomObject]@{
        DisplayName         = $policy.DisplayName
        State               = $policy.State
        CreatedDateTime     = $policy.CreatedDateTime
        ModifiedDateTime    = $policy.ModifiedDateTime
        IncludeUsers        = $includeUsers
        ExcludeUsers        = $excludeUsers
        IncludeApplications = $includeApps
        GrantControls       = $grantControls
        SessionControls     = $sessionControls
    }
}

$report = @($report) | Sort-Object -Property DisplayName

Write-Verbose "Found $($report.Count) Conditional Access policies"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Conditional Access report ($($report.Count) policies) to $OutputPath"
}
else {
    Write-Output $report
}
