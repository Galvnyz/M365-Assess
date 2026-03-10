#Requires -Version 7.0
<#
.SYNOPSIS
    Runs a comprehensive read-only Microsoft 365 environment assessment.
.DESCRIPTION
    Orchestrates all M365 assessment collector scripts to produce a folder of CSV
    reports covering identity, email, security, devices, collaboration, and hybrid
    sync. Each section runs independently — failures in one section do not block
    others. All operations are strictly read-only (Get-* cmdlets only).

    Designed for IT consultants assessing SMB clients (10-500 users) with
    Microsoft-based cloud environments.
.NOTES
    Version: 0.4.0
    Author:  Daren9m
.PARAMETER Section
    One or more assessment sections to run. Valid values: Tenant, Identity,
    Licensing, Email, Intune, Security, Collaboration, Hybrid, ScubaGear.
    Defaults to all standard sections (ScubaGear is opt-in only).
.PARAMETER TenantId
    Tenant ID or domain (e.g., 'contoso.onmicrosoft.com').
.PARAMETER OutputFolder
    Root folder for assessment output. A timestamped subfolder is created
    automatically. Defaults to '.\M365-Assessment'.
.PARAMETER SkipConnection
    Use pre-existing service connections instead of connecting automatically.
.PARAMETER ClientId
    Application (client) ID for app-only authentication.
.PARAMETER CertificateThumbprint
    Certificate thumbprint for app-only authentication.
.PARAMETER UserPrincipalName
    User principal name (e.g., 'admin@contoso.onmicrosoft.com') for interactive
    authentication to Exchange Online and Purview. Specifying this can bypass
    Windows Authentication Manager (WAM) broker errors on some systems.
.PARAMETER ScubaProductNames
    ScubaGear product codes to assess. Only used when the ScubaGear section is
    selected. Defaults to all six products.
.PARAMETER UseDeviceCode
    Use device code authentication flow instead of browser-based interactive auth.
    Displays a code and URL that you can open in any browser profile, which is
    useful on machines with multiple Edge profiles (e.g., corporate + GCC).
    Note: Purview (Security & Compliance) does not support device code and will
    fall back to browser-based or UPN-hint authentication.
.PARAMETER M365Environment
    Target cloud environment for all service connections. Commercial and GCC
    use standard endpoints. GCCHigh and DoD use sovereign cloud endpoints.
    Auto-detected from tenant metadata when not explicitly specified.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com'

    Runs a full assessment with interactive authentication and exports CSVs.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -Section Identity,Email -TenantId 'contoso.onmicrosoft.com'

    Runs only the Identity and Email sections.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -SkipConnection

    Runs all sections using pre-existing service connections.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' -ClientId '00000000-0000-0000-0000-000000000000' -CertificateThumbprint 'ABC123'

    Runs a full assessment using certificate-based app-only auth.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.com' -UserPrincipalName 'admin@contoso.onmicrosoft.com'

    Runs a full assessment using UPN-based auth for EXO/Purview (avoids WAM broker errors).
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -TenantId 'contoso.onmicrosoft.us' -UseDeviceCode

    Runs a full assessment using device code auth. You choose which browser profile
    to authenticate in (useful for multi-profile machines).
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -Section ScubaGear -TenantId 'contoso.onmicrosoft.com'

    Runs only the CISA ScubaGear baseline compliance scan.
.EXAMPLE
    PS> .\Invoke-M365Assessment.ps1 -Section Tenant,Identity,ScubaGear -TenantId 'contoso.onmicrosoft.com'

    Runs Tenant and Identity sections plus the ScubaGear baseline scan.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('Tenant', 'Identity', 'Licensing', 'Email', 'Intune', 'Security', 'Collaboration', 'Hybrid', 'Inventory', 'ActiveDirectory', 'ScubaGear')]
    [string[]]$Section = @('Tenant', 'Identity', 'Licensing', 'Email', 'Intune', 'Security', 'Collaboration', 'Hybrid'),

    [Parameter()]
    [string]$TenantId,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputFolder = '.\M365-Assessment',

    [Parameter()]
    [switch]$SkipConnection,

    [Parameter()]
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [string]$UserPrincipalName,

    [Parameter()]
    [switch]$UseDeviceCode,

    [Parameter()]
    [ValidateSet('aad', 'defender', 'exo', 'powerplatform', 'sharepoint', 'teams')]
    [string[]]$ScubaProductNames = @('aad', 'defender', 'exo', 'powerplatform', 'sharepoint', 'teams'),

    [Parameter()]
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
    [string]$M365Environment = 'commercial'
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------
# Version
# ------------------------------------------------------------------
$script:AssessmentVersion = '0.4.0'

# Resolve project root for collector and helper paths
$projectRoot = Split-Path -Parent $PSCommandPath

# ------------------------------------------------------------------
# Interactive Wizard (launched when no parameters are supplied)
# ------------------------------------------------------------------
function Show-InteractiveWizard {
    <#
    .SYNOPSIS
        Presents an interactive menu-driven wizard for configuring the assessment.
    .DESCRIPTION
        Walks the user through selecting sections, tenant, auth method, and output
        folder. Returns a hashtable of parameter values to drive the assessment.
    #>
    [CmdletBinding()]
    param()

    # Colorblind-friendly palette
    $cBorder  = 'Cyan'
    $cPrompt  = 'Yellow'
    $cNormal  = 'White'
    $cMuted   = 'DarkGray'
    $cSuccess = 'Cyan'
    $cError   = 'Magenta'

    # Section definitions with default selection state
    # Use string keys to avoid OrderedDictionary int-key vs ordinal-index ambiguity (GitHub #3)
    $sections = [ordered]@{
        '1'  = @{ Name = 'Tenant';          Label = 'Tenant Information';           Selected = $true }
        '2'  = @{ Name = 'Identity';        Label = 'Identity & Access';            Selected = $true }
        '3'  = @{ Name = 'Licensing';       Label = 'Licensing';                    Selected = $true }
        '4'  = @{ Name = 'Email';           Label = 'Email & Exchange';             Selected = $true }
        '5'  = @{ Name = 'Intune';          Label = 'Intune Devices';               Selected = $true }
        '6'  = @{ Name = 'Security';        Label = 'Security';                     Selected = $true }
        '7'  = @{ Name = 'Collaboration';   Label = 'Collaboration';                Selected = $true }
        '8'  = @{ Name = 'Hybrid';          Label = 'Hybrid Sync';                  Selected = $true }
        '9'  = @{ Name = 'Inventory';       Label = 'M&A Inventory (opt-in)';       Selected = $false }
        '10' = @{ Name = 'ActiveDirectory'; Label = 'Active Directory (RSAT)';      Selected = $false }
        '11' = @{ Name = 'ScubaGear';       Label = 'ScubaGear Baseline (PS 5.1)';  Selected = $false }
    }

    # --- Header ---
    function Show-Header {
        Clear-Host
        Write-Host ''
        Write-Host '      ███╗   ███╗ ██████╗  ██████╗ ███████╗' -ForegroundColor Cyan
        Write-Host '      ████╗ ████║ ╚════██╗ ██╔════╝ ██╔════╝' -ForegroundColor Cyan
        Write-Host '      ██╔████╔██║  █████╔╝ ██████╗  ███████╗' -ForegroundColor Cyan
        Write-Host '      ██║╚██╔╝██║  ╚═══██╗ ██╔══██╗ ╚════██║' -ForegroundColor Cyan
        Write-Host '      ██║ ╚═╝ ██║ ██████╔╝ ╚█████╔╝ ███████║' -ForegroundColor Cyan
        Write-Host '      ╚═╝     ╚═╝ ╚═════╝   ╚════╝  ╚══════╝' -ForegroundColor Cyan
        Write-Host '     ─────────────────────────────────────────' -ForegroundColor DarkCyan
        Write-Host '       █████╗ ███████╗███████╗███████╗███████╗███████╗' -ForegroundColor DarkCyan
        Write-Host '      ██╔══██╗██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝' -ForegroundColor DarkCyan
        Write-Host '      ███████║███████╗███████╗█████╗  ███████╗███████╗' -ForegroundColor DarkCyan
        Write-Host '      ██╔══██║╚════██║╚════██║██╔══╝  ╚════██║╚════██║' -ForegroundColor DarkCyan
        Write-Host '      ██║  ██║███████║███████║███████╗███████║███████║' -ForegroundColor DarkCyan
        Write-Host '      ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝╚══════╝' -ForegroundColor DarkCyan
        Write-Host ''
        Write-Host '        ░▒▓█  M365 Environment Assessment  █▓▒░' -ForegroundColor DarkGray
        Write-Host '        ░▒▓█  by  D A R E N 9 M            █▓▒░' -ForegroundColor DarkCyan
        Write-Host ''
    }

    function Show-StepHeader {
        param([int]$Step, [int]$Total, [string]$Title)
        Write-Host "  STEP $Step of $Total`: $Title" -ForegroundColor $cPrompt
        Write-Host '  ─────────────────────────────────────────────────────────' -ForegroundColor $cMuted
        Write-Host ''
    }

    # ================================================================
    # STEP 1: Select Assessment Sections
    # ================================================================
    $step1Done = $false
    while (-not $step1Done) {
        Show-Header
        Show-StepHeader -Step 1 -Total 5 -Title 'Select Assessment Sections'
        Write-Host '  Toggle sections by number, separated by spaces (e.g. 3 or 1 5 10).' -ForegroundColor $cNormal
        Write-Host '  Press ENTER when done.' -ForegroundColor $cMuted
        Write-Host ''

        foreach ($key in $sections.Keys) {
            $s = $sections[$key]
            $marker = if ($s.Selected) { '●' } else { '○' }
            $color = if ($s.Selected) { $cNormal } else { $cMuted }
            Write-Host "  [$key] $marker $($s.Label)" -ForegroundColor $color
        }

        Write-Host ''
        Write-Host '  [S] Standard    [A] Select all    [N] Select none' -ForegroundColor $cPrompt
        Write-Host ''
        Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
        $userChoice = Read-Host

        switch ($userChoice.Trim().ToUpper()) {
            'S' {
                # Standard sections only (deselect opt-in)
                # Rebuild dictionary to avoid PS OrderedDictionary in-place mutation bug
                $optInSections = @('Inventory', 'ActiveDirectory', 'ScubaGear')
                $rebuilt = [ordered]@{}
                foreach ($k in @($sections.Keys)) {
                    $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = ($sections[$k].Name -notin $optInSections) }
                }
                $sections = $rebuilt
            }
            'A' {
                # All sections including opt-in
                $rebuilt = [ordered]@{}
                foreach ($k in @($sections.Keys)) {
                    $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = $true }
                }
                $sections = $rebuilt
            }
            'N' {
                $rebuilt = [ordered]@{}
                foreach ($k in @($sections.Keys)) {
                    $rebuilt["$k"] = @{ Name = $sections[$k].Name; Label = $sections[$k].Label; Selected = $false }
                }
                $sections = $rebuilt
            }
            '' {
                $selectedNames = @($sections.Values | Where-Object { $_.Selected } | ForEach-Object { $_.Name })
                if ($selectedNames.Count -eq 0) {
                    Write-Host ''
                    Write-Host '  ✗ Please select at least one section.' -ForegroundColor $cError
                    Start-Sleep -Seconds 1
                }
                else {
                    $step1Done = $true
                }
            }
            default {
                # Toggle sections by number (space or comma separated, e.g. "1 3 5" or "10")
                $tokens = $userChoice.Trim() -split '[,\s]+'
                foreach ($token in $tokens) {
                    $num = 0
                    if ($token -ne '' -and [int]::TryParse($token, [ref]$num) -and $sections.Contains("$num")) {
                        $sections["$num"].Selected = -not $sections["$num"].Selected
                    }
                }
            }
        }
    }

    $selectedSections = @($sections.Values | Where-Object { $_.Selected } | ForEach-Object { $_.Name })

    # ================================================================
    # STEP 2: Tenant Identity
    # ================================================================
    Show-Header
    Show-StepHeader -Step 2 -Total 4 -Title 'Tenant Identity'
    Write-Host '  Enter your tenant ID or domain' -ForegroundColor $cNormal
    Write-Host '  (e.g., contoso.onmicrosoft.com):' -ForegroundColor $cMuted
    Write-Host ''
    Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
    $tenantInput = Read-Host

    # ================================================================
    # STEP 3: Authentication Method
    # ================================================================
    $step3Done = $false
    $authMethod = 'Interactive'
    $wizClientId = ''
    $wizCertThumb = ''
    $wizUpn = ''

    while (-not $step3Done) {
        Show-Header
        Show-StepHeader -Step 3 -Total 4 -Title 'Authentication Method'

        Write-Host '  [1] Interactive login (browser popup)' -ForegroundColor $cNormal
        Write-Host '  [2] Device code login (choose your browser)' -ForegroundColor $cNormal
        Write-Host '  [3] Certificate-based (app-only)' -ForegroundColor $cNormal
        Write-Host '  [4] Skip connection (already connected)' -ForegroundColor $cNormal
        Write-Host ''
        Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
        $authInput = Read-Host

        switch ($authInput.Trim()) {
            '1' {
                $authMethod = 'Interactive'
                Write-Host ''
                Write-Host '  Enter admin UPN for EXO/Purview (optional, press ENTER to skip):' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizUpn = Read-Host
                $step3Done = $true
            }
            '2' {
                $authMethod = 'DeviceCode'
                $step3Done = $true
            }
            '3' {
                $authMethod = 'Certificate'
                Write-Host ''
                Write-Host '  Enter Application (Client) ID:' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizClientId = Read-Host
                Write-Host '  Enter Certificate Thumbprint:' -ForegroundColor $cNormal
                Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
                $wizCertThumb = Read-Host
                $step3Done = $true
            }
            '4' {
                $authMethod = 'Skip'
                $step3Done = $true
            }
            default {
                Write-Host '  ✗ Please enter 1, 2, 3, or 4.' -ForegroundColor $cError
                Start-Sleep -Seconds 1
            }
        }
    }

    # ================================================================
    # STEP 4: Output Folder
    # ================================================================
    $defaultOutput = '.\M365-Assessment'
    Show-Header
    Show-StepHeader -Step 4 -Total 4 -Title 'Output Folder'
    Write-Host '  Assessment results will be saved to:' -ForegroundColor $cNormal
    Write-Host "    $defaultOutput\" -ForegroundColor $cSuccess
    Write-Host ''
    Write-Host '  Press ENTER to accept, or type a custom path:' -ForegroundColor $cMuted
    do {
        $outputValid = $true
        Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
        $outputInput = Read-Host
        if ($outputInput.Trim()) {
            # Reject values that look like email/UPN rather than a folder path
            if ($outputInput.Trim() -match '@') {
                Write-Host ''
                Write-Host '  That looks like an email address or UPN, not a folder path.' -ForegroundColor $cError
                Write-Host "  Press ENTER to use the default ($defaultOutput), or type a valid path:" -ForegroundColor $cMuted
                $outputValid = $false
            }
            # Reject paths containing characters invalid on Windows
            elseif ($outputInput.Trim() -match '[<>"|?*]') {
                Write-Host ''
                Write-Host '  Path contains invalid characters ( < > " | ? * ).' -ForegroundColor $cError
                Write-Host "  Press ENTER to use the default ($defaultOutput), or type a valid path:" -ForegroundColor $cMuted
                $outputValid = $false
            }
        }
    } while (-not $outputValid)
    $wizOutputFolder = if ($outputInput.Trim()) { $outputInput.Trim() } else { $defaultOutput }

    # ================================================================
    # Confirmation
    # ================================================================
    Show-Header

    $sectionDisplay = $selectedSections -join ', '
    $tenantDisplay = if ($tenantInput.Trim()) { $tenantInput.Trim() } else { '(not specified)' }
    $authDisplay = switch ($authMethod) {
        'Interactive'  {
            if ($wizUpn.Trim()) { "Interactive login ($($wizUpn.Trim()))" }
            else { 'Interactive login' }
        }
        'DeviceCode'   { 'Device code login' }
        'Certificate'  { 'Certificate-based (app-only)' }
        'Skip'         { 'Pre-existing connections' }
    }

    Write-Host '  ═══════════════════════════════════════════════════════' -ForegroundColor $cBorder
    Write-Host ''
    Write-Host '  Ready to start assessment:' -ForegroundColor $cPrompt
    Write-Host ''
    Write-Host "    Sections:  $sectionDisplay" -ForegroundColor $cNormal
    Write-Host "    Tenant:    $tenantDisplay" -ForegroundColor $cNormal
    Write-Host "    Auth:      $authDisplay" -ForegroundColor $cNormal
    if ($M365Environment -ne 'commercial') {
        Write-Host "    Cloud:     $M365Environment" -ForegroundColor $cNormal
    }
    Write-Host "    Output:    $wizOutputFolder\" -ForegroundColor $cNormal
    Write-Host ''
    Write-Host '  Press ENTER to begin, or Q to quit.' -ForegroundColor $cPrompt
    Write-Host '  > ' -ForegroundColor $cPrompt -NoNewline
    $confirmInput = Read-Host

    if ($confirmInput.Trim().ToUpper() -eq 'Q') {
        Write-Host ''
        Write-Host '  Assessment cancelled.' -ForegroundColor $cMuted
        return $null
    }

    # Build result hashtable
    $wizardResult = @{
        Section      = $selectedSections
        OutputFolder = $wizOutputFolder
    }

    if ($tenantInput.Trim()) {
        $wizardResult['TenantId'] = $tenantInput.Trim()
    }

    switch ($authMethod) {
        'Skip' {
            $wizardResult['SkipConnection'] = $true
        }
        'Certificate' {
            if ($wizClientId.Trim()) { $wizardResult['ClientId'] = $wizClientId.Trim() }
            if ($wizCertThumb.Trim()) { $wizardResult['CertificateThumbprint'] = $wizCertThumb.Trim() }
        }
        'DeviceCode' {
            $wizardResult['UseDeviceCode'] = $true
        }
        'Interactive' {
            if ($wizUpn.Trim()) { $wizardResult['UserPrincipalName'] = $wizUpn.Trim() }
        }
    }

    return $wizardResult
}

# ------------------------------------------------------------------
# Helper: Resolve-M365Environment — auto-detect cloud via OpenID
# ------------------------------------------------------------------
function Resolve-M365Environment {
    <#
    .SYNOPSIS
        Detects the M365 cloud environment for a tenant using the public OpenID
        Connect discovery endpoint (no authentication required).
    .DESCRIPTION
        Queries the well-known OpenID configuration to determine whether a tenant
        is Commercial, GCC, GCC High, or DoD. Tries the commercial authority first
        (handles legacy GCC High .com domains), then falls back to the US Government
        authority if the tenant is not found.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId
    )

    $authorities = @(
        'https://login.microsoftonline.com'
        'https://login.microsoftonline.us'
    )

    foreach ($authority in $authorities) {
        $url = "$authority/$TenantId/v2.0/.well-known/openid-configuration"
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 -ErrorAction Stop

            # Parse region fields to determine cloud environment
            $regionScope    = $response.tenant_region_scope
            $regionSubScope = $response.tenant_region_sub_scope

            if ($regionSubScope -eq 'GCC') {
                return 'gcc'
            }
            if ($regionScope -eq 'USGov') {
                # Cannot distinguish GCC High from DoD pre-auth; default to gcchigh
                return 'gcchigh'
            }
            return 'commercial'
        }
        catch {
            # Tenant not found on this authority, try next
            continue
        }
    }

    # Both authorities failed — return $null so caller keeps the current value
    return $null
}

# ------------------------------------------------------------------
# Detect interactive mode: no explicit parameters supplied
# ------------------------------------------------------------------
$isInteractive = -not $PSBoundParameters.ContainsKey('Section') -and
                 -not $PSBoundParameters.ContainsKey('TenantId') -and
                 -not $PSBoundParameters.ContainsKey('SkipConnection') -and
                 -not $PSBoundParameters.ContainsKey('ClientId') -and
                 -not $PSBoundParameters.ContainsKey('OutputFolder')

if ($isInteractive -and [Environment]::UserInteractive) {
    try {
        $wizardParams = Show-InteractiveWizard
    }
    catch {
        Write-Warning "Interactive wizard failed: $($_.Exception.Message)"
        Write-Host ''
        Write-Host '  Run with parameters instead:' -ForegroundColor Yellow
        Write-Host '    ./Invoke-M365Assessment.ps1 -TenantId "contoso.onmicrosoft.com"' -ForegroundColor Cyan
        Write-Host ''
        Write-Host '  For full usage: Get-Help ./Invoke-M365Assessment.ps1 -Full' -ForegroundColor Gray
        return
    }

    if ($null -eq $wizardParams) {
        return
    }

    # Override script parameters with wizard selections
    $Section = $wizardParams['Section']
    $OutputFolder = $wizardParams['OutputFolder']

    if ($wizardParams.ContainsKey('TenantId')) {
        $TenantId = $wizardParams['TenantId']
    }
    if ($wizardParams.ContainsKey('SkipConnection')) {
        $SkipConnection = [switch]$true
    }
    if ($wizardParams.ContainsKey('ClientId')) {
        $ClientId = $wizardParams['ClientId']
    }
    if ($wizardParams.ContainsKey('CertificateThumbprint')) {
        $CertificateThumbprint = $wizardParams['CertificateThumbprint']
    }
    if ($wizardParams.ContainsKey('UserPrincipalName')) {
        $UserPrincipalName = $wizardParams['UserPrincipalName']
    }
}

# ------------------------------------------------------------------
# Helper: Export results to CSV
# ------------------------------------------------------------------
function Export-AssessmentCsv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Data,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if ($Data.Count -eq 0) {
        return 0
    }

    $Data | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    Write-Verbose "$Label`: Exported $($Data.Count) items to $Path"
    return $Data.Count
}

# ------------------------------------------------------------------
# Helper: Write-AssessmentLog — timestamped log file entries
# ------------------------------------------------------------------
function Write-AssessmentLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level,

        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [string]$Detail,

        [Parameter()]
        [string]$Section,

        [Parameter()]
        [string]$Collector
    )

    if (-not $script:logFilePath) { return }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    $prefix = "[$ts] [$Level]"
    if ($Section) { $prefix += " [$Section]" }
    if ($Collector) { $prefix += " [$Collector]" }

    $logLine = "$prefix $Message"
    Add-Content -Path $script:logFilePath -Value $logLine -Encoding UTF8

    if ($Detail) {
        $detailLines = $Detail -split "`n" | ForEach-Object { "    $_" }
        foreach ($line in $detailLines) {
            Add-Content -Path $script:logFilePath -Value $line -Encoding UTF8
        }
    }
}

# ------------------------------------------------------------------
# Helper: Get-RecommendedAction — match error to guidance
# ------------------------------------------------------------------
function Get-RecommendedAction {
    [CmdletBinding()]
    param([string]$ErrorMessage)

    $actionPatterns = @(
        @{ Pattern = 'WAM|broker|RuntimeBroker'; Action = 'WAM broker issue. Try -UseDeviceCode (choose your browser profile), -UserPrincipalName admin@tenant.onmicrosoft.com, certificate auth (-ClientId/-CertificateThumbprint), or -SkipConnection with a pre-existing session.' }
        @{ Pattern = '401|Unauthorized'; Action = 'Re-authenticate or ensure admin consent has been granted for the required scopes.' }
        @{ Pattern = '403|Forbidden|Insufficient privileges'; Action = 'Grant the required Graph/API permissions to the app registration or user account.' }
        @{ Pattern = 'not recognized|not found|not installed'; Action = 'Ensure the required PowerShell module is installed and the service is connected.' }
        @{ Pattern = 'not connected'; Action = 'Connect to the required service before running this section. Check connection errors above.' }
        @{ Pattern = 'timeout|timed out'; Action = 'Network timeout. Check connectivity and retry.' }
    )

    foreach ($entry in $actionPatterns) {
        if ($ErrorMessage -match $entry.Pattern) {
            return $entry.Action
        }
    }
    return 'Review the error details in _Assessment-Log.txt and retry.'
}

# ------------------------------------------------------------------
# Helper: Export-IssueReport — write _Assessment-Issues.log
# ------------------------------------------------------------------
function Export-IssueReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Issues,

        [Parameter()]
        [string]$TenantName,

        [Parameter()]
        [string]$OutputPath,

        [Parameter()]
        [string]$Version
    )

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('=' * 80)
    $lines.Add('  M365 Assessment Issue Report')
    if ($Version) { $lines.Add("  Version:   v$Version") }
    $lines.Add("  Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    if ($TenantName) { $lines.Add("  Tenant:    $TenantName") }
    if ($OutputPath) { $lines.Add("  Output:    $OutputPath") }
    $lines.Add('=' * 80)
    $lines.Add('')

    $total = $Issues.Count
    $idx = 0
    foreach ($issue in $Issues) {
        $idx++
        $lines.Add("--- Issue $idx / $total " + ('-' * 50))
        $lines.Add("Severity:    $($issue.Severity)")
        $lines.Add("Section:     $($issue.Section)")
        $lines.Add("Collector:   $($issue.Collector)")
        $lines.Add("Description: $($issue.Description)")
        $lines.Add("Error:       $($issue.ErrorMessage)")
        $lines.Add("Action:      $($issue.Action)")
        $lines.Add('-' * 72)
        $lines.Add('')
    }

    $errorCount = ($Issues | Where-Object { $_.Severity -eq 'ERROR' }).Count
    $warnCount = ($Issues | Where-Object { $_.Severity -eq 'WARNING' }).Count
    $infoCount = ($Issues | Where-Object { $_.Severity -eq 'INFO' }).Count

    $lines.Add('=' * 80)
    $lines.Add("  Summary: $errorCount errors, $warnCount warnings, $infoCount info")
    $lines.Add('=' * 80)

    Set-Content -Path $Path -Value ($lines -join "`n") -Encoding UTF8
}

# ------------------------------------------------------------------
# Console display helpers (colorblind-friendly palette)
# ------------------------------------------------------------------
function Show-AssessmentHeader {
    [CmdletBinding()]
    param([string]$TenantName, [string]$OutputPath, [string]$LogPath, [string]$Version)

    Write-Host ''
    Write-Host '      ███╗   ███╗ ██████╗  ██████╗ ███████╗' -ForegroundColor Cyan
    Write-Host '      ████╗ ████║ ╚════██╗ ██╔════╝ ██╔════╝' -ForegroundColor Cyan
    Write-Host '      ██╔████╔██║  █████╔╝ ██████╗  ███████╗' -ForegroundColor Cyan
    Write-Host '      ██║╚██╔╝██║  ╚═══██╗ ██╔══██╗ ╚════██║' -ForegroundColor Cyan
    Write-Host '      ██║ ╚═╝ ██║ ██████╔╝ ╚█████╔╝ ███████║' -ForegroundColor Cyan
    Write-Host '      ╚═╝     ╚═╝ ╚═════╝   ╚════╝  ╚══════╝' -ForegroundColor Cyan
    Write-Host '     ─────────────────────────────────────────' -ForegroundColor DarkCyan
    Write-Host '       █████╗ ███████╗███████╗███████╗███████╗███████╗' -ForegroundColor DarkCyan
    Write-Host '      ██╔══██╗██╔════╝██╔════╝██╔════╝██╔════╝██╔════╝' -ForegroundColor DarkCyan
    Write-Host '      ███████║███████╗███████╗█████╗  ███████╗███████╗' -ForegroundColor DarkCyan
    Write-Host '      ██╔══██║╚════██║╚════██║██╔══╝  ╚════██║╚════██║' -ForegroundColor DarkCyan
    Write-Host '      ██║  ██║███████║███████║███████╗███████║███████║' -ForegroundColor DarkCyan
    Write-Host '      ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚══════╝╚══════╝' -ForegroundColor DarkCyan
    Write-Host ''
    if ($TenantName) {
        $tenantLine = $TenantName
        if ($tenantLine.Length -gt 45) { $tenantLine = $tenantLine.Substring(0, 42) + '...' }
        Write-Host "        ░▒▓█  $tenantLine" -ForegroundColor White
    }
    if ($Version) {
        Write-Host "        ░▒▓█  v$Version  █▓▒░" -ForegroundColor DarkGray
    }
    Write-Host ''
}

function Show-SectionHeader {
    [CmdletBinding()]
    param([string]$Name)

    $label = " $Name "
    $lineLength = 56
    $remaining = $lineLength - $label.Length - 3
    if ($remaining -lt 3) { $remaining = 3 }
    $line = "---${label}" + ('-' * $remaining)
    Write-Host "  $line" -ForegroundColor Cyan
}

function Show-CollectorResult {
    [CmdletBinding()]
    param(
        [string]$Label,
        [string]$Status,
        [int]$Items,
        [double]$DurationSeconds,
        [string]$ErrorMessage
    )

    $symbol = switch ($Status) {
        'Complete' { [char]0x2713 }
        'Skipped'  { [char]0x25CB }
        'Failed'   { [char]0x2717 }
        default    { '-' }
    }
    $color = switch ($Status) {
        'Complete' { 'Cyan' }
        'Skipped'  { 'DarkGray' }
        'Failed'   { 'Magenta' }
        default    { 'White' }
    }

    $labelPadded = $Label.PadRight(26)

    $detail = switch ($Status) {
        'Complete' { '{0,5} items   {1,5:F1}s' -f $Items, $DurationSeconds }
        'Skipped' {
            if ($ErrorMessage) {
                $shortErr = if ($ErrorMessage.Length -gt 28) { $ErrorMessage.Substring(0, 25) + '...' } else { $ErrorMessage }
                "skipped $([char]0x2014) $shortErr"
            }
            else { 'skipped' }
        }
        'Failed' {
            if ($ErrorMessage) {
                $shortErr = if ($ErrorMessage.Length -gt 28) { $ErrorMessage.Substring(0, 25) + '...' } else { $ErrorMessage }
                "failed  $([char]0x2014) $shortErr"
            }
            else { 'failed' }
        }
        default { '' }
    }

    Write-Host "    $symbol $labelPadded $detail" -ForegroundColor $color
}

function Show-AssessmentSummary {
    [CmdletBinding()]
    param(
        [object[]]$SummaryResults,
        [object[]]$Issues,
        [TimeSpan]$Duration,
        [string]$AssessmentFolder,
        [int]$SectionCount,
        [string]$Version
    )

    $completeCount = @($SummaryResults | Where-Object { $_.Status -eq 'Complete' }).Count
    $skippedCount = @($SummaryResults | Where-Object { $_.Status -eq 'Skipped' }).Count
    $failedCount = @($SummaryResults | Where-Object { $_.Status -eq 'Failed' }).Count
    $totalCollectors = $SummaryResults.Count

    Write-Host ''
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host "    Assessment Complete  $([char]0x00B7)  $($Duration.ToString('mm\:ss')) elapsed" -ForegroundColor Cyan
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "    Sections: $SectionCount    Collectors: $totalCollectors" -ForegroundColor White

    $statsLine = "    $([char]0x2713) Complete: $completeCount"
    if ($skippedCount -gt 0) { $statsLine += "   $([char]0x25CB) Skipped: $skippedCount" }
    if ($failedCount -gt 0) { $statsLine += "   $([char]0x2717) Failed: $failedCount" }
    Write-Host $statsLine -ForegroundColor White

    # Issues summary
    if ($Issues -and $Issues.Count -gt 0) {
        Write-Host ''
        $issueLabel = " Issues ($($Issues.Count)) "
        $issueRemaining = 56 - $issueLabel.Length - 3
        if ($issueRemaining -lt 3) { $issueRemaining = 3 }
        $issueLine = "---${issueLabel}" + ('-' * $issueRemaining)
        Write-Host "  $issueLine" -ForegroundColor Yellow

        foreach ($issue in $Issues) {
            $sym = if ($issue.Severity -eq 'ERROR') { [char]0x2717 } else { [char]0x26A0 }
            $clr = if ($issue.Severity -eq 'ERROR') { 'Magenta' } else { 'Yellow' }
            $desc = $issue.Description
            if ($desc.Length -gt 50) { $desc = $desc.Substring(0, 47) + '...' }
            $collectorDisplay = if ($issue.Collector -and $issue.Collector -ne '(connection)') {
                "$($issue.Collector) $([char]0x2014) "
            }
            elseif ($issue.Collector -eq '(connection)') {
                "$($issue.Section) $([char]0x2014) "
            }
            else { '' }
            Write-Host "    $sym ${collectorDisplay}${desc}" -ForegroundColor $clr
        }

        Write-Host ''
        $logName = if ($script:logFileName) { $script:logFileName } else { '_Assessment-Log.txt' }
        $issueName = if ($script:issueFileName) { $script:issueFileName } else { '_Assessment-Issues.log' }
        $logRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $logName } else { $logName }
        $issueRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $issueName } else { $issueName }
        Write-Host "    Full details: $logRelPath" -ForegroundColor DarkGray
        Write-Host "    Issue report: $issueRelPath" -ForegroundColor DarkGray
    }

    # Report file references
    Write-Host ''
    $reportSuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
    $reportName = "_Assessment-Report${reportSuffix}.html"
    $reportRelPath = if ($AssessmentFolder) { Join-Path $AssessmentFolder $reportName } else { $reportName }
    if (Test-Path -Path $reportRelPath -ErrorAction SilentlyContinue) {
        Write-Host "    HTML report: $reportRelPath" -ForegroundColor Cyan
    }

    if ($Version) {
        Write-Host "    M365 Assessment v$Version" -ForegroundColor DarkGray
    }
    Write-Host '  ░▒▓████████████████████████████████████████████████▓▒░' -ForegroundColor Cyan
    Write-Host ''
}

# ------------------------------------------------------------------
# Section → Service mapping
# ------------------------------------------------------------------
$sectionServiceMap = @{
    'Tenant'        = @('Graph')
    'Identity'      = @('Graph')
    'Licensing'     = @('Graph')
    'Email'         = @('ExchangeOnline')
    'Intune'        = @('Graph')
    'Security'      = @('Graph', 'ExchangeOnline', 'Purview')
    'Collaboration' = @('Graph')
    'Hybrid'           = @('Graph')
    'Inventory'        = @('Graph', 'ExchangeOnline')
    'ActiveDirectory'  = @()
    'ScubaGear'        = @()
}

# ------------------------------------------------------------------
# Section → Graph scopes mapping
# ------------------------------------------------------------------
$sectionScopeMap = @{
    'Tenant'        = @('Organization.Read.All', 'Domain.Read.All', 'Policy.Read.All', 'User.Read.All', 'Group.Read.All')
    'Identity'      = @('User.Read.All', 'AuditLog.Read.All', 'UserAuthenticationMethod.Read.All', 'RoleManagement.Read.Directory', 'Policy.Read.All', 'Application.Read.All', 'Domain.Read.All', 'Directory.Read.All')
    'Licensing'     = @('Organization.Read.All', 'User.Read.All')
    'Intune'        = @('DeviceManagementManagedDevices.Read.All', 'DeviceManagementConfiguration.Read.All')
    'Security'      = @('SecurityEvents.Read.All')
    'Collaboration' = @('SharePointTenantSettings.Read.All', 'TeamSettings.Read.All', 'TeamworkAppSettings.Read.All')
    'Hybrid'           = @('Organization.Read.All', 'Domain.Read.All')
    'Inventory'        = @('Group.Read.All', 'Team.ReadBasic.All', 'TeamMember.Read.All', 'Channel.ReadBasic.All', 'Reports.Read.All', 'Sites.Read.All', 'User.Read.All')
    'ActiveDirectory'  = @()
    'ScubaGear'        = @()
}

# ------------------------------------------------------------------
# Section → Graph submodule mapping (imported before each section)
# ------------------------------------------------------------------
$sectionModuleMap = @{
    'Tenant'        = @('Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.Identity.SignIns')
    'Identity'      = @('Microsoft.Graph.Users', 'Microsoft.Graph.Reports',
                        'Microsoft.Graph.Identity.DirectoryManagement',
                        'Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.Applications')
    'Licensing'     = @('Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.Users')
    'Intune'        = @('Microsoft.Graph.DeviceManagement')
    'Security'      = @('Microsoft.Graph.Security')
    'Collaboration' = @()
    'Hybrid'           = @('Microsoft.Graph.Identity.DirectoryManagement')
    'Inventory'        = @()
    'ActiveDirectory'  = @()
    'ScubaGear'        = @()
}

# ------------------------------------------------------------------
# Collector definitions: Section → ordered list of collectors
# ------------------------------------------------------------------
$collectorMap = [ordered]@{
    'Tenant' = @(
        @{ Name = '01-Tenant-Info';   Script = 'Entra\Get-TenantInfo.ps1'; Label = 'Tenant Information' }
    )
    'Identity' = @(
        @{ Name = '02-User-Summary';           Script = 'Entra\Get-UserSummary.ps1';              Label = 'User Summary' }
        @{ Name = '03-MFA-Report';             Script = 'Entra\Get-MfaReport.ps1';                Label = 'MFA Report' }
        @{ Name = '04-Admin-Roles';            Script = 'Entra\Get-AdminRoleReport.ps1';           Label = 'Admin Roles' }
        @{ Name = '05-Conditional-Access';     Script = 'Entra\Get-ConditionalAccessReport.ps1';   Label = 'Conditional Access' }
        @{ Name = '06-App-Registrations';      Script = 'Entra\Get-AppRegistrationReport.ps1';     Label = 'App Registrations' }
        @{ Name = '07-Password-Policy';        Script = 'Entra\Get-PasswordPolicyReport.ps1';      Label = 'Password Policy' }
        @{ Name = '07b-Entra-Security-Config'; Script = 'Entra\Get-EntraSecurityConfig.ps1';       Label = 'Entra Security Config' }
    )
    'Licensing' = @(
        @{ Name = '08-License-Summary'; Script = 'Entra\Get-LicenseReport.ps1'; Label = 'License Summary'; Params = @{} }
    )
    'Email' = @(
        @{ Name = '09-Mailbox-Summary';  Script = 'Exchange-Online\Get-MailboxSummary.ps1';       Label = 'Mailbox Summary' }
        @{ Name = '10-Mail-Flow';        Script = 'Exchange-Online\Get-MailFlowReport.ps1';       Label = 'Mail Flow' }
        @{ Name = '11-Email-Security';   Script = 'Exchange-Online\Get-EmailSecurityReport.ps1';  Label = 'Email Security' }
        @{ Name = '11b-EXO-Security-Config'; Script = 'Exchange-Online\Get-ExoSecurityConfig.ps1'; Label = 'EXO Security Config' }
    )
    'Intune' = @(
        @{ Name = '13-Device-Summary';       Script = 'Intune\Get-DeviceSummary.ps1';             Label = 'Device Summary' }
        @{ Name = '14-Compliance-Policies';  Script = 'Intune\Get-CompliancePolicyReport.ps1';    Label = 'Compliance Policies' }
        @{ Name = '15-Config-Profiles';      Script = 'Intune\Get-ConfigProfileReport.ps1';       Label = 'Config Profiles' }
    )
    'Security' = @(
        @{ Name = '16-Secure-Score';       Script = 'Security\Get-SecureScoreReport.ps1';   Label = 'Secure Score'; HasSecondary = $true; SecondaryName = '17-Improvement-Actions'; RequiredServices = @('Graph') }
        @{ Name = '18-Defender-Policies';  Script = 'Security\Get-DefenderPolicyReport.ps1'; Label = 'Defender Policies'; RequiredServices = @('ExchangeOnline') }
        @{ Name = '18b-Defender-Security-Config'; Script = 'Security\Get-DefenderSecurityConfig.ps1'; Label = 'Defender Security Config'; RequiredServices = @('ExchangeOnline') }
        @{ Name = '19-DLP-Policies';       Script = 'Security\Get-DlpPolicyReport.ps1';     Label = 'DLP Policies'; RequiredServices = @('Purview') }
    )
    'Collaboration' = @(
        @{ Name = '20-SharePoint-OneDrive'; Script = 'Collaboration\Get-SharePointOneDriveReport.ps1'; Label = 'SharePoint & OneDrive' }
        @{ Name = '20b-SharePoint-Security-Config'; Script = 'Collaboration\Get-SharePointSecurityConfig.ps1'; Label = 'SharePoint Security Config' }
        @{ Name = '21-Teams-Access';        Script = 'Collaboration\Get-TeamsAccessReport.ps1';         Label = 'Teams Access' }
        @{ Name = '21b-Teams-Security-Config'; Script = 'Collaboration\Get-TeamsSecurityConfig.ps1';    Label = 'Teams Security Config' }
    )
    'Hybrid' = @(
        @{ Name = '22-Hybrid-Sync'; Script = 'ActiveDirectory\Get-HybridSyncReport.ps1'; Label = 'Hybrid Sync' }
    )
    'Inventory' = @(
        @{ Name = '28-Mailbox-Inventory';    Script = 'Inventory\Get-MailboxInventory.ps1';    Label = 'Mailbox Inventory';    RequiredServices = @('ExchangeOnline') }
        @{ Name = '29-Group-Inventory';      Script = 'Inventory\Get-GroupInventory.ps1';      Label = 'Group Inventory';      RequiredServices = @('ExchangeOnline') }
        @{ Name = '30-Teams-Inventory';      Script = 'Inventory\Get-TeamsInventory.ps1';      Label = 'Teams Inventory';      RequiredServices = @('Graph') }
        @{ Name = '31-SharePoint-Inventory'; Script = 'Inventory\Get-SharePointInventory.ps1'; Label = 'SharePoint Inventory'; RequiredServices = @('Graph') }
        @{ Name = '32-OneDrive-Inventory';   Script = 'Inventory\Get-OneDriveInventory.ps1';   Label = 'OneDrive Inventory';   RequiredServices = @('Graph') }
    )
    'ActiveDirectory' = @(
        @{ Name = '23-AD-Domain-Report';      Script = 'ActiveDirectory\Get-ADDomainReport.ps1';      Label = 'AD Domain & Forest' }
        @{ Name = '24-AD-DC-Health';           Script = 'ActiveDirectory\Get-ADDCHealthReport.ps1';    Label = 'AD DC Health'; Params = @{ SkipDcdiag = $true } }
        @{ Name = '25-AD-Replication';         Script = 'ActiveDirectory\Get-ADReplicationReport.ps1'; Label = 'AD Replication' }
        @{ Name = '26-AD-Security';            Script = 'ActiveDirectory\Get-ADSecurityReport.ps1';    Label = 'AD Security' }
    )
    'ScubaGear' = @(
        @{ Name = '27-ScubaGear-Baseline'; Script = 'Security\Invoke-ScubaGearScan.ps1'; Label = 'CISA ScubaGear Baseline'; IsScubaGear = $true }
    )
}

# ------------------------------------------------------------------
# DNS Authentication collector (runs after Email section)
# ------------------------------------------------------------------
$dnsCollector = @{
    Name   = '12-DNS-Authentication'
    Label  = 'DNS Authentication'
}

# ------------------------------------------------------------------
# Auto-detect cloud environment (when not explicitly specified)
# ------------------------------------------------------------------
if ($TenantId -and -not $PSBoundParameters.ContainsKey('M365Environment')) {
    $detectedEnv = Resolve-M365Environment -TenantId $TenantId
    if ($detectedEnv -and $detectedEnv -ne $M365Environment) {
        $envDisplayNames = @{
            'commercial' = 'Commercial'
            'gcc'        = 'GCC'
            'gcchigh'    = 'GCC High'
            'dod'        = 'DoD'
        }
        $M365Environment = $detectedEnv
        Write-Host ''
        Write-Host "  Cloud environment detected: $($envDisplayNames[$detectedEnv])" -ForegroundColor Cyan
        if ($detectedEnv -eq 'gcchigh') {
            Write-Host '  (If this is a DoD tenant, re-run with -M365Environment dod)' -ForegroundColor DarkGray
        }
    }
}

# ------------------------------------------------------------------
# Create timestamped output folder
# ------------------------------------------------------------------
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'

# Extract domain prefix for folder/file naming (Phase A: from TenantId if onmicrosoft)
$script:domainPrefix = ''
if ($TenantId -match '^([^.]+)\.onmicrosoft\.(com|us)$') {
    $script:domainPrefix = $Matches[1]
}

$folderSuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
$assessmentFolder = Join-Path -Path $OutputFolder -ChildPath "Assessment_${timestamp}${folderSuffix}"

try {
    $null = New-Item -Path $assessmentFolder -ItemType Directory -Force
}
catch {
    Write-Error "Failed to create output folder '$assessmentFolder': $_"
    return
}

# ------------------------------------------------------------------
# Initialize log file
# ------------------------------------------------------------------
$logFileSuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
$script:logFileName = "_Assessment-Log${logFileSuffix}.txt"
$script:logFilePath = Join-Path -Path $assessmentFolder -ChildPath $script:logFileName
$logHeaderLines = @(
    ('=' * 80)
    '  M365 Environment Assessment Log'
    "  Version:  v$script:AssessmentVersion"
    "  Started:  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "  Tenant:   $TenantId"
    "  Cloud:    $M365Environment"
    "  Domain:   $($script:domainPrefix)"
)
$logHeaderLines += @(
    "  Sections: $($Section -join ', ')"
    ('=' * 80)
    ''
)
$logHeader = $logHeaderLines
Set-Content -Path $script:logFilePath -Value ($logHeader -join "`n") -Encoding UTF8
Write-AssessmentLog -Level INFO -Message "Assessment started. Output folder: $assessmentFolder"

# ------------------------------------------------------------------
# Show assessment header
# ------------------------------------------------------------------
Show-AssessmentHeader -TenantName $TenantId -OutputPath $assessmentFolder -LogPath $script:logFilePath -Version $script:AssessmentVersion

# ------------------------------------------------------------------
# Prepare service connections (lazy — connected per-section as needed)
# ------------------------------------------------------------------
$connectedServices = [System.Collections.Generic.HashSet[string]]::new()
$failedServices = [System.Collections.Generic.HashSet[string]]::new()

# ------------------------------------------------------------------
# Module compatibility check — Graph SDK and EXO ship conflicting
# versions of Microsoft.Identity.Client (MSAL). Incompatible combos
# cause silent auth failures with no useful error message.
# ------------------------------------------------------------------
if (-not $SkipConnection) {
    $compatErrors = @()

    # EXO 3.8.0+ ships MSAL that conflicts with Graph SDK 2.x
    $exoModule = Get-Module -Name ExchangeOnlineManagement -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1
    $graphModule = Get-Module -Name Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending | Select-Object -First 1

    if ($exoModule -and $exoModule.Version -ge [version]'3.8.0') {
        $compatErrors += "ExchangeOnlineManagement $($exoModule.Version) has known MSAL conflicts with Microsoft.Graph.Authentication. Downgrade to 3.7.1: Uninstall-Module ExchangeOnlineManagement -AllVersions -Force; Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser"

        # msalruntime.dll issue only affects EXO 3.8.0+ — the module buries
        # the DLL in a nested folder that .NET can't find automatically
        $exoNetCorePath = Join-Path -Path $exoModule.ModuleBase -ChildPath 'netCore'
        $msalDllDirect = Join-Path -Path $exoNetCorePath -ChildPath 'msalruntime.dll'
        $msalDllNested = Join-Path -Path $exoNetCorePath -ChildPath 'runtimes\win-x64\native\msalruntime.dll'
        if (-not (Test-Path -Path $msalDllDirect) -and (Test-Path -Path $msalDllNested)) {
            $compatErrors += "msalruntime.dll is missing from EXO module load path. Fix: Copy-Item '$msalDllNested' '$msalDllDirect'"
        }
    }

    # Determine which modules the selected sections actually require
    $needsGraph = $false
    $needsExo   = $false
    foreach ($s in $Section) {
        $svcList = $sectionServiceMap[$s]
        if ($svcList -contains 'Graph')                                    { $needsGraph = $true }
        if ($svcList -contains 'ExchangeOnline' -or $svcList -contains 'Purview') { $needsExo = $true }
    }

    $missingModules = @()
    if ($needsGraph -and -not $graphModule) {
        $missingModules += "Microsoft.Graph.Authentication — Install-Module Microsoft.Graph.Authentication -Scope CurrentUser"
    }
    if ($needsExo -and -not $exoModule) {
        $missingModules += "ExchangeOnlineManagement — Install-Module ExchangeOnlineManagement -RequiredVersion 3.7.1 -Scope CurrentUser"
    }

    if ($missingModules.Count -gt 0) {
        $compatErrors += $missingModules
    }

    if ($compatErrors.Count -gt 0) {
        Write-Host ''
        Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Magenta
        Write-Host '  ║  Module Issue                                            ║' -ForegroundColor Magenta
        Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Magenta
        foreach ($err in $compatErrors) {
            Write-Host "    • $err" -ForegroundColor Yellow
        }
        Write-Host ''
        Write-Host '  Known compatible combo: Graph SDK 2.35.x + EXO 3.7.1' -ForegroundColor DarkGray
        Write-Host '  Also: Always connect Graph BEFORE EXO in the same session.' -ForegroundColor DarkGray
        Write-Host ''
        Write-AssessmentLog -Level ERROR -Message "Module check failed: $($compatErrors -join '; ')"
        Write-Error "Required modules are missing or incompatible. See above for details."
        return
    }

    # Pre-compute combined Graph scopes across all selected sections
    # (Graph scopes must be requested at initial connection time)
    $graphScopes = @()
    foreach ($s in $Section) {
        if ($sectionScopeMap.ContainsKey($s)) {
            $graphScopes += $sectionScopeMap[$s]
        }
    }
    $graphScopes = $graphScopes | Select-Object -Unique

    # Resolve Connect-Service script path
    $connectServicePath = Join-Path -Path $projectRoot -ChildPath 'Common\Connect-Service.ps1'
    if (-not (Test-Path -Path $connectServicePath)) {
        Write-Error "Connect-Service.ps1 not found at '$connectServicePath'."
        return
    }
}

# ------------------------------------------------------------------
# Helper: Connect-RequiredService — connects per-collector services
# Ensures only one non-Graph service (EXO or Purview) is active at a
# time to avoid session conflicts in the ExchangeOnlineManagement module.
# ------------------------------------------------------------------
function Connect-RequiredService {
    [CmdletBinding()]
    param(
        [string[]]$Services,
        [string]$SectionName
    )

    foreach ($svc in $Services) {
        if ($connectedServices.Contains($svc)) { continue }
        if ($failedServices.Contains($svc)) { continue }

        # Friendly display names for host output
        $serviceDisplayName = switch ($svc) {
            'Graph'          { 'Microsoft Graph' }
            'ExchangeOnline' { 'Exchange Online' }
            'Purview'        { 'Purview (Security & Compliance)' }
            default          { $svc }
        }
        Write-Host "    Connecting to $serviceDisplayName..." -ForegroundColor Yellow

        Write-AssessmentLog -Level INFO -Message "Connecting to $svc..." -Section $SectionName
        try {
            # EXO and Purview share the EXO module and conflict if connected simultaneously.
            # Disconnect the other before connecting.
            if ($svc -eq 'ExchangeOnline' -and $connectedServices.Contains('Purview')) {
                Write-AssessmentLog -Level INFO -Message "Disconnecting Purview before connecting ExchangeOnline" -Section $SectionName
                Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
                $connectedServices.Remove('Purview') | Out-Null
            }
            elseif ($svc -eq 'Purview' -and $connectedServices.Contains('ExchangeOnline')) {
                Write-AssessmentLog -Level INFO -Message "Disconnecting ExchangeOnline before connecting Purview" -Section $SectionName
                Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
                $connectedServices.Remove('ExchangeOnline') | Out-Null
            }

            $connectParams = @{ Service = $svc }
            if ($TenantId) { $connectParams['TenantId'] = $TenantId }
            if ($ClientId) { $connectParams['ClientId'] = $ClientId }
            if ($CertificateThumbprint) { $connectParams['CertificateThumbprint'] = $CertificateThumbprint }
            if ($UserPrincipalName -and $svc -ne 'Graph') {
                $connectParams['UserPrincipalName'] = $UserPrincipalName
            }

            if ($svc -eq 'Graph') {
                $connectParams['Scopes'] = $graphScopes
            }

            if ($M365Environment -ne 'commercial') {
                $connectParams['M365Environment'] = $M365Environment
            }
            if ($UseDeviceCode) {
                $connectParams['UseDeviceCode'] = $true
            }

            # Suppress noisy output during connection (skip when device code
            # is active — the user needs to see the code and URL).
            $suppressOutput = -not $UseDeviceCode
            $prevConsoleOut = [Console]::Out
            $prevConsoleError = [Console]::Error
            if ($suppressOutput) {
                [Console]::SetOut([System.IO.TextWriter]::Null)
                [Console]::SetError([System.IO.TextWriter]::Null)
            }
            try {
                if ($suppressOutput) {
                    & $connectServicePath @connectParams 2>$null 6>$null
                }
                else {
                    & $connectServicePath @connectParams
                }
            }
            finally {
                if ($suppressOutput) {
                    [Console]::SetOut($prevConsoleOut)
                    [Console]::SetError($prevConsoleError)
                }
            }

            $connectedServices.Add($svc) | Out-Null
            Write-AssessmentLog -Level INFO -Message "Connected to $svc successfully." -Section $SectionName

            # After first Graph connection, capture connected tenant domain for
            # later use (e.g. ScubaGear PS5 invocation needs explicit Organization).
            if ($svc -eq 'Graph' -and -not $script:resolvedTenantDomain) {
                try {
                    $orgInfo = Get-MgOrganization -ErrorAction Stop | Select-Object -First 1
                    $initialDomain = $orgInfo.VerifiedDomains | Where-Object { $_.IsInitial -eq $true } | Select-Object -First 1
                    if ($initialDomain) {
                        $script:resolvedTenantDomain = $initialDomain.Name
                        $script:resolvedTenantId = $orgInfo.Id
                        $script:resolvedTenantDisplayName = $orgInfo.DisplayName
                        Write-AssessmentLog -Level INFO -Message "Connected tenant: $($script:resolvedTenantDisplayName) ($($script:resolvedTenantDomain)) [ID: $($script:resolvedTenantId)]" -Section $SectionName

                        # Phase B: Rename folder/files to include domain prefix if not already set
                        if (-not $script:domainPrefix -and $script:resolvedTenantDomain -match '^([^.]+)\.onmicrosoft\.(com|us)$') {
                            $script:domainPrefix = $Matches[1]
                            try {
                                # Rename assessment folder (updates both local and script scope)
                                $newFolderName = "Assessment_${timestamp}_$($script:domainPrefix)"
                                Rename-Item -Path $assessmentFolder -NewName $newFolderName -ErrorAction Stop
                                $script:assessmentFolder = Join-Path -Path $OutputFolder -ChildPath $newFolderName
                                $assessmentFolder = $script:assessmentFolder

                                # Update log path to reflect renamed folder BEFORE renaming the file
                                $oldLogName = Split-Path -Leaf $script:logFilePath
                                $script:logFilePath = Join-Path -Path $assessmentFolder -ChildPath $oldLogName

                                # Rename log file
                                $newLogName = "_Assessment-Log_$($script:domainPrefix).txt"
                                Rename-Item -Path $script:logFilePath -NewName $newLogName -ErrorAction Stop
                                $script:logFileName = $newLogName
                                $script:logFilePath = Join-Path -Path $assessmentFolder -ChildPath $newLogName

                                # Update log header with resolved domain prefix
                                $logContent = Get-Content -Path $script:logFilePath -Raw
                                $logContent = $logContent -creplace '(?m)(Domain:\s*)(\r?\n)', "`${1}$($script:domainPrefix)`${2}"
                                Set-Content -Path $script:logFilePath -Value $logContent -Encoding UTF8 -NoNewline

                                Write-AssessmentLog -Level INFO -Message "Renamed output to include tenant domain: $($script:domainPrefix)" -Section $SectionName
                            }
                            catch {
                                Write-AssessmentLog -Level WARN -Message "Could not rename output folder/files: $($_.Exception.Message)" -Section $SectionName
                            }
                        }
                    }
                }
                catch {
                    Write-AssessmentLog -Level WARN -Message "Could not resolve tenant info from Graph: $($_.Exception.Message)" -Section $SectionName
                }
            }
        }
        catch {
            $failedServices.Add($svc) | Out-Null

            # Extract clean one-liner for console
            $friendlyMsg = $_.Exception.Message
            if ($friendlyMsg -match '(.*?)(?:\r?\n|$)') {
                $friendlyMsg = $Matches[1]
            }
            if ($friendlyMsg.Length -gt 70) {
                $friendlyMsg = $friendlyMsg.Substring(0, 67) + '...'
            }

            Write-Host "    $([char]0x26A0) $svc connection failed (see log)" -ForegroundColor Yellow
            Write-AssessmentLog -Level ERROR -Message "$svc connection failed: $friendlyMsg" -Section $SectionName -Detail $_.Exception.ToString()

            $issues.Add([PSCustomObject]@{
                Severity     = 'ERROR'
                Section      = $SectionName
                Collector    = '(connection)'
                Description  = "$svc connection failed"
                ErrorMessage = $friendlyMsg
                Action       = Get-RecommendedAction -ErrorMessage $_.Exception.ToString()
            })
        }
    }
}

# ------------------------------------------------------------------
# Run collectors
# ------------------------------------------------------------------
$summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
$issues = [System.Collections.Generic.List[PSCustomObject]]::new()
$overallStart = Get-Date

foreach ($sectionName in $Section) {
    if (-not $collectorMap.Contains($sectionName)) {
        Write-AssessmentLog -Level WARN -Message "Unknown section '$sectionName' — skipping."
        continue
    }

    $collectors = $collectorMap[$sectionName]
    Show-SectionHeader -Name $sectionName

    # Connect to services: use per-collector RequiredServices if defined,
    # otherwise connect all section-level services up front.
    # This ensures only one non-Graph service is active at a time.
    $hasPerCollectorRequirements = ($collectors | Where-Object { $_.ContainsKey('RequiredServices') }).Count -gt 0
    if (-not $SkipConnection -and -not $hasPerCollectorRequirements) {
        $sectionServices = $sectionServiceMap[$sectionName]
        Connect-RequiredService -Services $sectionServices -SectionName $sectionName
    }

    # Check if ALL section services failed — skip entire section if so
    $sectionServices = $sectionServiceMap[$sectionName]
    $unavailableServices = @($sectionServices | Where-Object { $failedServices.Contains($_) })
    $allSectionServicesFailed = ($unavailableServices.Count -eq $sectionServices.Count -and $sectionServices.Count -gt 0 -and -not $SkipConnection)

    if ($allSectionServicesFailed) {
        $skipReason = "$($unavailableServices -join ', ') not connected"
        foreach ($collector in $collectors) {
            $summaryResults.Add([PSCustomObject]@{
                Section   = $sectionName
                Collector = $collector.Label
                FileName  = "$($collector.Name).csv"
                Status    = 'Skipped'
                Items     = 0
                Duration  = '00:00'
                Error     = $skipReason
            })
            Show-CollectorResult -Label $collector.Label -Status 'Skipped' -Items 0 -DurationSeconds 0 -ErrorMessage $skipReason
            Write-AssessmentLog -Level WARN -Message "Skipped: $($collector.Label) — $skipReason" -Section $sectionName -Collector $collector.Label
        }

        # Also skip DNS collector if Email section services are unavailable
        if ($sectionName -eq 'Email') {
            $summaryResults.Add([PSCustomObject]@{
                Section   = 'Email'
                Collector = $dnsCollector.Label
                FileName  = "$($dnsCollector.Name).csv"
                Status    = 'Skipped'
                Items     = 0
                Duration  = '00:00'
                Error     = $skipReason
            })
            Show-CollectorResult -Label $dnsCollector.Label -Status 'Skipped' -Items 0 -DurationSeconds 0 -ErrorMessage $skipReason
            Write-AssessmentLog -Level WARN -Message "Skipped: $($dnsCollector.Label) — $skipReason" -Section 'Email' -Collector $dnsCollector.Label
        }
        continue
    }

    # Import Graph submodules required by this section's collectors
    if ($sectionModuleMap.ContainsKey($sectionName)) {
        foreach ($mod in $sectionModuleMap[$sectionName]) {
            Import-Module -Name $mod -ErrorAction SilentlyContinue
        }
    }

    foreach ($collector in $collectors) {
        # Per-collector service requirement: connect just-in-time, then check
        if ($collector.ContainsKey('RequiredServices') -and -not $SkipConnection) {
            Connect-RequiredService -Services $collector.RequiredServices -SectionName $sectionName

            $collectorUnavailable = @($collector.RequiredServices | Where-Object { $failedServices.Contains($_) })
            if ($collectorUnavailable.Count -gt 0) {
                $skipReason = "$($collectorUnavailable -join ', ') not connected"
                $summaryResults.Add([PSCustomObject]@{
                    Section   = $sectionName
                    Collector = $collector.Label
                    FileName  = "$($collector.Name).csv"
                    Status    = 'Skipped'
                    Items     = 0
                    Duration  = '00:00'
                    Error     = $skipReason
                })
                Show-CollectorResult -Label $collector.Label -Status 'Skipped' -Items 0 -DurationSeconds 0 -ErrorMessage $skipReason
                Write-AssessmentLog -Level WARN -Message "Skipped: $($collector.Label) — $skipReason" -Section $sectionName -Collector $collector.Label
                continue
            }
        }

        $collectorStart = Get-Date
        $scriptPath = Join-Path -Path $projectRoot -ChildPath $collector.Script
        $csvPath = Join-Path -Path $assessmentFolder -ChildPath "$($collector.Name).csv"
        $status = 'Failed'
        $itemCount = 0
        $errorMessage = ''

        Write-AssessmentLog -Level INFO -Message "Running: $($collector.Label)" -Section $sectionName -Collector $collector.Label

        try {
            if (-not (Test-Path -Path $scriptPath)) {
                throw "Script not found: $scriptPath"
            }

            # Build parameters for the collector
            $collectorParams = @{}
            if ($collector.ContainsKey('Params')) {
                $collectorParams = $collector.Params.Clone()
            }

            # Special handling for Secure Score (two outputs)
            if ($collector.ContainsKey('HasSecondary') -and $collector.HasSecondary) {
                $secondaryCsvPath = Join-Path -Path $assessmentFolder -ChildPath "$($collector.SecondaryName).csv"
                $collectorParams['ImprovementActionsPath'] = $secondaryCsvPath
            }

            # Special handling for ScubaGear (PS5 invocation with passthrough params)
            if ($collector.ContainsKey('IsScubaGear') -and $collector.IsScubaGear) {
                $scubaServices = @{
                    'aad'           = 'Entra ID (Azure AD)'
                    'defender'      = 'Microsoft Defender'
                    'exo'           = 'Exchange Online'
                    'powerplatform' = 'Power Platform'
                    'sharepoint'    = 'SharePoint Online'
                    'teams'         = 'Microsoft Teams'
                }
                $productLabels = ($ScubaProductNames | ForEach-Object { if ($scubaServices.ContainsKey($_)) { $scubaServices[$_] } else { $_ } }) -join ', '
                Write-Host "    ScubaGear runs in PS 5.1 and will authenticate separately for: $productLabels" -ForegroundColor Yellow

                $collectorParams['ProductNames'] = $ScubaProductNames
                $collectorParams['M365Environment'] = $M365Environment
                $collectorParams['ScubaOutputPath'] = Join-Path -Path $assessmentFolder -ChildPath 'ScubaGear-Report'
                $collectorParams['SkipModuleCheck'] = $false

                # Organization is REQUIRED for ScubaGear — without it, PS5 reuses
                # cached tokens which may belong to a different tenant.
                # IMPORTANT: ScubaGear passes Organization to Connect-MgGraph -TenantId.
                # MSAL requires the *.onmicrosoft.com initial domain or tenant GUID —
                # vanity domains (e.g. dz9m.com) are not reliably resolved as tenant hints.
                # Always prefer the resolved initial domain over user-supplied TenantId.
                $scubaOrg = $null
                if ($script:resolvedTenantDomain) {
                    $scubaOrg = $script:resolvedTenantDomain
                }
                if (-not $scubaOrg -and $TenantId) {
                    # ScubaGear is running without a prior Graph connection (standalone mode).
                    # We must resolve the onmicrosoft.com domain via a quick Graph connection,
                    # because vanity domains are not reliable MSAL tenant hints.
                    Write-Host "    Resolving tenant domain via Graph (standalone ScubaGear mode)..." -ForegroundColor Gray
                    try {
                        $scubaConnectParams = @{ Service = 'Graph'; Scopes = @('Organization.Read.All') }
                        $scubaConnectParams['TenantId'] = $TenantId
                        if ($M365Environment -ne 'commercial') {
                            $scubaConnectParams['M365Environment'] = $M365Environment
                        }
                        $prevConsoleOut = [Console]::Out
                        $prevConsoleError = [Console]::Error
                        [Console]::SetOut([System.IO.TextWriter]::Null)
                        [Console]::SetError([System.IO.TextWriter]::Null)
                        try { & $connectServicePath @scubaConnectParams 2>$null 6>$null }
                        finally {
                            [Console]::SetOut($prevConsoleOut)
                            [Console]::SetError($prevConsoleError)
                        }
                        $orgInfo = Get-MgOrganization -ErrorAction Stop | Select-Object -First 1
                        $initialDomain = $orgInfo.VerifiedDomains | Where-Object { $_.IsInitial -eq $true } | Select-Object -First 1
                        if ($initialDomain) {
                            $scubaOrg = $initialDomain.Name
                            Write-AssessmentLog -Level INFO -Message "Resolved tenant domain for ScubaGear: $scubaOrg (from $TenantId)" -Section $SectionName
                        }
                        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
                    }
                    catch {
                        Write-AssessmentLog -Level WARN -Message "Could not resolve tenant domain from Graph: $($_.Exception.Message)" -Section $SectionName
                    }
                    # Final fallback to user-supplied TenantId if resolution failed
                    if (-not $scubaOrg) {
                        $scubaOrg = $TenantId
                    }
                }
                if ($scubaOrg) {
                    $collectorParams['Organization'] = $scubaOrg
                    Write-Host "    ScubaGear target tenant: $scubaOrg" -ForegroundColor Cyan
                    Write-AssessmentLog -Level INFO -Message "ScubaGear Organization set to: $scubaOrg" -Section $SectionName
                }
                else {
                    Write-Host "    WARNING: No tenant domain resolved — ScubaGear may authenticate to a cached/wrong tenant!" -ForegroundColor Red
                    Write-Host "    Re-run with -TenantId to ensure the correct tenant is scanned." -ForegroundColor Red
                    Write-AssessmentLog -Level WARN -Message "ScubaGear Organization parameter is empty. Pass -TenantId to ensure correct tenant." -Section $SectionName
                }

                if ($ClientId) { $collectorParams['AppId'] = $ClientId }
                if ($CertificateThumbprint) { $collectorParams['CertificateThumbprint'] = $CertificateThumbprint }
            }

            # Capture warnings (3>&1) so they go to log instead of console.
            # Suppress error stream (2>$null) to prevent Graph SDK cmdlets from
            # dumping raw API errors to console; terminating errors still propagate
            # to the catch block below via the exception mechanism.
            $rawOutput = & $scriptPath @collectorParams 3>&1 2>$null
            $capturedWarnings = @($rawOutput | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
            $results = @($rawOutput | Where-Object { $null -ne $_ -and $_ -isnot [System.Management.Automation.WarningRecord] })

            # Log captured warnings; track permission-related ones as issues
            $hasPermissionWarning = $false
            foreach ($w in $capturedWarnings) {
                Write-AssessmentLog -Level WARN -Message $w.Message -Section $sectionName -Collector $collector.Label
                if ($w.Message -match '401|403|Unauthorized|Forbidden|permission|consent') {
                    $hasPermissionWarning = $true
                    $issues.Add([PSCustomObject]@{
                        Severity     = 'WARNING'
                        Section      = $sectionName
                        Collector    = $collector.Label
                        Description  = $w.Message
                        ErrorMessage = $w.Message
                        Action       = Get-RecommendedAction -ErrorMessage $w.Message
                    })
                }
            }

            if ($null -ne $results -and @($results).Count -gt 0) {
                $itemCount = Export-AssessmentCsv -Path $csvPath -Data @($results) -Label $collector.Label
                $status = 'Complete'
            }
            else {
                $itemCount = 0
                if ($hasPermissionWarning) {
                    $status = 'Failed'
                    $errorMessage = ($capturedWarnings | Where-Object {
                        $_.Message -match '401|403|Unauthorized|Forbidden|permission|consent'
                    } | Select-Object -First 1).Message
                    Write-AssessmentLog -Level ERROR -Message "Collector returned no data due to permission error" `
                        -Section $sectionName -Collector $collector.Label -Detail $errorMessage
                }
                else {
                    $status = 'Complete'
                    Write-AssessmentLog -Level INFO -Message "No data returned" -Section $sectionName -Collector $collector.Label
                }
            }
        }
        catch {
            $errorMessage = $_.Exception.Message
            if (-not $errorMessage) { $errorMessage = $_.Exception.ToString() }
            if ($errorMessage -match '403|Forbidden|Insufficient privileges') {
                $status = 'Skipped'
                Write-AssessmentLog -Level WARN -Message "Insufficient permissions" -Section $sectionName -Collector $collector.Label -Detail $errorMessage
                $issues.Add([PSCustomObject]@{
                    Severity     = 'WARNING'
                    Section      = $sectionName
                    Collector    = $collector.Label
                    Description  = 'Insufficient permissions'
                    ErrorMessage = $errorMessage
                    Action       = Get-RecommendedAction -ErrorMessage $errorMessage
                })
            }
            elseif ($errorMessage -match 'not found|not installed|not connected') {
                $status = 'Skipped'
                Write-AssessmentLog -Level WARN -Message "Prerequisite not met" -Section $sectionName -Collector $collector.Label -Detail $errorMessage
                $issues.Add([PSCustomObject]@{
                    Severity     = 'WARNING'
                    Section      = $sectionName
                    Collector    = $collector.Label
                    Description  = 'Prerequisite not met'
                    ErrorMessage = $errorMessage
                    Action       = Get-RecommendedAction -ErrorMessage $errorMessage
                })
            }
            else {
                $status = 'Failed'
                Write-AssessmentLog -Level ERROR -Message "Collector failed" -Section $sectionName -Collector $collector.Label -Detail $_.Exception.ToString()
                $issues.Add([PSCustomObject]@{
                    Severity     = 'ERROR'
                    Section      = $sectionName
                    Collector    = $collector.Label
                    Description  = 'Collector error'
                    ErrorMessage = $errorMessage
                    Action       = Get-RecommendedAction -ErrorMessage $errorMessage
                })
            }
        }

        $collectorEnd = Get-Date
        $duration = $collectorEnd - $collectorStart

        $summaryResults.Add([PSCustomObject]@{
            Section   = $sectionName
            Collector = $collector.Label
            FileName  = "$($collector.Name).csv"
            Status    = $status
            Items     = $itemCount
            Duration  = '{0:mm\:ss}' -f $duration
            Error     = $errorMessage
        })

        Show-CollectorResult -Label $collector.Label -Status $status -Items $itemCount -DurationSeconds $duration.TotalSeconds -ErrorMessage $errorMessage
        Write-AssessmentLog -Level INFO -Message "Completed: $($collector.Label) — $status, $itemCount items, $($duration.TotalSeconds.ToString('F1'))s" -Section $sectionName -Collector $collector.Label
    }

    # DNS Authentication: runs after Email section using accepted domains
    if ($sectionName -eq 'Email') {
        $dnsStart = Get-Date
        $dnsCsvPath = Join-Path -Path $assessmentFolder -ChildPath "$($dnsCollector.Name).csv"
        $dnsStatus = 'Skipped'
        $dnsItemCount = 0
        $dnsError = ''

        Write-AssessmentLog -Level INFO -Message "Running: $($dnsCollector.Label)" -Section 'Email' -Collector $dnsCollector.Label

        try {
            $acceptedDomains = Get-AcceptedDomain -ErrorAction Stop
            $dnsResults = foreach ($domain in $acceptedDomains) {
                $domainName = $domain.DomainName

                # ------- SPF -------
                $spf = 'Not configured'
                $spfEnforcement = 'N/A'
                $spfLookupCount = 'N/A'
                $spfDuplicates = 'No'

                try {
                    $txtRecords = @(Resolve-DnsName -Name $domainName -Type TXT -ErrorAction Stop)
                    $spfRecords = @($txtRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=spf1') })

                    if ($spfRecords.Count -gt 1) {
                        $spfDuplicates = "Yes ($($spfRecords.Count) records — PermError)"
                    }

                    if ($spfRecords.Count -ge 1) {
                        $spfValue = $spfRecords[0].Strings -join ''
                        $spf = $spfValue

                        # Parse enforcement qualifier
                        if ($spfValue -match '-all$') { $spfEnforcement = 'Hard Fail (-all)' }
                        elseif ($spfValue -match '~all$') { $spfEnforcement = 'Soft Fail (~all)' }
                        elseif ($spfValue -match '\?all$') { $spfEnforcement = 'Neutral (?all)' }
                        elseif ($spfValue -match '\+all$') { $spfEnforcement = 'Pass (+all) WARNING' }
                        else { $spfEnforcement = 'No all mechanism' }

                        # Count DNS-lookup mechanisms (10-lookup limit per RFC 7208)
                        $lookupMechanisms = @(
                            [regex]::Matches($spfValue, '\b(include:|a:|a/|mx:|mx/|ptr:|exists:|redirect=)').Count
                        )
                        $spfLookupCount = "$($lookupMechanisms[0]) / 10"
                        if ($lookupMechanisms[0] -gt 10) {
                            $spfLookupCount = "$($lookupMechanisms[0]) / 10 — EXCEEDS LIMIT"
                        }
                    }
                }
                catch {
                    $spf = 'DNS lookup failed'
                    Write-Verbose "SPF lookup failed for $domainName`: $_"
                }

                # ------- DMARC -------
                $dmarc = 'Not configured'
                $dmarcPolicy = 'N/A'
                $dmarcPct = 'N/A'
                $dmarcReporting = 'N/A'
                $dmarcDuplicates = 'No'

                try {
                    $dmarcTxtRecords = @(Resolve-DnsName -Name "_dmarc.$domainName" -Type TXT -ErrorAction Stop)
                    $dmarcRecords = @($dmarcTxtRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=DMARC1') })

                    if ($dmarcRecords.Count -gt 1) {
                        $dmarcDuplicates = "Yes ($($dmarcRecords.Count) records — PermError)"
                    }

                    if ($dmarcRecords.Count -ge 1) {
                        $dmarcValue = $dmarcRecords[0].Strings -join ''
                        $dmarc = $dmarcValue

                        # Parse policy
                        if ($dmarcValue -match 'p=(\w+)') {
                            $dmarcPolicy = $Matches[1]
                            if ($dmarcPolicy -eq 'none') { $dmarcPolicy = 'none (monitoring only)' }
                        }

                        # Parse percentage
                        if ($dmarcValue -match 'pct=(\d+)') {
                            $dmarcPct = "$($Matches[1])%"
                        }
                        else {
                            $dmarcPct = '100% (default)'
                        }

                        # Parse reporting
                        $reportingParts = @()
                        if ($dmarcValue -match 'rua=([^;]+)') { $reportingParts += "rua=$($Matches[1])" }
                        if ($dmarcValue -match 'ruf=([^;]+)') { $reportingParts += "ruf=$($Matches[1])" }
                        $dmarcReporting = if ($reportingParts.Count -gt 0) { $reportingParts -join '; ' } else { 'No reporting configured' }
                    }
                }
                catch {
                    $dmarc = 'Not configured'
                    Write-Verbose "DMARC lookup failed for $domainName`: $_"
                }

                # ------- DKIM (both selectors) -------
                $dkimSelector1 = 'Not configured'
                $dkimSelector2 = 'Not configured'

                try {
                    $dkim1Records = Resolve-DnsName -Name "selector1._domainkey.$domainName" -Type CNAME -ErrorAction Stop
                    if ($dkim1Records.NameHost) { $dkimSelector1 = $dkim1Records.NameHost }
                }
                catch { Write-Verbose "DKIM selector1 lookup failed for $domainName`: $_" }

                try {
                    $dkim2Records = Resolve-DnsName -Name "selector2._domainkey.$domainName" -Type CNAME -ErrorAction Stop
                    if ($dkim2Records.NameHost) { $dkimSelector2 = $dkim2Records.NameHost }
                }
                catch { Write-Verbose "DKIM selector2 lookup failed for $domainName`: $_" }

                # ------- MTA-STS (RFC 8461) -------
                $mtaSts = 'Not configured'
                try {
                    $mtaStsRecords = @(Resolve-DnsName -Name "_mta-sts.$domainName" -Type TXT -ErrorAction Stop)
                    $mtaStsRecord = $mtaStsRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match 'v=STSv1') } | Select-Object -First 1
                    if ($mtaStsRecord) {
                        $mtaSts = $mtaStsRecord.Strings -join ''
                    }
                }
                catch { Write-Verbose "MTA-STS lookup failed for $domainName`: $_" }

                # ------- TLS-RPT (RFC 8460) -------
                $tlsRpt = 'Not configured'
                try {
                    $tlsRptRecords = @(Resolve-DnsName -Name "_smtp._tls.$domainName" -Type TXT -ErrorAction Stop)
                    $tlsRptRecord = $tlsRptRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=TLSRPTv1') } | Select-Object -First 1
                    if ($tlsRptRecord) {
                        $tlsRpt = $tlsRptRecord.Strings -join ''
                    }
                }
                catch { Write-Verbose "TLS-RPT lookup failed for $domainName`: $_" }

                # ------- Public DNS Validation -------
                # Confirm SPF and DMARC are visible from public resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1)
                $publicDnsConfirmed = 'N/A'
                if ($spf -ne 'Not configured' -and $spf -ne 'DNS lookup failed') {
                    $publicChecks = @()
                    foreach ($publicServer in @('8.8.8.8', '1.1.1.1')) {
                        try {
                            $publicTxt = @(Resolve-DnsName -Name $domainName -Type TXT -Server $publicServer -ErrorAction Stop)
                            $publicSpf = $publicTxt | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=spf1') } | Select-Object -First 1
                            if ($publicSpf) { $publicChecks += $publicServer }
                        }
                        catch { Write-Verbose "Public DNS check ($publicServer) failed for $domainName`: $_" }
                    }

                    if ($publicChecks.Count -eq 2) {
                        $publicDnsConfirmed = 'Confirmed (Google + Cloudflare)'
                    }
                    elseif ($publicChecks.Count -eq 1) {
                        $publicDnsConfirmed = "Partial ($($publicChecks[0]) only)"
                    }
                    else {
                        $publicDnsConfirmed = 'NOT visible from public DNS'
                    }
                }

                [PSCustomObject]@{
                    Domain           = $domainName
                    DomainType       = $domain.DomainType
                    Default          = $domain.Default
                    SPF              = if ($spf) { $spf } else { 'Not configured' }
                    SPFEnforcement   = $spfEnforcement
                    SPFLookupCount   = $spfLookupCount
                    SPFDuplicates    = $spfDuplicates
                    DMARC            = if ($dmarc) { $dmarc } else { 'Not configured' }
                    DMARCPolicy      = $dmarcPolicy
                    DMARCPct         = $dmarcPct
                    DMARCReporting   = $dmarcReporting
                    DMARCDuplicates  = $dmarcDuplicates
                    DKIMSelector1    = $dkimSelector1
                    DKIMSelector2    = $dkimSelector2
                    MTASTS           = $mtaSts
                    TLSRPT           = $tlsRpt
                    PublicDNSConfirm = $publicDnsConfirmed
                }
            }

            if ($dnsResults) {
                $dnsItemCount = Export-AssessmentCsv -Path $dnsCsvPath -Data @($dnsResults) -Label $dnsCollector.Label
                $dnsStatus = 'Complete'
            }
            else {
                $dnsStatus = 'Complete'
            }
        }
        catch {
            $dnsError = $_.Exception.Message
            if ($dnsError -match 'not recognized|not found|not connected') {
                $dnsStatus = 'Skipped'
            }
            else {
                $dnsStatus = 'Failed'
            }
            Write-AssessmentLog -Level ERROR -Message "DNS Authentication failed" -Section 'Email' -Collector $dnsCollector.Label -Detail $_.Exception.ToString()
            $issues.Add([PSCustomObject]@{
                Severity     = if ($dnsStatus -eq 'Skipped') { 'WARNING' } else { 'ERROR' }
                Section      = 'Email'
                Collector    = $dnsCollector.Label
                Description  = 'DNS Authentication check failed'
                ErrorMessage = $dnsError
                Action       = Get-RecommendedAction -ErrorMessage $dnsError
            })
        }

        $dnsEnd = Get-Date
        $dnsDuration = $dnsEnd - $dnsStart

        $summaryResults.Add([PSCustomObject]@{
            Section   = 'Email'
            Collector = $dnsCollector.Label
            FileName  = "$($dnsCollector.Name).csv"
            Status    = $dnsStatus
            Items     = $dnsItemCount
            Duration  = '{0:mm\:ss}' -f $dnsDuration
            Error     = $dnsError
        })

        Show-CollectorResult -Label $dnsCollector.Label -Status $dnsStatus -Items $dnsItemCount -DurationSeconds $dnsDuration.TotalSeconds -ErrorMessage $dnsError
        Write-AssessmentLog -Level INFO -Message "Completed: $($dnsCollector.Label) — $dnsStatus, $dnsItemCount items" -Section 'Email' -Collector $dnsCollector.Label
    }
}

# ------------------------------------------------------------------
# Export assessment summary
# ------------------------------------------------------------------
$overallEnd = Get-Date
$overallDuration = $overallEnd - $overallStart

$summarySuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
$summaryCsvPath = Join-Path -Path $assessmentFolder -ChildPath "_Assessment-Summary${summarySuffix}.csv"
$summaryResults | Export-Csv -Path $summaryCsvPath -NoTypeInformation -Encoding UTF8

# ------------------------------------------------------------------
# Export issue report (if any issues exist)
# ------------------------------------------------------------------
if ($issues.Count -gt 0) {
    $issueFileSuffix = if ($script:domainPrefix) { "_$($script:domainPrefix)" } else { '' }
    $script:issueFileName = "_Assessment-Issues${issueFileSuffix}.log"
    $issueReportPath = Join-Path -Path $assessmentFolder -ChildPath $script:issueFileName
    Export-IssueReport -Path $issueReportPath -Issues @($issues) -TenantName $TenantId -OutputPath $assessmentFolder -Version $script:AssessmentVersion
    Write-AssessmentLog -Level INFO -Message "Issue report exported: $issueReportPath ($($issues.Count) issues)"
}

Write-AssessmentLog -Level INFO -Message "Assessment complete. Duration: $($overallDuration.ToString('mm\:ss')). Summary CSV: $summaryCsvPath"

# ------------------------------------------------------------------
# Generate HTML report
# ------------------------------------------------------------------
$reportScriptPath = Join-Path -Path $projectRoot -ChildPath 'Common\Export-AssessmentReport.ps1'
if (Test-Path -Path $reportScriptPath) {
    try {
        $reportParams = @{
            AssessmentFolder = $assessmentFolder
        }
        if ($TenantId) { $reportParams['TenantName'] = $TenantId }

        $reportOutput = & $reportScriptPath @reportParams
        foreach ($line in $reportOutput) {
            Write-AssessmentLog -Level INFO -Message $line
        }
    }
    catch {
        Write-AssessmentLog -Level WARN -Message "HTML report generation failed: $($_.Exception.Message)"
    }
}

# ------------------------------------------------------------------
# Console summary
# ------------------------------------------------------------------
Show-AssessmentSummary -SummaryResults @($summaryResults) -Issues @($issues) -Duration $overallDuration -AssessmentFolder $assessmentFolder -SectionCount $Section.Count -Version $script:AssessmentVersion

# Summary is exported to _Assessment-Summary.csv for programmatic access
