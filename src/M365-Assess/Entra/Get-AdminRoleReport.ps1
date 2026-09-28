<#
.SYNOPSIS
    Lists all active Entra ID directory role assignments and their members.
.DESCRIPTION
    Queries Microsoft Graph for all activated directory roles and enumerates
    their members. Produces a flat report showing each role-member combination,
    which is critical for reviewing privileged access during security assessments.

    Requires Microsoft.Graph.Identity.DirectoryManagement module and
    RoleManagement.Read.Directory permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'RoleManagement.Read.Directory'
    PS> .\Entra\Get-AdminRoleReport.ps1

    Displays all directory role assignments in the tenant.
.EXAMPLE
    PS> .\Entra\Get-AdminRoleReport.ps1 -OutputPath '.\admin-roles.csv'

    Exports admin role membership to CSV for review.
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
if (-not (Get-Command -Name Invoke-GraphReadBatch -ErrorAction SilentlyContinue)) {
    . "$PSScriptRoot/../Common/Invoke-SafeGraphRequest.ps1"
    . "$PSScriptRoot/../Common/Invoke-GraphReadBatch.ps1"
}

# Retrieve all activated directory roles
try {
    Write-Verbose "Retrieving activated directory roles..."
    $directoryRoles = Get-MgDirectoryRole -All
}
catch {
    Write-Error "Failed to retrieve directory roles: $_"
    return
}

$allRoles = @($directoryRoles)
Write-Verbose "Found $($allRoles.Count) activated directory roles. Enumerating members..."

$roleMembers = @{}
$userIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($role in $allRoles) {
    try {
        $members = @(Get-MgDirectoryRoleMember -DirectoryRoleId $role.Id -All)
    }
    catch {
        Write-Warning "Failed to retrieve members for role '$($role.DisplayName)': $_"
        continue
    }

    $roleMembers[$role.Id] = $members
    foreach ($member in $members) {
        if ($member.AdditionalProperties['@odata.type'] -eq '#microsoft.graph.user') {
            [void]$userIds.Add([string]$member.Id)
        }
    }
}
$userDetails = @{}
if ($userIds.Count -gt 0) {
    $requests = @($userIds | ForEach-Object {
        @{ id = $_; url = '/users/' + [uri]::EscapeDataString($_) + '?$select=id,onPremisesSyncEnabled' }
    })
    try { $userDetails = Invoke-GraphReadBatch -Requests $requests }
    catch { Write-Warning 'Could not resolve user sync state; values remain unknown.' }
}

$report = foreach ($role in $allRoles) {
    foreach ($member in $roleMembers[$role.Id]) {
        $additionalProperties = $member.AdditionalProperties

        $memberDisplayName = $additionalProperties['displayName']
        $memberUpn = $additionalProperties['userPrincipalName']
        $memberType = $additionalProperties['@odata.type']

        # Clean up the OData type to a friendly name
        $friendlyType = switch ($memberType) {
            '#microsoft.graph.user'             { 'User' }
            '#microsoft.graph.servicePrincipal' { 'ServicePrincipal' }
            '#microsoft.graph.group'            { 'Group' }
            default                             { $memberType }
        }

        # Resolve each unique user once, in batches. Unavailable evidence stays
        # blank; it must never be reported as a known cloud-only account.
        $onPremSync = ''
        if ($friendlyType -eq 'User') {
            $detail = $userDetails[[string]$member.Id]
            $hasSyncProperty = if ($detail.body -is [System.Collections.IDictionary]) {
                $detail.body.Contains('onPremisesSyncEnabled')
            } else { $detail.body.PSObject.Properties.Name -contains 'onPremisesSyncEnabled' }
            # Graph can explicitly return null for accounts that are not synced.
            # Preserve that meaning, distinguishing it from an omitted property.
            if ($detail -and $detail.status -eq 200 -and $hasSyncProperty) {
                $onPremSync = if ($detail.body.onPremisesSyncEnabled -eq $true) { 'True' } else { 'False' }
            }
        }

        [PSCustomObject]@{
            RoleName                = $role.DisplayName
            RoleId                  = $role.Id
            MemberDisplayName       = $memberDisplayName
            MemberUPN               = $memberUpn
            MemberType              = $friendlyType
            MemberId                = $member.Id
            OnPremisesSyncEnabled   = $onPremSync
        }
    }
}

$report = @($report) | Sort-Object -Property RoleName, MemberDisplayName

Write-Verbose "Found $($report.Count) total role assignments"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported admin role report ($($report.Count) assignments) to $OutputPath"
}
else {
    Write-Output $report
}
