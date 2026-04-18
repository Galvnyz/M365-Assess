function New-M365BrandingConfig {
    <#
    .SYNOPSIS
        Creates a validated branding hashtable for use with -CustomBranding.
    .DESCRIPTION
        Returns a hashtable with tab-completable, validated parameters that can
        be passed directly to Invoke-M365Assessment -CustomBranding or
        Export-AssessmentReport -CustomBranding. Logo paths are validated at
        call time; hex colors are validated for correct format.
    .PARAMETER CompanyName
        Your company name, shown in the report header and footer.
    .PARAMETER LogoPath
        Path to your company logo (PNG, JPEG, or SVG). Embedded as base64.
    .PARAMETER ClientLogoPath
        Path to the client's logo for white-label cover pages.
    .PARAMETER ClientName
        Client organisation name shown on the cover page "Prepared For" field.
    .PARAMETER AccentColor
        Hex color for the report accent/highlight color (e.g. '#0078D4').
    .PARAMETER PrimaryColor
        Hex color for the primary sidebar/header color.
    .PARAMETER ReportTitle
        Custom report title shown in the browser tab and report header.
    .PARAMETER SidebarSubtitle
        Subtitle shown beneath your company name in the report sidebar.
    .PARAMETER ReportNote
        Short note appended to the executive summary section.
    .PARAMETER Disclaimer
        Confidentiality disclaimer shown in the report footer.
    .PARAMETER FooterText
        Footer text (defaults to "Assessment by <CompanyName>" when WhiteLabel is set).
    .PARAMETER FooterUrl
        URL the footer text links to.
    .EXAMPLE
        PS> $branding = New-M365BrandingConfig -CompanyName 'Contoso Consulting' -LogoPath './logo.png' -AccentColor '#0078D4'
        PS> Invoke-M365Assessment -TenantId 'fabrikam.com' -CustomBranding $branding

        Creates a branding config and passes it to an assessment run.
    .EXAMPLE
        PS> $branding = New-M365BrandingConfig -CompanyName 'Contoso' -ClientName 'Fabrikam' -ClientLogoPath './client.png'
        PS> Export-AssessmentReport -AssessmentFolder '.\Assessment_20260418' -CustomBranding $branding

        Re-renders an existing assessment with client-specific branding.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter()]
        [ValidateNotNullOrEmpty()]
        [string]$CompanyName,

        [Parameter()]
        [ValidateScript({ -not $_ -or (Test-Path -Path $_ -PathType Leaf) })]
        [string]$LogoPath,

        [Parameter()]
        [ValidateScript({ -not $_ -or (Test-Path -Path $_ -PathType Leaf) })]
        [string]$ClientLogoPath,

        [Parameter()]
        [string]$ClientName,

        [Parameter()]
        [ValidatePattern('^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$')]
        [string]$AccentColor,

        [Parameter()]
        [ValidatePattern('^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$')]
        [string]$PrimaryColor,

        [Parameter()]
        [string]$ReportTitle,

        [Parameter()]
        [string]$SidebarSubtitle,

        [Parameter()]
        [string]$ReportNote,

        [Parameter()]
        [string]$Disclaimer,

        [Parameter()]
        [string]$FooterText,

        [Parameter()]
        [string]$FooterUrl
    )

    $config = @{}
    foreach ($key in $PSBoundParameters.Keys) {
        $config[$key] = $PSBoundParameters[$key]
    }
    $config
}
