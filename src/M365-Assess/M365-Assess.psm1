# M365-Assess module loader

# Dot-source orchestrator internal modules
Get-ChildItem -Path "$PSScriptRoot\Orchestrator\*.ps1" | ForEach-Object { . $_.FullName }

# Dot-source shared helpers needed by public cmdlets
. "$PSScriptRoot\Common\SecurityConfigHelper.ps1"
. "$PSScriptRoot\Common\Invoke-SafeGraphRequest.ps1"
. "$PSScriptRoot\Common\Resolve-DnsRecord.ps1"
. "$PSScriptRoot\Common\Resolve-TenantIdentity.ps1"
. "$PSScriptRoot\Common\Export-M365Remediation.ps1"
. "$PSScriptRoot\Orchestrator\Compare-M365Baseline.ps1"
# Dot-source the main orchestrator to import Invoke-M365Assessment function
. $PSScriptRoot\Invoke-M365Assessment.ps1

# Dot-source setup functions
. "$PSScriptRoot\Setup\Grant-M365AssessConsent.ps1"
. "$PSScriptRoot\Setup\Save-M365ConnectionProfile.ps1"
. "$PSScriptRoot\Setup\Get-M365ConnectionProfile.ps1"

# ------------------------------------------------------------------
# Public cmdlet wrappers for security-config collectors
#
# C3 #782 -- DEPRECATED in v2.9.0. These thin wrappers will be removed
# in v3.0.0. The supported invocation surface is Invoke-M365Assessment
# with a -Section parameter. Each wrapper emits a one-time-per-session
# Write-Warning at first call so existing scripts keep working but
# users get notice. See the per-function .NOTES blocks for migration.
# ------------------------------------------------------------------

# Once-per-session deprecation tracker -- avoids spamming the warning
# when a script calls the same wrapper 50 times.
$script:WrapperDeprecationWarned = @{}
function Show-WrapperDeprecation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$WrapperName,
        [Parameter(Mandatory)] [string]$ReplacementSection
    )
    if ($script:WrapperDeprecationWarned[$WrapperName]) { return }
    $script:WrapperDeprecationWarned[$WrapperName] = $true
    Write-Warning ("$WrapperName is deprecated and will be removed in v3.0.0. " +
        "Use 'Invoke-M365Assessment -Section $ReplacementSection' instead.")
}

function Get-M365ExoSecurityConfig {
    <#
    .SYNOPSIS
        Collects Exchange Online security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0.
        Replacement: Invoke-M365Assessment -Section Email
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365ExoSecurityConfig' -ReplacementSection 'Email'
    & "$PSScriptRoot\Exchange-Online\Get-ExoSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365DnsSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates DNS authentication records (SPF, DKIM, DMARC).
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0.
        Replacement: Invoke-M365Assessment -Section Email
    #>
    [CmdletBinding()]
    param(
        [string]$OutputPath,
        [object[]]$AcceptedDomains,
        [object[]]$DkimConfigs
    )
    Show-WrapperDeprecation -WrapperName 'Get-M365DnsSecurityConfig' -ReplacementSection 'Email'
    & "$PSScriptRoot\Exchange-Online\Get-DnsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365EntraSecurityConfig {
    <#
    .SYNOPSIS
        Collects Entra ID security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Identity
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365EntraSecurityConfig' -ReplacementSection 'Identity'
    & "$PSScriptRoot\Entra\Get-EntraSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365CASecurityConfig {
    <#
    .SYNOPSIS
        Evaluates Conditional Access policies against CIS requirements.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Identity
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365CASecurityConfig' -ReplacementSection 'Identity'
    & "$PSScriptRoot\Entra\Get-CASecurityConfig.ps1" @PSBoundParameters
}

function Get-M365EntAppSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates enterprise application and service principal security posture.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Identity
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365EntAppSecurityConfig' -ReplacementSection 'Identity'
    & "$PSScriptRoot\Entra\Get-EntAppSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365IntuneSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates Intune/Endpoint Manager security settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Intune
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365IntuneSecurityConfig' -ReplacementSection 'Intune'
    & "$PSScriptRoot\Intune\Get-IntuneSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365DefenderSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Defender for Office 365 security configuration.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Security
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365DefenderSecurityConfig' -ReplacementSection 'Security'
    & "$PSScriptRoot\Security\Get-DefenderSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365ComplianceSecurityConfig {
    <#
    .SYNOPSIS
        Collects Purview/Compliance security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Security
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365ComplianceSecurityConfig' -ReplacementSection 'Security'
    & "$PSScriptRoot\Security\Get-ComplianceSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365SharePointSecurityConfig {
    <#
    .SYNOPSIS
        Collects SharePoint Online security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Collaboration
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365SharePointSecurityConfig' -ReplacementSection 'Collaboration'
    & "$PSScriptRoot\Collaboration\Get-SharePointSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365TeamsSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Teams security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Collaboration
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365TeamsSecurityConfig' -ReplacementSection 'Collaboration'
    & "$PSScriptRoot\Collaboration\Get-TeamsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365FormsSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Forms security configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Collaboration
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365FormsSecurityConfig' -ReplacementSection 'Collaboration'
    & "$PSScriptRoot\Collaboration\Get-FormsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365PowerBISecurityConfig {
    <#
    .SYNOPSIS
        Collects Power BI security and tenant configuration settings.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section PowerBI
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365PowerBISecurityConfig' -ReplacementSection 'PowerBI'
    & "$PSScriptRoot\PowerBI\Get-PowerBISecurityConfig.ps1" @PSBoundParameters
}

function Get-M365PurviewRetentionConfig {
    <#
    .SYNOPSIS
        Collects Purview data lifecycle retention compliance policy configuration.
    .NOTES
        DEPRECATED (C3 #782). Will be removed in v3.0.0. Replacement: Invoke-M365Assessment -Section Security
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    Show-WrapperDeprecation -WrapperName 'Get-M365PurviewRetentionConfig' -ReplacementSection 'Security'
    & "$PSScriptRoot\Purview\Get-PurviewRetentionConfig.ps1" @PSBoundParameters
}

# ------------------------------------------------------------------
# Export public functions
# ------------------------------------------------------------------
Export-ModuleMember -Function @(
    'Invoke-M365Assessment'
    'Get-M365ExoSecurityConfig'
    'Get-M365DnsSecurityConfig'
    'Get-M365EntraSecurityConfig'
    'Get-M365CASecurityConfig'
    'Get-M365EntAppSecurityConfig'
    'Get-M365IntuneSecurityConfig'
    'Get-M365DefenderSecurityConfig'
    'Get-M365ComplianceSecurityConfig'
    'Get-M365SharePointSecurityConfig'
    'Get-M365TeamsSecurityConfig'
    'Get-M365FormsSecurityConfig'
    'Get-M365PowerBISecurityConfig'
    'Get-M365PurviewRetentionConfig'
    'Compare-M365Baseline'
    'Export-M365Remediation'
    'Grant-M365AssessConsent'
    'New-M365ConnectionProfile'
    'Set-M365ConnectionProfile'
    'Remove-M365ConnectionProfile'
    'Get-M365ConnectionProfile'
)
