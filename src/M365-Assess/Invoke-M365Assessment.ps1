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
    Author:  Daren9m
.PARAMETER Section
    One or more assessment sections to run. Valid values: Tenant, Identity,
    Licensing, Email, Intune, Security, Collaboration, Hybrid, PowerBI,
    Inventory, ActiveDirectory, SOC2, ValueOpportunity, All. Defaults to all
    standard sections. Use 'All' to include opt-in sections (Inventory,
    ActiveDirectory, SOC2, ValueOpportunity) in a single value.
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
.PARAMETER ClientSecret
    Client secret for app-only authentication. Less secure than certificate
    auth -- prefer -CertificateThumbprint for production use.
.PARAMETER UserPrincipalName
    User principal name (e.g., 'admin@contoso.onmicrosoft.com') for interactive
    authentication to Exchange Online and Purview. Specifying this can bypass
    Windows Authentication Manager (WAM) broker errors on some systems.
.PARAMETER ManagedIdentity
    Use Azure managed identity authentication. Requires the script to be running
    on an Azure resource with a system-assigned or user-assigned managed identity
    (e.g., Azure VM, Azure Functions, Azure Automation). Purview and Power BI do
    not support managed identity and will fall back with a warning.
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
.PARAMETER SkipPurview
    Skips all Purview-connected collectors (DLP Policies, Compliance Security
    Config, Purview Retention Config) and their Security and Compliance
    connection. Saves ~46 seconds of latency when Purview data is not needed.
.PARAMETER OpenReport
    Automatically open the generated HTML report in the default browser after
    generation. Works on Windows, macOS, and Linux.
.PARAMETER ReportTheme
    Default visual theme baked into the generated HTML report. Users can switch themes
    via the report UI. Valid values: Neon (default), Console, Saas, HighContrast.
.PARAMETER WhiteLabel
    Strips all M365-Assess and GitHub identity from the report (hides the GitHub
    link and open-source attribution in the React app).
.PARAMETER CompactReport
    Omit cover page, executive summary, and compliance overview from the HTML
    report. Produces a lean, findings-focused report. Automatically set by
    -QuickScan unless overridden with -CompactReport:$false.
.PARAMETER QuickScan
    Run only Critical and High severity checks. Useful for CI/CD pipelines
    and daily monitoring. Collectors with no qualifying checks are skipped
    entirely. The report shows a "Quick Scan Mode" banner and automatically
    sets -CompactReport. Override with -CompactReport:$false to keep the
    full report structure.
.PARAMETER SaveBaseline
    Label for a new baseline snapshot. Saves the current assessment results
    to a Baselines subfolder under the output folder. Use with -CompareBaseline
    on a later run to detect policy drift.
.PARAMETER CompareBaseline
    Label of a previously saved baseline to compare against. Generates a drift
    report highlighting settings that changed since the baseline was captured.
    Version-aware: when the registry version differs from the baseline, only
    shared CheckIDs are compared and schema changes are reported separately.
.PARAMETER AutoBaseline
    Automatically saves a dated snapshot after every run and compares against
    the most recent previous auto-snapshot for this tenant. No label management
    required. Ideal for scheduled assessments and continuous drift tracking.
.PARAMETER ListBaselines
    Lists all saved baselines for the tenant (label, date, registry version,
    check count) and exits without running an assessment. Use -TenantId to
    scope results; omit to list baselines for all tenants.
.PARAMETER DryRun
    Show a dry-run preview of what the assessment would do (sections,
    services, Graph scopes, check counts) without connecting or collecting
    data. Useful for validating configuration before a real run.
.PARAMETER ConnectionProfile
    Name of a saved connection profile from .m365assess.json. Use
    Save-M365ConnectionProfile to create profiles. The profile provides
    TenantId, ClientId, auth method, and other connection parameters.
.PARAMETER NonInteractive
    Suppresses all interactive prompts for module installation, EXO downgrade,
    and script unblocking. When a required module is missing or incompatible,
    the exact install/fix command is logged and the script exits with an error.
    When an optional module is missing (e.g., MicrosoftPowerBIMgmt), the
    dependent section is skipped with a warning and the assessment continues.
    Use this switch for CI/CD pipelines, scheduled tasks, and headless
    environments. Also triggered automatically when the session is not
    user-interactive ([Environment]::UserInteractive is false).
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com'

    Full assessment with interactive browser auth.
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -Section All

    Full assessment including all opt-in sections (Inventory, ActiveDirectory,
    SOC2, ValueOpportunity).
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -ClientId '00000000-0000-0000-0000-000000000000' -CertificateThumbprint 'ABC123'

    App-only authentication using a certificate. Recommended for automation.
.EXAMPLE
    PS> Invoke-M365Assessment -ManagedIdentity -Section Tenant,Identity,Security

    Runs selected sections using Azure managed identity (no credentials needed).
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.us' -UseDeviceCode

    Device code auth — choose which browser profile to sign in with.
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -QuickScan

    Critical and High checks only. Produces a compact triage report.
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -AutoBaseline

    Runs assessment and auto-saves a dated snapshot. On subsequent runs,
    generates a drift report showing what changed since the last snapshot.
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -ListBaselines

    Lists all saved baseline snapshots for the tenant without running an assessment.
.EXAMPLE
    PS> Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -Section Identity,Email -DryRun

    Dry-run preview: sections, services, Graph scopes, and check counts —
    no connections made, no data collected.
#>
#Requires -Version 7.0

function Invoke-M365Assessment {
[CmdletBinding(DefaultParameterSetName = 'Interactive')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', 'connectedServices',
    Justification = 'Used by Connect-RequiredService in Orchestrator/ via parent scope')]
param(
    [Parameter()]
    [ValidateSet('Tenant', 'Identity', 'Licensing', 'Email', 'Intune', 'Security', 'Collaboration',
                 'PowerBI', 'Hybrid', 'Inventory', 'ActiveDirectory', 'SOC2', 'ValueOpportunity', 'All')]
    [string[]]$Section = @('Tenant', 'Identity', 'Licensing', 'Email', 'Intune', 'Security', 'Collaboration', 'PowerBI', 'Hybrid'),

    # TenantId: optional in interactive sets; mandatory in app-only sets where the
    # tenant cannot be inferred interactively. Must be listed explicitly in every
    # set — mixing named-set attributes with a bare [Parameter()] (__AllParameterSets)
    # causes parameter-set resolution failures in PowerShell 7.6+.
    [Parameter(ParameterSetName = 'AppOnlyCert',      Mandatory)]
    [Parameter(ParameterSetName = 'AppOnlySecret',    Mandatory)]
    [Parameter(ParameterSetName = 'Interactive')]
    [Parameter(ParameterSetName = 'DeviceCode')]
    [Parameter(ParameterSetName = 'ManagedIdentity')]
    [Parameter(ParameterSetName = 'SkipConnection')]
    [Parameter(ParameterSetName = 'ConnectionProfile')]
    [string]$TenantId,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputFolder = '.\M365-Assessment',

    [Parameter(ParameterSetName = 'SkipConnection', Mandatory)]
    [switch]$SkipConnection,

    [Parameter(ParameterSetName = 'AppOnlyCert',   Mandatory)]
    [Parameter(ParameterSetName = 'AppOnlySecret', Mandatory)]
    [string]$ClientId,

    [Parameter(ParameterSetName = 'AppOnlyCert', Mandatory)]
    [string]$CertificateThumbprint,

    [Parameter(ParameterSetName = 'AppOnlySecret', Mandatory)]
    [SecureString]$ClientSecret,

    [Parameter()]
    [string]$UserPrincipalName,

    [Parameter(ParameterSetName = 'ManagedIdentity', Mandatory)]
    [switch]$ManagedIdentity,

    [Parameter(ParameterSetName = 'DeviceCode', Mandatory)]
    [switch]$UseDeviceCode,

    [Parameter()]
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
    [string]$M365Environment = 'commercial',

    [Parameter()]
    [switch]$SkipPurview,

    [Parameter()]
    [switch]$OpenReport,

    [Parameter()]
    [ValidateSet('Neon', 'Console', 'HighContrast')]
    [string]$ReportTheme = 'Neon',

    [Parameter()]
    [switch]$WhiteLabel,

    [Parameter()]
    [switch]$CompactReport,

    [Parameter()]
    [switch]$NonInteractive,

    [Parameter()]
    [switch]$QuickScan,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [string]$SaveBaseline,

    [Parameter()]
    [string]$CompareBaseline,

    [Parameter()]
    [switch]$AutoBaseline,

    [Parameter()]
    [switch]$ListBaselines,

    [Parameter(ParameterSetName = 'ConnectionProfile', Mandatory)]
    [ArgumentCompleter({
        param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
        $root = Split-Path -Parent $PSCommandPath
        $configPath = Join-Path -Path $root -ChildPath '.m365assess.json'
        if (Test-Path -Path $configPath) {
            try {
                $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json -AsHashtable
                $profiles = if ($config.ContainsKey('profiles')) { $config['profiles'] } else { @{} }
                $profiles.Keys | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $profiles[$_]['tenantId'])
                }
            }
            catch { Write-Verbose "Profile completer: $_" }
        }
    })]
    [string]$ConnectionProfile
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------
# Version — read from module manifest (single source of truth)
# ------------------------------------------------------------------
$projectRoot = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $PSScriptRoot }
$script:AssessmentVersion = (Import-PowerShellDataFile -Path "$projectRoot/M365-Assess.psd1").ModuleVersion


# When invoked directly (not via module), load internal dependencies
if (-not (Get-Command -Name Show-InteractiveWizard -ErrorAction SilentlyContinue)) {
    Get-ChildItem -Path (Join-Path $projectRoot 'Orchestrator') -Filter '*.ps1' |
        ForEach-Object { . $_.FullName }
}
# Show-InteractiveWizard -- extracted to Orchestrator/Show-InteractiveWizard.ps1
# Resolve-M365Environment -- extracted to Orchestrator/Resolve-M365Environment.ps1

# ------------------------------------------------------------------
# Detect interactive mode: no connection parameters supplied
# The wizard should launch whenever the user hasn't told us HOW to
# connect (TenantId, SkipConnection, or app-only auth). Passing
# -Section alone should still trigger the wizard for tenant input.
# ------------------------------------------------------------------
$launchWizard = -not $PSBoundParameters.ContainsKey('TenantId') -and
                -not $PSBoundParameters.ContainsKey('SkipConnection') -and
                -not $PSBoundParameters.ContainsKey('ClientId') -and
                -not $PSBoundParameters.ContainsKey('ManagedIdentity') -and
                -not $PSBoundParameters.ContainsKey('ConnectionProfile')

if ($launchWizard -and [Environment]::UserInteractive) {
    try {
        $wizSplat = @{}
        if ($PSBoundParameters.ContainsKey('Section')) {
            $wizSplat['PreSelectedSections'] = $Section
        }
        if ($PSBoundParameters.ContainsKey('OutputFolder')) {
            $wizSplat['PreSelectedOutputFolder'] = $OutputFolder
        }
        $wizardParams = Show-InteractiveWizard @wizSplat
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

    # Override script parameters with wizard selections, but preserve
    # any values the user already provided on the command line
    if (-not $PSBoundParameters.ContainsKey('Section')) {
        $Section = $wizardParams['Section']
    }
    if (-not $PSBoundParameters.ContainsKey('OutputFolder')) {
        $OutputFolder = $wizardParams['OutputFolder']
    }

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

    # Report options from wizard
    if ($wizardParams.ContainsKey('CompactReport')) {
        $CompactReport = [switch]$true
    }
    if ($wizardParams.ContainsKey('ConnectionProfile') -and -not $PSBoundParameters.ContainsKey('ConnectionProfile')) {
        $ConnectionProfile = $wizardParams['ConnectionProfile']
    }
}

# ------------------------------------------------------------------
# Load connection profile (if specified)
# ------------------------------------------------------------------
if ($ConnectionProfile) {
    $profileHelper = Join-Path -Path $projectRoot -ChildPath 'Setup\Get-M365ConnectionProfile.ps1'
    if (Test-Path -Path $profileHelper) {
        . $profileHelper
        $loadedProfile = Get-M365ConnectionProfile -ProfileName $ConnectionProfile
        if ($loadedProfile) {
            if (-not $TenantId) { $TenantId = $loadedProfile.TenantId }
            if ($loadedProfile.ClientId -and -not $ClientId) { $ClientId = $loadedProfile.ClientId }
            if ($loadedProfile.Thumbprint -and -not $CertificateThumbprint) { $CertificateThumbprint = $loadedProfile.Thumbprint }
            if ($loadedProfile.UPN -and -not $UserPrincipalName) { $UserPrincipalName = $loadedProfile.UPN }
            if ($loadedProfile.Environment -and -not $PSBoundParameters.ContainsKey('M365Environment')) {
                $M365Environment = $loadedProfile.Environment
            }
            if ($loadedProfile.AuthMethod -eq 'DeviceCode' -and -not $UseDeviceCode) { $UseDeviceCode = [switch]$true }
            if ($loadedProfile.AuthMethod -eq 'ManagedIdentity' -and -not $ManagedIdentity) { $ManagedIdentity = [switch]$true }

            # Update last used timestamp
            $saveHelper = Join-Path -Path $projectRoot -ChildPath 'Setup\Save-M365ConnectionProfile.ps1'
            $configPath = Join-Path -Path $projectRoot -ChildPath '.m365assess.json'
            if ((Test-Path -Path $configPath) -and (Test-Path -Path $saveHelper)) {
                try {
                    $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json -AsHashtable
                    if ($config.ContainsKey('profiles') -and $config['profiles'].ContainsKey($ConnectionProfile)) {
                        $config['profiles'][$ConnectionProfile]['lastUsed'] = (Get-Date -Format 'yyyy-MM-dd HH:mm')
                        $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
                    }
                }
                catch { Write-Verbose "Could not update lastUsed timestamp: $_" }
            }

            Write-Host ''
            Write-Host "  Connection profile: $ConnectionProfile ($TenantId)" -ForegroundColor Cyan
        }
        else {
            Write-Error "Connection profile '$ConnectionProfile' not found. Use Get-M365ConnectionProfile to list available profiles."
            return
        }
    }
}

# ------------------------------------------------------------------
# Auto-detect saved credentials from .m365assess.json or cert store
# When TenantId is known but no auth params provided, check for saved
# credentials from a previous Setup run. This enables zero-config
# repeat runs: just provide -TenantId and the rest is automatic.
# ------------------------------------------------------------------
if ($TenantId -and -not $ClientId -and -not $CertificateThumbprint -and
    -not $ManagedIdentity -and -not $UseDeviceCode -and -not $SkipConnection -and
    -not $ClientSecret) {

    $autoDetected = $false

    # Strategy 1: Check .m365assess.json config file
    $configPath = Join-Path $projectRoot '.m365assess.json'
    if (Test-Path $configPath) {
        try {
            $savedConfig = Get-Content -Path $configPath -Raw | ConvertFrom-Json -AsHashtable
            if ($savedConfig.ContainsKey($TenantId)) {
                $entry = $savedConfig[$TenantId]
                $savedThumbprint = $entry['thumbprint']
                # Verify the certificate still exists in the user's cert store
                $savedCert = Get-Item "Cert:\CurrentUser\My\$savedThumbprint" -ErrorAction SilentlyContinue
                if ($savedCert) {
                    $ClientId = $entry['clientId']
                    $CertificateThumbprint = $savedThumbprint
                    $autoDetected = $true
                    $appLabel = if ($entry['appName']) { " ($($entry['appName']))" } else { '' }
                    Write-Verbose "Auto-detected saved credentials for $TenantId$appLabel"
                }
                else {
                    Write-Verbose "Saved cert $savedThumbprint for $TenantId not found in cert store -- skipping auto-detect"
                }
            }
        }
        catch {
            Write-Verbose "Could not read .m365assess.json: $_"
        }
    }

    # Strategy 2: Cert store auto-detect (CN=M365-Assess-{TenantId})
    if (-not $autoDetected) {
        $certSubject = "CN=M365-Assess-$TenantId"
        $matchingCerts = @(Get-ChildItem -Path 'Cert:\CurrentUser\My' -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq $certSubject -and $_.NotAfter -gt (Get-Date) } |
            Sort-Object -Property NotAfter -Descending)
        if ($matchingCerts.Count -gt 0) {
            $detectedCert = $matchingCerts[0]
            $CertificateThumbprint = $detectedCert.Thumbprint
            # Try to find the ClientId from the config file or leave it for manual entry
            if ($savedConfig -and $savedConfig.ContainsKey($TenantId)) {
                $ClientId = $savedConfig[$TenantId]['clientId']
                $autoDetected = $true
                Write-Verbose "Auto-detected cert $certSubject (thumbprint: $CertificateThumbprint) with saved ClientId"
            }
            else {
                Write-Verbose "Found cert $certSubject but no saved ClientId -- certificate auth requires -ClientId"
                $CertificateThumbprint = $null  # Reset -- can't use without ClientId
            }
        }
    }
}


# Assessment helpers (8 functions) -- extracted to Orchestrator/AssessmentHelpers.ps1

# Section maps -- extracted to Orchestrator/AssessmentMaps.ps1
$maps = Get-AssessmentMaps
$sectionServiceMap = $maps.SectionServiceMap
$sectionScopeMap   = $maps.SectionScopeMap
$sectionModuleMap  = $maps.SectionModuleMap
$collectorMap      = $maps.CollectorMap
$dnsCollector      = $maps.DnsCollector

# ------------------------------------------------------------------
# Section 'All' — expand shorthand to full section list
# ------------------------------------------------------------------
if ($Section -contains 'All') {
    $Section = @('Tenant','Identity','Licensing','Email','Intune','Security',
                 'Collaboration','PowerBI','Hybrid','Inventory',
                 'ActiveDirectory','SOC2','ValueOpportunity')
}

# ------------------------------------------------------------------
# ListBaselines — display saved snapshots and exit (no assessment)
# ------------------------------------------------------------------
if ($ListBaselines) {
    $baselineRoot = Join-Path -Path $OutputFolder -ChildPath 'Baselines'
    if (-not (Test-Path -Path $baselineRoot)) {
        Write-Host "No baselines found at '$baselineRoot'." -ForegroundColor Yellow
        return
    }
    $manifests = Get-ChildItem -Path $baselineRoot -Recurse -Filter 'manifest.json' |
        Where-Object { -not $TenantId -or $_.FullName -match [regex]::Escape($TenantId) }
    if ($manifests.Count -eq 0) {
        Write-Host "No baselines found$(if ($TenantId) { " for tenant '$TenantId'" })." -ForegroundColor Yellow
        return
    }
    $rows = foreach ($m in $manifests | Sort-Object LastWriteTime -Descending) {
        try { $data = Get-Content -Path $m.FullName -Raw | ConvertFrom-Json } catch { continue }
        [PSCustomObject]@{
            Label             = $data.Label
            SavedAt           = $data.SavedAt
            RegistryVersion   = $data.RegistryVersion
            AssessmentVersion = $data.AssessmentVersion
            CheckCount        = $data.CheckCount
            TenantId          = $data.TenantId
        }
    }
    $rows | Format-Table -AutoSize
    return
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

# Extract domain prefix for folder/file naming (Phase A: from TenantId)
# Handles onmicrosoft domains (extract prefix) and custom domains (extract label before first dot).
# GUIDs are left empty — Phase B resolves them after Graph connects.
$script:domainPrefix = ''
if ($TenantId -match '^([^.]+)\.onmicrosoft\.(com|us)$') {
    $script:domainPrefix = $Matches[1]
}
elseif ($TenantId -match '^([^.]+)\.' -and $TenantId -notmatch '^[0-9a-f]{8}-') {
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
$connectedServices = [System.Collections.Generic.HashSet[string]]::new()  # used by Connect-RequiredService via scope
$failedServices = [System.Collections.Generic.HashSet[string]]::new()

# ------------------------------------------------------------------
# Module compatibility check — Graph SDK and EXO ship conflicting
# versions of Microsoft.Identity.Client (MSAL). Incompatible combos
# cause silent auth failures with no useful error message.
# ------------------------------------------------------------------

# Module compatibility check -- extracted to Orchestrator/Test-ModuleCompatibility.ps1
if (-not $SkipConnection) {
    $modResult = Test-ModuleCompatibility -Section $Section -SectionServiceMap $sectionServiceMap -NonInteractive:$NonInteractive -SkipDLP:$SkipPurview
    if (-not $modResult.Passed) { return }
    $Section = $modResult.Section

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

# Connect-RequiredService -- extracted to Orchestrator/Connect-RequiredService.ps1

# ------------------------------------------------------------------
# Run collectors
# ------------------------------------------------------------------
$summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
$issues = [System.Collections.Generic.List[PSCustomObject]]::new()
$overallStart = Get-Date


# Blocked scripts check -- extracted to Orchestrator/Test-BlockedScripts.ps1
if (-not (Test-BlockedScripts -ProjectRoot $projectRoot -NonInteractive:$NonInteractive)) { return }

# Initialize real-time security check progress display
$progressHelper = Join-Path -Path $projectRoot -ChildPath 'Common\Show-CheckProgress.ps1'
if (Test-Path -Path $progressHelper) {
    . $progressHelper
    $registryHelper = Join-Path -Path $projectRoot -ChildPath 'Common\Import-ControlRegistry.ps1'
    if (Test-Path -Path $registryHelper) {
        . $registryHelper
        $controlsDir = Join-Path -Path $projectRoot -ChildPath 'controls'
        $progressRegistry = Import-ControlRegistry -ControlsPath $controlsDir
        # Exposed globally so dot-sourced collectors can resolve registry.remediation as fallback
        $global:M365AssessRegistry = $progressRegistry
        if ($progressRegistry.Count -gt 1) {
            # When connections are active, initialize progress silently --
            # the console summary is deferred until Connect-RequiredService
            # resolves tenant licenses after the first Graph connection.
            # When connections are skipped, print immediately (no licenses to resolve).
            $progressParams = @{
                ControlRegistry = $progressRegistry
                ActiveSections  = $Section
            }
            if (-not $SkipConnection) { $progressParams['Silent'] = $true }
            if ($QuickScan) { $progressParams['SeverityFilter'] = @('Critical', 'High') }
            Initialize-CheckProgress @progressParams
        }
    } else {
        Write-Warning "Import-ControlRegistry.ps1 not found - progress tracking disabled."
    }
} else {
    Write-Warning "Show-CheckProgress.ps1 not found - progress display disabled."
}

# Load cross-platform DNS resolver (Resolve-DnsName on Windows, dig on macOS/Linux)
$dnsHelper = Join-Path -Path $projectRoot -ChildPath 'Common\Resolve-DnsRecord.ps1'
if (Test-Path -Path $dnsHelper) { . $dnsHelper }

# Optimize section execution order to minimize service reconnections.
# Group all EXO-dependent sections before Purview-dependent sections so
# that running both Inventory and Security avoids EXO→Purview→EXO thrashing.
$sectionOrder = @(
    'Tenant', 'Identity', 'Licensing', 'Email', 'Intune',
    'Inventory',        # EXO-dependent — run before Security's Purview collectors
    'Security',         # Graph → EXO (Defender) → Purview (DLP/Compliance)
    'Collaboration', 'PowerBI', 'Hybrid',
    'ActiveDirectory', 'SOC2',
    'ValueOpportunity'  # Must run last — reads adoption signals from all other sections
)
$Section = $sectionOrder | Where-Object { $_ -in $Section }

# ------------------------------------------------------------------
# DryRun — preview, then exit
# ------------------------------------------------------------------
if ($DryRun) {
    Write-Host ''
    Write-Host '  ── Dry Run Preview ──' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "  Tenant:       $TenantId" -ForegroundColor White
    Write-Host "  Environment:  $M365Environment" -ForegroundColor White
    Write-Host "  Version:      v$script:AssessmentVersion" -ForegroundColor White
    Write-Host "  Output:       $assessmentFolder" -ForegroundColor White
    if ($QuickScan) { Write-Host '  Mode:         QuickScan (Critical + High only)' -ForegroundColor Yellow }
    Write-Host ''

    # Sections and their services
    Write-Host '  Sections:' -ForegroundColor Cyan
    foreach ($s in $Section) {
        $services = if ($sectionServiceMap.ContainsKey($s) -and $sectionServiceMap[$s].Count -gt 0) { $sectionServiceMap[$s] -join ', ' } else { '(none)' }
        $collectorCount = if ($collectorMap.Contains($s)) { $collectorMap[$s].Count } else { 0 }
        $collectorNoun = if ($collectorCount -eq 1) { 'collector' } else { 'collectors' }
        Write-Host "    $([char]0x25B8) $s — $collectorCount $collectorNoun — services: $services" -ForegroundColor DarkGray
    }
    Write-Host ''

    # Graph scopes
    if ($graphScopes -and $graphScopes.Count -gt 0) {
        Write-Host "  Graph scopes ($($graphScopes.Count)):" -ForegroundColor Cyan
        foreach ($scope in ($graphScopes | Sort-Object)) {
            Write-Host "    $scope" -ForegroundColor DarkGray
        }
        Write-Host ''
    }

    # Check counts from progress state
    if ($global:CheckProgressState) {
        $totalChecks = $global:CheckProgressState.Total
        $collectorCounts = $global:CheckProgressState.CollectorCounts
        $labelMap = $global:CheckProgressState.LabelMap
        $checkNoun = if ($totalChecks -eq 1) { 'check' } else { 'checks' }
        Write-Host "  Security checks: $totalChecks $checkNoun queued" -ForegroundColor Cyan
        if ($collectorCounts) {
            # Sort by count descending for quick visual scan
            $sorted = $collectorCounts.GetEnumerator() | Sort-Object -Property Value -Descending
            foreach ($entry in $sorted) {
                $label = if ($labelMap -and $labelMap.ContainsKey($entry.Key)) { $labelMap[$entry.Key] } else { $entry.Key }
                Write-Host "    $([char]0x25B8) $label — $($entry.Value) checks" -ForegroundColor DarkGray
            }
        }
        Write-Host ''
    }

    Write-Host '  No connections made. No data collected.' -ForegroundColor DarkGray
    Write-Host '  Remove -DryRun to run the assessment.' -ForegroundColor DarkGray
    Write-Host ''

    # Clean up the empty output folder created earlier
    if (Test-Path -Path $assessmentFolder) {
        Remove-Item -Path $assessmentFolder -Recurse -Force -ErrorAction SilentlyContinue
    }
    return
}

foreach ($sectionName in $Section) {
    if (-not $collectorMap.Contains($sectionName)) {
        Write-AssessmentLog -Level WARN -Message "Unknown section '$sectionName' — skipping."
        continue
    }

    $collectors = $collectorMap[$sectionName]

    # Skip Purview collectors (and their Security and Compliance connection overhead) when -SkipPurview is set
    if ($SkipPurview) {
        $purviewCollectors = @($collectors | Where-Object { $_.ContainsKey('RequiredServices') -and $_.RequiredServices -contains 'Purview' })
        if ($purviewCollectors.Count -gt 0) {
            $collectors = @($collectors | Where-Object { -not ($_.ContainsKey('RequiredServices') -and $_.RequiredServices -contains 'Purview') })
            foreach ($skipped in $purviewCollectors) {
                Write-AssessmentLog -Level INFO -Message "Skipped: $($skipped.Label) (-SkipPurview)" -Section $sectionName -Collector $skipped.Label
            }
        }
    }

    Show-SectionHeader -Name $sectionName

    # For sections that require Graph, verify the token is still valid before
    # running collectors. Device code tokens expire mid-run for long assessments.
    # Only check if Graph was already connected in a prior section — on the first
    # Graph section the token cannot have expired yet (Connect-RequiredService runs below).
    if (-not $SkipConnection -and $sectionServiceMap[$sectionName] -contains 'Graph' -and $connectedServices.Contains('Graph')) {
        if (-not (Test-GraphTokenValid)) {
            Write-Warning "Graph token is no longer valid before starting $sectionName. Skipping section — re-run with Interactive or Certificate auth."
            foreach ($collector in $collectors) {
                $summaryResults.Add([PSCustomObject]@{
                    Section   = $sectionName
                    Collector = $collector.Label
                    FileName  = "$($collector.Name).csv"
                    Status    = 'Skipped'
                    Items     = 0
                    Duration  = '00:00'
                    Error     = 'Graph token expired'
                })
                Show-CollectorResult -Label $collector.Label -Status 'Skipped' -Items 0 -DurationSeconds 0 -ErrorMessage 'Graph token expired'
                Write-AssessmentLog -Level WARN -Message "Skipped: $($collector.Label) — Graph token expired" -Section $sectionName -Collector $collector.Label
            }
            continue
        }
    }

    # Connect to services: use per-collector RequiredServices if defined,
    # otherwise connect all section-level services up front.
    # If the section is MIXED (some collectors have RequiredServices, others do not),
    # connect section-level services upfront so un-annotated collectors are never
    # dispatched without a connection. Per-collector Connect-RequiredService calls
    # below are idempotent and will no-op if already connected.
    $hasPerCollectorRequirements = ($collectors | Where-Object { $_.ContainsKey('RequiredServices') }).Count -gt 0
    $hasMixedRequirements        = $hasPerCollectorRequirements -and ($collectors | Where-Object { -not $_.ContainsKey('RequiredServices') }).Count -gt 0
    if (-not $SkipConnection -and (-not $hasPerCollectorRequirements -or $hasMixedRequirements)) {
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
        if (Get-Command -Name Update-ProgressStatus -ErrorAction SilentlyContinue) {
            Update-ProgressStatus -Message "Running $($collector.Label)..."
        }

        try {
            if (-not (Test-Path -Path $scriptPath)) {
                throw "Script not found: $scriptPath"
            }

            # Build parameters for the collector
            $collectorParams = @{}
            if ($collector.ContainsKey('Params')) {
                $collectorParams = $collector.Params.Clone()
            }

            # Value Opportunity collectors need project root + assessment folder paths
            if ($collector.ContainsKey('PassProjectContext') -and $collector.PassProjectContext) {
                $collectorParams['ProjectRoot'] = $projectRoot
                $collectorParams['AssessmentFolder'] = $assessmentFolder
            }

            # Special handling for Secure Score (two outputs)
            if ($collector.ContainsKey('HasSecondary') -and $collector.HasSecondary) {
                $secondaryCsvPath = Join-Path -Path $assessmentFolder -ChildPath "$($collector.SecondaryName).csv"
                $collectorParams['ImprovementActionsPath'] = $secondaryCsvPath
            }

            # Child-process collectors (e.g., PowerBI) run in an isolated pwsh
            # process to avoid .NET assembly version conflicts.  The PowerBI module
            # ships Microsoft.Identity.Client 4.64 while Microsoft.Graph loads 4.78;
            # a child process gets its own AppDomain and avoids the clash.
            if ($collector.ContainsKey('IsChildProcess') -and $collector.IsChildProcess) {
                Write-Host "    Connecting to Power BI..." -ForegroundColor Yellow
                Write-Host "    Running in isolated process (assembly compatibility)..." -ForegroundColor Gray
                Write-AssessmentLog -Level INFO -Message "Running $($collector.Label) in child process to avoid MSAL assembly conflict" -Section $sectionName -Collector $collector.Label
                $childCsvPath = $csvPath
                # Build a self-contained script that connects + runs the collector
                $scriptLines = [System.Collections.Generic.List[string]]::new()
                $scriptLines.Add('$ErrorActionPreference = "Stop"')
                # Call Connect-Service.ps1 directly (do NOT dot-source -- it has a
                # Mandatory param block that would prompt for input).
                $scriptLines.Add("`$connectParams = @{ Service = 'PowerBI' }")
                if ($TenantId)              { $scriptLines.Add("`$connectParams['TenantId'] = '$TenantId'") }
                if ($ClientId -and $CertificateThumbprint) {
                    $scriptLines.Add("`$connectParams['ClientId'] = '$ClientId'")
                    $scriptLines.Add("`$connectParams['CertificateThumbprint'] = '$CertificateThumbprint'")
                }
                elseif ($ClientId -and $ClientSecret) {
                    # Convert SecureString to plain text for child process serialization
                    $plainSecret = [System.Net.NetworkCredential]::new('', $ClientSecret).Password
                    $scriptLines.Add("`$connectParams['ClientId'] = '$ClientId'")
                    $scriptLines.Add("`$connectParams['ClientSecret'] = (ConvertTo-SecureString '$plainSecret' -AsPlainText -Force)")
                }
                # On macOS/Linux, interactive browser auth hangs silently for Power BI.
                # Force device code flow unless a service principal is configured.
                if ($UseDeviceCode) {
                    $scriptLines.Add('$connectParams["UseDeviceCode"] = $true')
                }
                elseif (-not $IsWindows -and -not ($ClientId -and ($CertificateThumbprint -or $ClientSecret))) {
                    $scriptLines.Add('$connectParams["UseDeviceCode"] = $true')
                    Write-Host "    Using device code auth (interactive browser not supported on this platform)" -ForegroundColor Yellow
                }
                $scriptLines.Add("try { & '$connectServicePath' @connectParams } catch { Write-Error `$_; exit 1 }")
                $scriptLines.Add("& '$scriptPath' -OutputPath '$childCsvPath'")

                $childScriptFile = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "m365assess_pbi_$([System.IO.Path]::GetRandomFileName()).ps1"
                $childOutputFile = [System.IO.Path]::ChangeExtension($childScriptFile, '.log')
                $childErrFile    = [System.IO.Path]::ChangeExtension($childScriptFile, '.err')
                Set-Content -Path $childScriptFile -Value ($scriptLines -join "`n") -Encoding UTF8
                $childTimeoutSec = if ($UseDeviceCode -or (-not $IsWindows -and -not ($ClientId -and ($CertificateThumbprint -or $ClientSecret)))) { 120 } else { 90 }
                $childNeedsConsole = $UseDeviceCode -or (-not $IsWindows -and -not ($ClientId -and ($CertificateThumbprint -or $ClientSecret)))
                try {
                    if ($childNeedsConsole) {
                        # Device code auth: don't redirect output so the user sees the
                        # login prompt. Use a background job with timeout instead.
                        $childProc = Start-Process -FilePath 'pwsh' -ArgumentList '-NoProfile', '-File', $childScriptFile `
                            -NoNewWindow -PassThru
                    }
                    else {
                        # Service principal / Windows interactive: redirect output for
                        # clean console and capture errors.
                        $childProc = Start-Process -FilePath 'pwsh' -ArgumentList '-NoProfile', '-File', $childScriptFile `
                            -RedirectStandardOutput $childOutputFile -RedirectStandardError $childErrFile `
                            -NoNewWindow -PassThru
                    }

                    $exited = $childProc.WaitForExit($childTimeoutSec * 1000)

                    if (-not $exited) {
                        $childProc.Kill()
                        $childProc.WaitForExit(5000)
                        throw "Child process timed out after ${childTimeoutSec}s — Power BI connection or API is unresponsive. Verify the account has Power BI Service Administrator role. The assessment will continue without Power BI data."
                    }

                    # Read captured output for warnings/errors (only when redirected)
                    if (-not $childNeedsConsole) {
                        $childStderrContent = if (Test-Path $childErrFile) { Get-Content -Path $childErrFile -Raw } else { '' }
                        if ($childStderrContent) {
                            Write-AssessmentLog -Level WARN -Message "Child process stderr: $($childStderrContent.Trim())" -Section $sectionName -Collector $collector.Label
                        }
                    }

                    if ($childProc.ExitCode -ne 0) {
                        $errDetail = if (-not $childNeedsConsole -and (Test-Path $childErrFile)) { (Get-Content -Path $childErrFile -Raw).Trim() } else { "Exit code $($childProc.ExitCode)" }
                        throw "Child process failed: $errDetail"
                    }

                    if (Test-Path -Path $childCsvPath) {
                        $results = @(Import-Csv -Path $childCsvPath)
                        $itemCount = $results.Count
                        $status = 'Complete'
                    }
                    else {
                        throw "Child process completed but CSV output not found at $childCsvPath"
                    }
                }
                finally {
                    Remove-Item -Path $childScriptFile -ErrorAction SilentlyContinue
                    Remove-Item -Path $childOutputFile -ErrorAction SilentlyContinue
                    Remove-Item -Path $childErrFile -ErrorAction SilentlyContinue
                }

                # Skip normal in-process execution
                $collectorDuration = ((Get-Date) - $collectorStart).TotalSeconds
                Show-CollectorResult -Label $collector.Label -Status $status -Items $itemCount -DurationSeconds $collectorDuration -ErrorMessage $errorMessage
                $summaryResults.Add([PSCustomObject]@{
                    Section   = $sectionName
                    Collector = $collector.Label
                    FileName  = "$($collector.Name).csv"
                    Status    = $status
                    Items     = $itemCount
                    Duration  = '{0:mm\:ss}' -f [timespan]::FromSeconds($collectorDuration)
                    Error     = $errorMessage
                })
                Write-AssessmentLog -Level INFO -Message "Completed: $($collector.Label) -- $status, $itemCount items, $([math]::Round($collectorDuration, 1))s" -Section $sectionName -Collector $collector.Label
                continue
            }

            # Capture warnings (3>&1) so they go to log instead of console.
            # Suppress error stream (2>$null) to prevent Graph SDK cmdlets from
            # dumping raw API errors to console; terminating errors still propagate
            # to the catch block below via the exception mechanism.
            $rawOutput = & $scriptPath @collectorParams 3>&1 2>$null
            $capturedWarnings = @($rawOutput | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
            $results = @($rawOutput | Where-Object { $null -ne $_ -and $_ -isnot [System.Management.Automation.WarningRecord] })

            # Log captured warnings; track permission failures as WARNING issues,
            # other technical failures (API errors, null-index) as INFO issues
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
                elseif ($w.Message -match 'Could not check|Could not retrieve|server side error|querying REST|Cannot index') {
                    $issues.Add([PSCustomObject]@{
                        Severity     = 'INFO'
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

    # DNS Authentication: deferred until after all sections complete
    if ($sectionName -eq 'Email') {
        $script:runDnsAuthentication = $true
        # Cache accepted domains and DKIM data for deferred DNS checks (avoids EXO session timeout)
        if (-not $SkipConnection) {
            try {
                $script:cachedAcceptedDomains = @(Get-AcceptedDomain -ErrorAction Stop)
                Write-AssessmentLog -Level INFO -Message "Cached $($script:cachedAcceptedDomains.Count) accepted domain(s) for deferred DNS" -Section 'Email'
            }
            catch {
                Write-AssessmentLog -Level WARN -Message "Could not cache accepted domains: $($_.Exception.Message)" -Section 'Email'
            }
            try {
                $script:cachedDkimConfigs = @(Get-DkimSigningConfig -ErrorAction Stop)
                Write-AssessmentLog -Level INFO -Message "Cached $($script:cachedDkimConfigs.Count) DKIM config(s) for deferred DNS" -Section 'Email'
            }
            catch {
                Write-Verbose "Could not cache DKIM configs: $($_.Exception.Message)"
            }
        }
    }
}


# ------------------------------------------------------------------
# Deferred DNS checks (runs after all sections, uses prefetch cache)
# ------------------------------------------------------------------

# Deferred DNS checks -- extracted to Orchestrator/Invoke-DnsAuthentication.ps1
if ($script:runDnsAuthentication) {
    Invoke-DnsAuthentication -AssessmentFolder $assessmentFolder -ProjectRoot $projectRoot -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector
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
# Baseline: save and/or compare
# ------------------------------------------------------------------
$driftReport         = @()
$driftBaselineLabel  = ''
$driftBaselineTimestamp = ''

if ($SaveBaseline) {
    Write-AssessmentLog -Level INFO -Message "Saving baseline '$SaveBaseline'..."
    $savedBaselineDir = Export-AssessmentBaseline `
        -AssessmentFolder $assessmentFolder `
        -OutputFolder $OutputFolder `
        -Label $SaveBaseline `
        -TenantId $TenantId `
        -Sections @($sections | ForEach-Object { $_ }) `
        -Version $script:AssessmentVersion `
        -RegistryVersion (Get-RegistryVersion -ProjectRoot $projectRoot)
    Write-AssessmentLog -Level INFO -Message "Baseline saved: $savedBaselineDir"
}

if ($CompareBaseline) {
    $safeLabel  = $CompareBaseline -replace '[^\w\-]', '_'
    $safeTenant = $TenantId -replace '[^\w\.\-]', '_'
    $baselineFolder = Join-Path -Path $OutputFolder -ChildPath "Baselines\${safeLabel}_${safeTenant}"
    if (Test-Path -Path $baselineFolder -PathType Container) {
        Write-AssessmentLog -Level INFO -Message "Comparing against baseline '$CompareBaseline'..."
        $driftReport = Compare-AssessmentBaseline `
            -AssessmentFolder $assessmentFolder `
            -BaselineFolder $baselineFolder `
            -RegistryVersion (Get-RegistryVersion -ProjectRoot $projectRoot)
        $driftBaselineLabel = $CompareBaseline
        $metaPath = Join-Path -Path $baselineFolder -ChildPath 'manifest.json'
        if (Test-Path -Path $metaPath) {
            try {
                $meta = Get-Content -Path $metaPath -Raw | ConvertFrom-Json
                $driftBaselineTimestamp = $meta.SavedAt
            }
            catch { Write-Verbose "Drift: could not read baseline manifest: $_" }
        }
        Write-AssessmentLog -Level INFO -Message "Drift analysis: $($driftReport.Count) changes detected vs baseline '$CompareBaseline'"
    }
    else {
        Write-Warning "Baseline '$CompareBaseline' not found at '$baselineFolder'. Skipping drift analysis."
    }
}

# ------------------------------------------------------------------
# AutoBaseline — save dated snapshot and compare to previous auto-*
# ------------------------------------------------------------------
if ($AutoBaseline) {
    $autoLabel   = "auto_$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')"
    $safeTenant  = $TenantId -replace '[^\w\.\-]', '_'
    $sections    = @($Section | ForEach-Object { $_ })
    Export-AssessmentBaseline `
        -AssessmentFolder $assessmentFolder `
        -OutputFolder $OutputFolder `
        -TenantId $TenantId `
        -Label $autoLabel `
        -Sections $sections `
        -Version $script:AssessmentVersion `
        -RegistryVersion (Get-RegistryVersion -ProjectRoot $projectRoot)
    Write-AssessmentLog -Level INFO -Message "AutoBaseline saved: $autoLabel"

    # Compare to most recent previous auto-snapshot for this tenant
    $prevAuto = Get-ChildItem -Path (Join-Path $OutputFolder 'Baselines') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^auto_.*_${safeTenant}$" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 1 -First 1
    if ($prevAuto) {
        Write-AssessmentLog -Level INFO -Message "AutoBaseline: comparing to $($prevAuto.Name)..."
        $driftReport = Compare-AssessmentBaseline `
            -AssessmentFolder $assessmentFolder `
            -BaselineFolder $prevAuto.FullName `
            -RegistryVersion (Get-RegistryVersion -ProjectRoot $projectRoot)
        $driftBaselineLabel = $prevAuto.Name -replace "_${safeTenant}$", ''
        try {
            $meta = Get-Content -Path (Join-Path $prevAuto.FullName 'manifest.json') -Raw | ConvertFrom-Json
            $driftBaselineTimestamp = $meta.SavedAt
        }
        catch { Write-Verbose "AutoBaseline: could not read previous manifest: $_" }
        Write-AssessmentLog -Level INFO -Message "AutoBaseline drift: $($driftReport.Count) changes vs $($prevAuto.Name)"
    }
}

# ------------------------------------------------------------------
# Generate HTML report
# ------------------------------------------------------------------
$reportScriptPath = Join-Path -Path $projectRoot -ChildPath 'Common\Export-AssessmentReport.ps1'
if (Test-Path -Path $reportScriptPath) {
    try {
        # QuickScan: default to compact report unless the user explicitly overrode it
        if ($QuickScan -and -not $PSBoundParameters.ContainsKey('CompactReport')) {
            $CompactReport = $true
        }

        $reportParams = @{
            AssessmentFolder = $assessmentFolder
        }
        if ($script:domainPrefix) { $reportParams['TenantName'] = $script:domainPrefix }
        elseif ($TenantId)        { $reportParams['TenantName'] = $TenantId }
        $reportParams['ReportTheme'] = $ReportTheme
        if ($WhiteLabel)        { $reportParams['WhiteLabel']        = $true }
        if ($CompactReport)     { $reportParams['CompactReport']     = $true }
        if ($OpenReport)        { $reportParams['OpenReport']        = $true }
        if ($QuickScan)         { $reportParams['QuickScan']         = $true }
        if ($driftReport.Count -gt 0 -or $driftBaselineLabel) {
            $reportParams['DriftReport']            = $driftReport
            $reportParams['DriftBaselineLabel']     = $driftBaselineLabel
            $reportParams['DriftBaselineTimestamp'] = $driftBaselineTimestamp
        }

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
# Disconnect services
# ------------------------------------------------------------------
if (-not $SkipConnection) {
    foreach ($svc in @($connectedServices)) {
        try {
            switch ($svc) {
                'Graph' {
                    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
                    Write-AssessmentLog -Level INFO -Message "Disconnected from Microsoft Graph."
                }
                'ExchangeOnline' {
                    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
                    Write-AssessmentLog -Level INFO -Message "Disconnected from Exchange Online."
                }
                'Purview' {
                    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
                    Write-AssessmentLog -Level INFO -Message "Disconnected from Purview."
                }
            }
        }
        catch {
            Write-AssessmentLog -Level WARN -Message "Failed to disconnect $svc`: $($_.Exception.Message)"
        }
    }
}

# ------------------------------------------------------------------
# Console summary
# ------------------------------------------------------------------
Show-AssessmentSummary -SummaryResults @($summaryResults) -Issues @($issues) -Duration $overallDuration -AssessmentFolder $assessmentFolder -SectionCount $Section.Count -Version $script:AssessmentVersion

# Summary is exported to _Assessment-Summary.csv for programmatic access

} # end function Invoke-M365Assessment

# ------------------------------------------------------------------
# Backward-compatible direct invocation: when this script is called
# directly (not dot-sourced from the module .psm1), invoke the
# function so '.\Invoke-M365Assessment.ps1 -Section Tenant ...' works.
# ------------------------------------------------------------------
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-M365Assessment @args
}
