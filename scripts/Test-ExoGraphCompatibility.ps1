<#
.SYNOPSIS
    Probes an exact EXO/Graph combination in a fresh PowerShell process.
.DESCRIPTION
    Run once per import order with pwsh -NoProfile -File. By default only imports
    modules; -Live also authenticates and runs read-only probes using the project's
    connectors. Import success alone does not establish authentication compatibility.
    Does not install modules or change the assessment's supported-version ceiling.
.PARAMETER ExoVersion
    Exact installed ExchangeOnlineManagement version to test.
.PARAMETER GraphVersion
    Exact installed Microsoft.Graph.Authentication version to test.
.PARAMETER Order
    Import and connection order to exercise.
.PARAMETER ModulePath
    Optional isolated module directory, prepended to PSModulePath.
.PARAMETER Live
    Authenticate and run Graph, Exchange and Purview read-only probes.
.PARAMETER TenantId
    Test tenant. For EXO-first certificate tests supply its initial onmicrosoft domain.
.PARAMETER ClientId
    Existing application ID for certificate authentication. Omit for interactive auth.
.PARAMETER CertificateThumbprint
    Existing Windows certificate-store thumbprint. Never exported in the result.
.PARAMETER M365Environment
    Cloud environment used by the project connector.
.PARAMETER OutputPath
    Optional JSON result path. Results omit tenant identity and raw error messages.
.PARAMETER DirectSdk
    Test documented SDK parameters independently of the project connector (commercial cloud).
.PARAMETER DisableWAM
    Opt into the EXO/Purview broker workaround in DirectSdk mode.
.PARAMETER UserPrincipalName
    Interactive EXO/Purview account in DirectSdk mode. Defaults to the connected Graph account.
.EXAMPLE
    pwsh -NoProfile -File ./scripts/Test-ExoGraphCompatibility.ps1 -ExoVersion 3.10.1 -GraphVersion 2.40.0 -Order GraphFirst -ModulePath ./Modules
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][version]$ExoVersion,
    [Parameter(Mandatory)][version]$GraphVersion,
    [ValidateSet('GraphFirst', 'ExoFirst')][string]$Order = 'GraphFirst',
    [string]$ModulePath,
    [switch]$Live,
    [string]$TenantId,
    [string]$ClientId,
    [string]$CertificateThumbprint,
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')][string]$M365Environment = 'commercial',
    [string]$OutputPath,
    [switch]$DirectSdk,
    [switch]$DisableWAM,
    [string]$UserPrincipalName
)

$ErrorActionPreference = 'Stop'
if (($DisableWAM -or $UserPrincipalName) -and -not $DirectSdk) { throw 'DisableWAM and UserPrincipalName require -DirectSdk.' }
if ($DirectSdk -and $M365Environment -ne 'commercial') { throw 'DirectSdk currently probes commercial cloud only.' }
if ((Get-Module -Name ExchangeOnlineManagement, Microsoft.Graph.Authentication) -or
    @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object {
        $_.GetName().Name -like 'Microsoft.Identity.Client*'
    }).Count -gt 0) {
    throw 'Use a fresh pwsh -NoProfile process for each compatibility probe.'
}
if ($Live -and -not $TenantId) { throw '-Live requires -TenantId.' }
if ([bool]$ClientId -ne [bool]$CertificateThumbprint) {
    throw 'Supply both ClientId and CertificateThumbprint, or neither for interactive authentication.'
}
if ($ModulePath) {
    $env:PSModulePath = (Resolve-Path -LiteralPath $ModulePath).Path + [IO.Path]::PathSeparator + $env:PSModulePath
}
$common = Join-Path -Path $PSScriptRoot -ChildPath '../src/M365-Assess/Common'
. (Join-Path -Path $common -ChildPath 'Invoke-SafeGraphRequest.ps1')
. (Join-Path -Path $common -ChildPath 'Get-ExoAuditConfig.ps1')
$steps = [System.Collections.Generic.List[object]]::new()
$stage = 'Initialize'
$passed = $false
$failure = $null
$services = if ($Order -eq 'GraphFirst') { @('Graph', 'ExchangeOnline') } else { @('ExchangeOnline', 'Graph') }
$connection = @{ TenantId = $TenantId; M365Environment = $M365Environment; Scopes = @('Organization.Read.All'); ErrorAction = 'Stop' }
if ($ClientId) {
    $connection.ClientId = $ClientId
    $connection.CertificateThumbprint = $CertificateThumbprint
}
function Connect-ProbeService {
    param([string]$Service)
    if (-not $DirectSdk) {
        & (Join-Path -Path $common -ChildPath 'Connect-Service.ps1') -Service $Service @connection | Out-Null
        return
    }
    $parameters = @{ ErrorAction = 'Stop' }
    if ($Service -eq 'Graph') {
        $parameters.TenantId = $TenantId
        $parameters.ContextScope = 'Process'
        $parameters.NoWelcome = $true
        if ($ClientId) {
            $parameters.ClientId = $ClientId
            $parameters.CertificateThumbprint = $CertificateThumbprint
        } else { $parameters.Scopes = @('Organization.Read.All') }
        Connect-MgGraph @parameters | Out-Null
        return
    }
    $parameters.ShowBanner = $false
    if ($ClientId) {
        # Organization belongs to certificate authentication, not interactive sign-in.
        $organization = $TenantId
        if ($organization -notmatch '\.onmicrosoft\.[a-z]+$') {
            $organization = (Invoke-MgGraphRequest -Method GET -Uri '/v1.0/organization?$select=verifiedDomains').value.verifiedDomains |
                Where-Object isInitial | Select-Object -First 1 -ExpandProperty name
        }
        if (-not $organization) { throw 'Certificate tests require the initial tenant domain or a connected Graph session.' }
        $parameters.Organization = $organization
        $parameters.AppId = $ClientId
        $parameters.CertificateThumbprint = $CertificateThumbprint
    } else {
        $account = $UserPrincipalName
        if (-not $account -and (Get-Command Get-MgContext -ErrorAction SilentlyContinue)) { $account = (Get-MgContext).Account }
        if ($account) { $parameters.UserPrincipalName = $account }
    }
    if ($DisableWAM) { $parameters.DisableWAM = $true }
    if ($Service -eq 'ExchangeOnline') { Connect-ExchangeOnline @parameters }
    else { Connect-IPPSSession @parameters }
}
try {
    foreach ($service in $services) {
        $stage = "Import:$service"
        $module = if ($service -eq 'Graph') { 'Microsoft.Graph.Authentication' } else { 'ExchangeOnlineManagement' }
        $version = if ($service -eq 'Graph') { $GraphVersion } else { $ExoVersion }
        Import-Module -Name $module -RequiredVersion $version -ErrorAction Stop
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
        if ($Live) {
            $stage = "Connect:$service"
            Connect-ProbeService -Service $service
            $steps.Add([ordered]@{ stage = $stage; passed = $true })
        }
    }
    if ($Live) {
        $stage = 'Graph:organization'
        $organizations = @( (Invoke-SafeGraphRequest -Uri '/v1.0/organization?$select=id' -ExpectCollection).value )
        if ($organizations.Count -ne 1) { throw 'Expected exactly one organization.' }
        $tenantGuid = $organizations[0].id
        $steps.Add([ordered]@{ stage = $stage; passed = $true; count = $organizations.Count })
        $stage = 'Exchange:audit'
        $null = Get-ExoAuditConfig -ExpectedTenantId $tenantGuid
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
        $stage = 'Connect:Purview'
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction Stop | Out-Null
        Connect-ProbeService -Service Purview
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
        $stage = 'Purview:DLP'
        $policies = @(Get-DlpCompliancePolicy -ErrorAction Stop)
        $steps.Add([ordered]@{ stage = $stage; passed = $true; count = $policies.Count })
        $stage = 'Graph:afterPurview'
        $null = Invoke-SafeGraphRequest -Uri '/v1.0/organization?$select=id' -ExpectCollection
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
        # Purview can replace overlapping EXO commands. The assessment captures
        # audit evidence before that switch; explicitly reconnect to test reuse.
        $stage = 'Reconnect:ExchangeOnline'
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction Stop | Out-Null
        Connect-ProbeService -Service ExchangeOnline
        $null = Get-ExoAuditConfig -ExpectedTenantId $tenantGuid
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
        $stage = 'Reconnect:Graph'
        Disconnect-MgGraph -ErrorAction Stop | Out-Null
        Connect-ProbeService -Service Graph
        $null = Invoke-SafeGraphRequest -Uri '/v1.0/organization?$select=id' -ExpectCollection
        $steps.Add([ordered]@{ stage = $stage; passed = $true })
    }
    $passed = $true
} catch {
    # Raw service errors can contain tenant/account identifiers. Keep local
    # machine-readable results safe to summarize without copying those strings.
    $failure = [ordered]@{ stage = $stage; exceptionType = $_.Exception.GetType().FullName }
    $message = $_.Exception.Message
    $failure['assemblyFailure'] = [bool]($message -match 'Could not load type|Could not load file or assembly|Method not found|does not have an implementation')
    if ($message -match "Could not load type '[^']+' from assembly '[^']+'") {
        $failure['assemblyDiagnostic'] = $Matches[0]
    } elseif ($message -match "(?:Method|Type) '[^']+'[^\r\n]{0,500}does not have an implementation") {
        $failure['assemblyDiagnostic'] = $Matches[0]
    }
    $steps.Add([ordered]@{ stage = $stage; passed = $false })
    Write-Warning "Compatibility probe failed at $stage ($($_.Exception.GetType().Name))."
} finally {
    if ($Live) {
        if (Get-Command -Name Disconnect-ExchangeOnline -ErrorAction SilentlyContinue) {
            try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction Stop | Out-Null }
            catch { Write-Warning 'EXO cleanup failed; this isolated test process should now exit.' }
        }
        if (Get-Command -Name Disconnect-MgGraph -ErrorAction SilentlyContinue) {
            try { Disconnect-MgGraph -ErrorAction Stop | Out-Null }
            catch { Write-Warning 'Graph cleanup failed; this isolated test process should now exit.' }
        }
    }
}
$result = [ordered]@{
    timestamp = [datetime]::UtcNow.ToString('o')
    powershell = $PSVersionTable.PSVersion.ToString()
    os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    exoVersion = $ExoVersion.ToString()
    graphVersion = $GraphVersion.ToString()
    order = $Order
    mode = if ($Live) { if ($ClientId) { 'Certificate' } else { 'Interactive' } } else { 'ImportOnly' }
    environment = $M365Environment
    connector = if ($DirectSdk) { 'DirectSdk' } else { 'Project' }
    disableWAM = [bool]$DisableWAM
    passed = $passed
    steps = @($steps.ToArray())
    failure = $failure
    identityAssemblies = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object {
        $_.GetName().Name -like 'Microsoft.Identity.Client*'
    } | ForEach-Object { $_.GetName().FullName })
}
$json = $result | ConvertTo-Json -Depth 8
if ($OutputPath) { Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8 }
$json
if (-not $passed) { exit 1 }
