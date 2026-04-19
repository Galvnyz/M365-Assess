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

$report = foreach ($role in $allRoles) {
    try {
        $members = Get-MgDirectoryRoleMember -DirectoryRoleId $role.Id -All
    }
    catch {
        Write-Warning "Failed to retrieve members for role '$($role.DisplayName)': $_"
        continue
    }

    if ($members.Count -eq 0) {
        Write-Verbose "Role '$($role.DisplayName)' has no members, skipping."
        continue
    }

    foreach ($member in $members) {
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

        # OnPremisesSyncEnabled is a user-only property not returned by Get-MgDirectoryRoleMember;
        # fetch it per-user via a targeted Graph call. Leave blank for service principals/groups.
        $onPremSync = ''
        if ($friendlyType -eq 'User') {
            try {
                $userDetail = Get-MgUser -UserId $member.Id -Property 'OnPremisesSyncEnabled' -ErrorAction Stop
                $onPremSync = if ($userDetail.OnPremisesSyncEnabled -eq $true) { 'True' } else { 'False' }
            }
            catch {
                Write-Verbose "Could not fetch OnPremisesSyncEnabled for ${memberDisplayName}: $_"
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
