# M365-Assess module loader

# Dot-source orchestrator internal modules
Get-ChildItem -Path "$PSScriptRoot\Orchestrator\*.ps1" | ForEach-Object { . $_.FullName }

# Dot-source shared helpers needed by public cmdlets
. "$PSScriptRoot\Common\SecurityConfigHelper.ps1"
. "$PSScriptRoot\Common\Resolve-DnsRecord.ps1"
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
# These thin wrappers delegate to the existing collector scripts,
# allowing them to be called as module-level commands:
#   Import-Module M365-Assess
#   Get-M365ExoSecurityConfig -OutputPath .\results.csv
#
# Each collector is a standalone script that handles its own
# connection checks, data collection, and output formatting.
# ------------------------------------------------------------------

function Get-M365ExoSecurityConfig {
    <#
    .SYNOPSIS
        Collects Exchange Online security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Exchange-Online\Get-ExoSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365DnsSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates DNS authentication records (SPF, DKIM, DMARC).
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    .PARAMETER AcceptedDomains
        Pre-cached accepted domain objects.
    .PARAMETER DkimConfigs
        Pre-cached DKIM signing configuration objects.
    #>
    [CmdletBinding()]
    param(
        [string]$OutputPath,
        [object[]]$AcceptedDomains,
        [object[]]$DkimConfigs
    )
    & "$PSScriptRoot\Exchange-Online\Get-DnsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365EntraSecurityConfig {
    <#
    .SYNOPSIS
        Collects Entra ID security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Entra\Get-EntraSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365CASecurityConfig {
    <#
    .SYNOPSIS
        Evaluates Conditional Access policies against CIS requirements.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Entra\Get-CASecurityConfig.ps1" @PSBoundParameters
}

function Get-M365EntAppSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates enterprise application and service principal security posture.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Entra\Get-EntAppSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365IntuneSecurityConfig {
    <#
    .SYNOPSIS
        Evaluates Intune/Endpoint Manager security settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Intune\Get-IntuneSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365DefenderSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Defender for Office 365 security configuration.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Security\Get-DefenderSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365ComplianceSecurityConfig {
    <#
    .SYNOPSIS
        Collects Purview/Compliance security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Security\Get-ComplianceSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365SharePointSecurityConfig {
    <#
    .SYNOPSIS
        Collects SharePoint Online security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Collaboration\Get-SharePointSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365TeamsSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Teams security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Collaboration\Get-TeamsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365FormsSecurityConfig {
    <#
    .SYNOPSIS
        Collects Microsoft Forms security configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\Collaboration\Get-FormsSecurityConfig.ps1" @PSBoundParameters
}

function Get-M365PowerBISecurityConfig {
    <#
    .SYNOPSIS
        Collects Power BI security and tenant configuration settings.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
    & "$PSScriptRoot\PowerBI\Get-PowerBISecurityConfig.ps1" @PSBoundParameters
}

function Get-M365PurviewRetentionConfig {
    <#
    .SYNOPSIS
        Collects Purview data lifecycle retention compliance policy configuration.
    .PARAMETER OutputPath
        Optional path to export results as CSV.
    #>
    [CmdletBinding()]
    param([string]$OutputPath)
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
    'Grant-M365AssessConsent'
    'New-M365ConnectionProfile'
    'Set-M365ConnectionProfile'
    'Remove-M365ConnectionProfile'
    'Get-M365ConnectionProfile'
)
