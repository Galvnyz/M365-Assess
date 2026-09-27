function Get-CaCoverageEvidence {
    <#
    .SYNOPSIS
        Identifies provable, unconditional all-user CA protection.
    .DESCRIPTION
        Exclusions and conditional targeting require assessor review. Only MFA
        required by an AND grant (or as the sole OR choice), or a built-in MFA
        authentication strength, can establish mandatory MFA. This is supporting
        configuration evidence, not a proof of Security Defaults equivalence.
    .PARAMETER Policies
        Complete set of Conditional Access policies.
    .EXAMPLE
        Get-CaCoverageEvidence -Policies $policies
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.IDictionary])]
    param([Parameter()][AllowEmptyCollection()][object[]]$Policies = @())
    $coverage = [ordered]@{ 'MFA for all users' = $false; 'Legacy auth blocked' = $false; 'Admin MFA' = $false; 'Azure Management MFA' = $false }
    foreach ($policy in $Policies) {
        if ($policy.state -ne 'enabled' -or -not $policy.grantControls) { continue }
        $conditions = $policy.conditions
        $users = $conditions.users
        $apps = $conditions.applications
        if ($users.includeUsers -notcontains 'All' -or $apps.includeApplications -notcontains 'All') { continue }
        if ($users.excludeUsers -or $users.excludeGroups -or $users.excludeRoles -or $users.excludeGuestsOrExternalUsers -or
            $apps.excludeApplications -or $apps.applicationFilter) { continue }
        $restricted = $false
        foreach ($field in @('locations', 'platforms', 'devices', 'userRiskLevels', 'signInRiskLevels', 'servicePrincipalRiskLevels', 'clientApplications', 'authenticationFlows')) {
            if ($conditions.$field) { $restricted = $true }
        }
        if ($restricted) { continue }
        $grant = $policy.grantControls
        $controls = @($grant.builtInControls | Where-Object { $_ })
        $strengthMfa = $grant.authenticationStrength.id -in @(
            '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000004'
        )
        $choices = $controls.Count + @($grant.customAuthenticationFactors | Where-Object { $_ }).Count + @($grant.termsOfUse | Where-Object { $_ }).Count
        if ($grant.authenticationStrength) { $choices++ }
        $mandatory = ($controls -contains 'mfa' -or $strengthMfa) -and
            ($grant.operator -eq 'AND' -or ($grant.operator -eq 'OR' -and $choices -eq 1))
        if ($mandatory -and $conditions.clientAppTypes -contains 'all') {
            $coverage['MFA for all users'] = $true
            $coverage['Admin MFA'] = $true
            $coverage['Azure Management MFA'] = $true
        }
        if ($controls -contains 'block' -and ($conditions.clientAppTypes -contains 'all' -or
            ($conditions.clientAppTypes -contains 'exchangeActiveSync' -and $conditions.clientAppTypes -contains 'other'))) {
            $coverage['Legacy auth blocked'] = $true
        }
    }
    return $coverage
}
