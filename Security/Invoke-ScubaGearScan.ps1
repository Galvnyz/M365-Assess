<#
.SYNOPSIS
    Runs a CISA ScubaGear baseline compliance scan against a Microsoft 365 tenant.
.DESCRIPTION
    Invokes CISA's ScubaGear tool to assess Microsoft 365 tenant configurations
    against the Secure Cloud Business Applications (SCuBA) security baselines.

    Because ScubaGear requires Windows PowerShell 5.1 (incompatible with PS 7),
    this collector shells out to powershell.exe to run the scan. The module and
    its dependencies (OPA, Graph modules, EXO, SharePoint, Teams, etc.) are
    auto-installed via Initialize-SCuBA if not already present.

    The collector parses the ScubaResults CSV into normalised PSCustomObjects and
    optionally preserves the full native ScubaGear output (HTML report, JSON,
    action plan) in a separate folder.
.PARAMETER ProductNames
    One or more M365 product codes to assess. Defaults to all six products.
    Valid values: aad, defender, exo, powerplatform, sharepoint, teams.
.PARAMETER Organization
    Tenant domain (e.g. 'contoso.onmicrosoft.com') used for authentication.
.PARAMETER M365Environment
    Target environment type. Defaults to 'commercial'.
    Valid values: commercial, gcc, gcchigh, dod.
.PARAMETER AppId
    Application (client) ID for certificate-based non-interactive auth.
.PARAMETER CertificateThumbprint
    Certificate thumbprint for certificate-based non-interactive auth.
.PARAMETER OutputPath
    Optional path for the parsed CSV export (standard collector convention).
.PARAMETER ScubaOutputPath
    Folder where native ScubaGear reports (HTML, JSON, action plan) are copied.
    If omitted, native output is written to a temp directory and discarded.
.PARAMETER SkipModuleCheck
    Skips automatic installation and initialisation of ScubaGear and its
    dependencies. Use when the module is already set up.
.EXAMPLE
    PS> .\Security\Invoke-ScubaGearScan.ps1 -Organization 'contoso.onmicrosoft.com'

    Runs a full ScubaGear scan of all six products with interactive auth.
.EXAMPLE
    PS> .\Security\Invoke-ScubaGearScan.ps1 -ProductNames aad,exo -Organization 'contoso.onmicrosoft.com'

    Scans only Entra ID and Exchange Online baselines.
.EXAMPLE
    PS> .\Security\Invoke-ScubaGearScan.ps1 -Organization 'contoso.onmicrosoft.com' -AppId '00000000-...' -CertificateThumbprint 'ABC123'

    Runs a full scan using certificate-based app-only authentication.
.EXAMPLE
    PS> .\Security\Invoke-ScubaGearScan.ps1 -Organization 'contoso.onmicrosoft.com' -M365Environment gcc

    Scans a GCC government tenant.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('aad', 'defender', 'exo', 'powerplatform', 'sharepoint', 'teams')]
    [string[]]$ProductNames = @('aad', 'defender', 'exo', 'powerplatform', 'sharepoint', 'teams'),

    [Parameter()]
    [string]$Organization,

    [Parameter()]
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
    [string]$M365Environment = 'commercial',

    [Parameter()]
    [string]$AppId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [Parameter()]
    [string]$ScubaOutputPath,

    [Parameter()]
    [switch]$SkipModuleCheck
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------
# Internal: invoke a command in Windows PowerShell 5.1
# Defined conditionally so tests can inject a mock before running.
# ------------------------------------------------------------------
if (-not (Get-Command -Name 'Invoke-PS5Command' -CommandType Function -ErrorAction SilentlyContinue)) {
function Invoke-PS5Command {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ScriptContent,

        [Parameter()]
        [string]$Description = 'PS5 command'
    )

    # Verify powershell.exe is available
    $ps5Exe = Get-Command -Name 'powershell.exe' -CommandType Application -ErrorAction SilentlyContinue
    if (-not $ps5Exe) {
        throw "Windows PowerShell 5.1 (powershell.exe) is required for ScubaGear but was not found on this system. " +
              "ScubaGear depends on modules that are incompatible with PowerShell 7. " +
              "Ensure you are running on Windows where powershell.exe is available."
    }

    $tempScript = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "scubagear_$([guid]::NewGuid().ToString('N')).ps1"
    try {
        Set-Content -Path $tempScript -Value $ScriptContent -Encoding UTF8
        # Temporarily allow stderr without throwing so we can capture ALL output
        # and check $LASTEXITCODE ourselves. The caller's $ErrorActionPreference = 'Stop'
        # would otherwise throw a raw RemoteException on the first stderr line,
        # bypassing our formatted error handling below.
        $savedEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempScript 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $savedEAP
        if ($exitCode -ne 0) {
            $errorLines = $output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }
            $errorText = if ($errorLines) { ($errorLines | ForEach-Object { $_.ToString() }) -join "`n" } else { ($output | ForEach-Object { $_.ToString() }) -join "`n" }
            $actionableHint = if ($Description -eq 'module setup') {
                " Try running 'powershell.exe -Command Install-Module ScubaGear -Scope CurrentUser -Force' manually to diagnose."
            }
            elseif ($errorText -match 'unknown escape character|unable to parse input.*yaml') {
                " This is a known ScubaGear/OPA issue where backslash characters in tenant" +
                " data cause YAML parsing failures. Try updating ScubaGear to the latest" +
                " version: powershell.exe -Command 'Update-Module ScubaGear -Force'." +
                " If the issue persists, report it at https://github.com/cisagov/ScubaGear/issues"
            }
            elseif ($errorText -match 'Invalid JSON primitive') {
                " ScubaGear report generation failed, likely due to upstream OPA evaluation" +
                " errors. Check for a newer ScubaGear version or run with fewer ProductNames" +
                " to isolate the failing baseline."
            }
            else { '' }
            throw "PS5 $Description failed (exit code $exitCode): $errorText$actionableHint"
        }
        return $output
    }
    finally {
        if ($savedEAP) { $ErrorActionPreference = $savedEAP }
        if (Test-Path -Path $tempScript) {
            Remove-Item -Path $tempScript -Force -ErrorAction SilentlyContinue
        }
    }
}
} # end conditional Invoke-PS5Command definition

# ------------------------------------------------------------------
# Step 1: Ensure ScubaGear module and dependencies are available
# ------------------------------------------------------------------
if (-not $SkipModuleCheck) {
    Write-Host '  Checking ScubaGear module in Windows PowerShell 5.1...' -ForegroundColor Gray

    $checkScript = @'
$mod = Get-Module -Name ScubaGear -ListAvailable | Select-Object -First 1
if (-not $mod) {
    Write-Host 'ScubaGear not found. Installing from PSGallery...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -ErrorAction SilentlyContinue | Out-Null
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
    Install-Module -Name ScubaGear -Scope CurrentUser -Force -AllowClobber
    $mod = Get-Module -Name ScubaGear -ListAvailable | Select-Object -First 1
    if (-not $mod) {
        Write-Error 'ScubaGear module installation failed.'
        exit 1
    }
    Write-Host "ScubaGear $($mod.Version) installed."
}
else {
    Write-Host "ScubaGear $($mod.Version) already installed."
}

Write-Host 'Initialising ScubaGear dependencies (OPA, required modules)...'
Import-Module ScubaGear -ErrorAction Stop
Initialize-SCuBA -ErrorAction Stop
Write-Host 'ScubaGear dependencies ready.'
exit 0
'@

    $null = Invoke-PS5Command -ScriptContent $checkScript -Description 'module setup'
    Write-Host '  ScubaGear module and dependencies verified.' -ForegroundColor Green
}

# ------------------------------------------------------------------
# Step 2: Build the Invoke-SCuBA invocation script
# ------------------------------------------------------------------
$scubaOutFolder = if ($ScubaOutputPath) {
    $ScubaOutputPath
}
else {
    Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "scubagear_out_$([guid]::NewGuid().ToString('N'))"
}

$productList = "'" + ($ProductNames -join "','") + "'"

$scubaScript = @"
`$ErrorActionPreference = 'Stop'

# Clear any cached Graph connections AND MSAL token cache from PS5 to prevent
# ScubaGear from reusing stale tokens that may belong to a different tenant.
if (Get-Module Microsoft.Graph.Authentication -ListAvailable -ErrorAction SilentlyContinue) {
    try {
        Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
        Disconnect-MgGraph -ErrorAction SilentlyContinue 2>`$null
    } catch { }
}
# Clear on-disk MSAL token cache — Disconnect-MgGraph alone does not remove
# persisted tokens, and MSAL silently reuses them for the previously-used tenant.
`$graphCachePath = Join-Path `$env:USERPROFILE '.graph'
if (Test-Path `$graphCachePath) {
    Remove-Item `$graphCachePath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  Cleared cached Graph tokens to ensure correct tenant auth.' -ForegroundColor Gray
}
# Also clear cached EXO sessions
try { Disconnect-ExchangeOnline -Confirm:`$false -ErrorAction SilentlyContinue 2>`$null } catch { }

Import-Module ScubaGear -ErrorAction Stop

`$params = @{
    ProductNames = @($productList)
    OutPath      = '$($scubaOutFolder -replace "'", "''")'
    Quiet        = `$true
}
"@

if ($Organization) {
    $scubaScript += "`n`$params['Organization'] = '$($Organization -replace "'", "''")'"
}

if ($M365Environment -ne 'commercial') {
    $scubaScript += "`n`$params['M365Environment'] = '$M365Environment'"
}

if ($AppId -and $CertificateThumbprint) {
    $scubaScript += @"

`$params['AppID'] = '$($AppId -replace "'", "''")'
`$params['CertificateThumbprint'] = '$($CertificateThumbprint -replace "'", "''")'
`$params['LogIn'] = `$false
"@
}

$scubaScript += @"

try {
    Invoke-SCuBA @params
    exit 0
}
catch {
    Write-Error `$_.Exception.Message
    exit 1
}
"@

# ------------------------------------------------------------------
# Step 3: Execute ScubaGear in PS5
# ------------------------------------------------------------------
Write-Host '  Running CISA ScubaGear scan (this may take several minutes)...' -ForegroundColor Yellow
$null = Invoke-PS5Command -ScriptContent $scubaScript -Description 'ScubaGear scan'
Write-Host '  ScubaGear scan complete.' -ForegroundColor Green

# ------------------------------------------------------------------
# Step 4: Locate and parse results
# ------------------------------------------------------------------
$resultFolders = Get-ChildItem -Path $scubaOutFolder -Directory -Filter 'M365BaselineConformance*' -ErrorAction SilentlyContinue |
    Sort-Object -Property LastWriteTime -Descending

if (-not $resultFolders -or $resultFolders.Count -eq 0) {
    throw "ScubaGear output folder not found under '$scubaOutFolder'. The scan may have failed silently."
}

$latestFolder = $resultFolders[0].FullName

$csvFiles = Get-ChildItem -Path $latestFolder -Filter 'ScubaResults*.csv' -ErrorAction SilentlyContinue
if (-not $csvFiles -or $csvFiles.Count -eq 0) {
    throw "ScubaResults CSV not found in '$latestFolder'. The scan may have completed with errors."
}

$scubaCsv = Import-Csv -Path $csvFiles[0].FullName -ErrorAction Stop

$report = foreach ($row in $scubaCsv) {
    $properties = @{}
    foreach ($prop in $row.PSObject.Properties) {
        $properties[$prop.Name] = $prop.Value
    }
    [PSCustomObject]$properties
}
$report = @($report)

Write-Host "  Parsed $($report.Count) ScubaGear control results." -ForegroundColor Gray

# ------------------------------------------------------------------
# Step 5: Preserve native output if ScubaOutputPath was specified
# ------------------------------------------------------------------
if ($ScubaOutputPath -and $ScubaOutputPath -ne $scubaOutFolder) {
    if (-not (Test-Path -Path $ScubaOutputPath)) {
        $null = New-Item -Path $ScubaOutputPath -ItemType Directory -Force
    }
    Copy-Item -Path $latestFolder -Destination $ScubaOutputPath -Recurse -Force
    Write-Host "  Native ScubaGear reports copied to $ScubaOutputPath" -ForegroundColor Gray
}

# ------------------------------------------------------------------
# Step 6: Export or return
# ------------------------------------------------------------------
if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($report.Count) ScubaGear results to $OutputPath"
}
else {
    Write-Output $report
}

# ------------------------------------------------------------------
# Cleanup temp output folder (only if we created it)
# ------------------------------------------------------------------
if (-not $ScubaOutputPath -or $ScubaOutputPath -ne $scubaOutFolder) {
    if (Test-Path -Path $scubaOutFolder) {
        Remove-Item -Path $scubaOutFolder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
