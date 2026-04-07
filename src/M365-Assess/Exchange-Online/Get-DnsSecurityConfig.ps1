<#
.SYNOPSIS
    Evaluates DNS authentication records (SPF, DKIM, DMARC) against CIS requirements.
.DESCRIPTION
    Checks all authoritative accepted domains for proper SPF, DKIM, and DMARC
    configuration. Produces pass/fail verdicts via Add-Setting for each protocol.

    Requires an active Exchange Online connection for Get-AcceptedDomain and
    Get-DkimSigningConfig cmdlets, unless pre-cached data is provided via parameters.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.PARAMETER AcceptedDomains
    Pre-cached accepted domain objects from the orchestrator. When provided,
    skips the Get-AcceptedDomain call (avoids EXO session timeout issues).
.PARAMETER DkimConfigs
    Pre-cached DKIM signing configuration objects from the orchestrator. When provided,
    skips the Get-DkimSigningConfig call (EXO may be disconnected during deferred DNS checks).
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Exchange-Online\Get-DnsSecurityConfig.ps1

    Displays DNS security evaluation results.
.EXAMPLE
    PS> .\Exchange-Online\Get-DnsSecurityConfig.ps1 -OutputPath '.\dns-security-config.csv'

    Exports the DNS evaluation to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [Parameter()]
    [object[]]$AcceptedDomains,

    [Parameter()]
    [object[]]$DkimConfigs
)

# Stop on errors: API failures should halt this collector rather than produce partial results.
$ErrorActionPreference = 'Stop'

# Load cross-platform DNS resolver (Resolve-DnsName on Windows, dig on macOS/Linux)
$dnsHelperPath = Join-Path -Path $PSScriptRoot -ChildPath '..\Common\Resolve-DnsRecord.ps1'
if (Test-Path -Path $dnsHelperPath) { . $dnsHelperPath }

# Load shared security-config helpers
$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = ''
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# Fetch authoritative domains
# ------------------------------------------------------------------
$authDomains = @()
if ($AcceptedDomains -and $AcceptedDomains.Count -gt 0) {
    # Use pre-cached domains passed by the orchestrator
    Write-Verbose "Using $($AcceptedDomains.Count) pre-cached accepted domain(s)"
    $authDomains = @($AcceptedDomains | Where-Object {
        $_.DomainType -eq 'Authoritative' -and $_.DomainName -notlike '*.onmicrosoft.com'
    })
}
else {
    try {
        Write-Verbose "Fetching accepted domains..."
        $allDomains = Get-AcceptedDomain -ErrorAction Stop
        $authDomains = @($allDomains | Where-Object {
            $_.DomainType -eq 'Authoritative' -and $_.DomainName -notlike '*.onmicrosoft.com'
        })
    }
    catch {
        Write-Warning "Could not retrieve accepted domains: $_"
    }
}
if ($authDomains.Count -gt 0) {
    Write-Verbose "Found $($authDomains.Count) authoritative domain(s)"
}

if ($authDomains.Count -eq 0) {
    $settingParams = @{
        Category         = 'DNS Authentication'
        Setting          = 'SPF Records'
        CurrentValue     = 'No authoritative domains found'
        RecommendedValue = 'SPF for all domains'
        Status           = 'Review'
        CheckId          = 'DNS-SPF-001'
        Remediation      = 'Connect to Exchange Online and verify accepted domains.'
    }
    Add-Setting @settingParams
    $settingParams = @{
        Category         = 'DNS Authentication'
        Setting          = 'DKIM Signing'
        CurrentValue     = 'No authoritative domains found'
        RecommendedValue = 'DKIM for all domains'
        Status           = 'Review'
        CheckId          = 'DNS-DKIM-001'
        Remediation      = 'Connect to Exchange Online and verify accepted domains.'
    }
    Add-Setting @settingParams
    $settingParams = @{
        Category         = 'DNS Authentication'
        Setting          = 'DMARC Records'
        CurrentValue     = 'No authoritative domains found'
        RecommendedValue = 'DMARC for all domains'
        Status           = 'Review'
        CheckId          = 'DNS-DMARC-001'
        Remediation      = 'Connect to Exchange Online and verify accepted domains.'
    }
    Add-Setting @settingParams
}
else {
    # DNS checks use Continue to prevent non-terminating errors (e.g., from
    # Resolve-DnsName SOA fallback records) from escalating under the script-level Stop.
    $ErrorActionPreference = 'Continue'

    # ------------------------------------------------------------------
    # 1. SPF Records (CIS 2.1.8)
    # ------------------------------------------------------------------
    try {
        Write-Verbose "Checking SPF records..."
        $spfMissing = @()
        $spfPresent = @()
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            $txtRecords = @(Resolve-DnsRecord -Name $domainName -Type TXT -ErrorAction SilentlyContinue)
            $spfRecord = $txtRecords | Where-Object { $_.Strings -and $_.Strings -match '^v=spf1' }
            if ($spfRecord) { $spfPresent += $domainName }
            else { $spfMissing += $domainName }
        }

        if ($spfMissing.Count -eq 0) {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'SPF Records'
                CurrentValue     = "$($spfPresent.Count)/$($authDomains.Count) domains have SPF"
                RecommendedValue = 'SPF for all domains'
                Status           = 'Pass'
                CheckId          = 'DNS-SPF-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'SPF Records'
                CurrentValue     = "$($spfPresent.Count)/$($authDomains.Count) domains -- missing: $($spfMissing -join ', ')"
                RecommendedValue = 'SPF for all domains'
                Status           = 'Fail'
                CheckId          = 'DNS-SPF-001'
                Remediation      = "Add SPF TXT records for: $($spfMissing -join ', '). Example: v=spf1 include:spf.protection.outlook.com -all"
            }
            Add-Setting @settingParams
        }
    }
    catch {
        Write-Warning "Could not check SPF records: $_"
    }

    # ------------------------------------------------------------------
    # 2. DKIM Signing (CIS 2.1.9)
    # ------------------------------------------------------------------
    try {
        Write-Verbose "Checking DKIM configuration..."
        # Use pre-cached DKIM data when available (orchestrator caches before EXO disconnect).
        # Fall back to direct cmdlet call with try/catch for standalone execution.
        if (-not $DkimConfigs) {
            $DkimConfigs = @(Get-DkimSigningConfig -ErrorAction Stop)
        }
        $dkimMissing = @()
        $dkimEnabled = @()
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            $config = $DkimConfigs | Where-Object { $_.Domain -eq $domainName }
            if ($config -and $config.Enabled) { $dkimEnabled += $domainName }
            else { $dkimMissing += $domainName }
        }

        if ($dkimMissing.Count -eq 0) {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DKIM Signing'
                CurrentValue     = "$($dkimEnabled.Count)/$($authDomains.Count) domains have DKIM enabled"
                RecommendedValue = 'DKIM for all domains'
                Status           = 'Pass'
                CheckId          = 'DNS-DKIM-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DKIM Signing'
                CurrentValue     = "$($dkimEnabled.Count)/$($authDomains.Count) domains -- missing: $($dkimMissing -join ', ')$dkimOnMsftNote"
                RecommendedValue = 'DKIM for all domains'
                Status           = 'Fail'
                CheckId          = 'DNS-DKIM-001'
                Remediation      = "Enable DKIM for: $($dkimMissing -join ', '). Run: New-DkimSigningConfig -DomainName <domain> -Enabled `$true. Microsoft 365 Defender > Email & collaboration > Policies > DKIM."
            }
            Add-Setting @settingParams
        }
    }
    catch [System.Management.Automation.CommandNotFoundException] {
        $settingParams = @{
            Category         = 'DNS Authentication'
            Setting          = 'DKIM Signing'
            CurrentValue     = 'Get-DkimSigningConfig cmdlet not available'
            RecommendedValue = 'DKIM for all domains'
            Status           = 'Review'
            CheckId          = 'DNS-DKIM-001'
            Remediation      = 'Connect to Exchange Online PowerShell to check DKIM configuration.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check DKIM configuration: $_"
    }

    # ------------------------------------------------------------------
    # 3. DMARC Records (CIS 2.1.10)
    # ------------------------------------------------------------------
    try {
        Write-Verbose "Checking DMARC records..."
        $dmarcMissing = @()
        $dmarcWeak = @()
        $dmarcStrong = @()
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            $dmarcRecords = @(Resolve-DnsRecord -Name "_dmarc.$domainName" -Type TXT -ErrorAction SilentlyContinue)
            $dmarcRecord = $dmarcRecords | Where-Object { $_.Strings -and $_.Strings -match '^v=DMARC1' }
            if (-not $dmarcRecord) {
                $dmarcMissing += $domainName
            }
            else {
                $policy = ($dmarcRecord.Strings | Select-Object -First 1)
                if ($policy -match 'p=(quarantine|reject)') { $dmarcStrong += $domainName }
                else { $dmarcWeak += $domainName }
            }
        }

        $totalGood = $dmarcStrong.Count
        $totalDomains = $authDomains.Count
        if ($dmarcMissing.Count -eq 0 -and $dmarcWeak.Count -eq 0) {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DMARC Records'
                CurrentValue     = "$totalGood/$totalDomains domains have enforcing DMARC"
                RecommendedValue = 'DMARC p=quarantine or p=reject for all'
                Status           = 'Pass'
                CheckId          = 'DNS-DMARC-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $issues = @()
            if ($dmarcMissing.Count -gt 0) { $issues += "missing: $($dmarcMissing -join ', ')" }
            if ($dmarcWeak.Count -gt 0) { $issues += "p=none: $($dmarcWeak -join ', ')" }
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DMARC Records'
                CurrentValue     = "$totalGood/$totalDomains enforcing -- $($issues -join '; ')"
                RecommendedValue = 'DMARC p=quarantine or p=reject for all'
                Status           = 'Fail'
                CheckId          = 'DNS-DMARC-001'
                Remediation      = "Add/update DMARC for: $($issues -join '; '). Example: v=DMARC1; p=reject; rua=mailto:dmarc@yourdomain.com"
            }
            Add-Setting @settingParams
        }
    }
    catch {
        Write-Warning "Could not check DMARC records: $_"
    }

    $ErrorActionPreference = 'Stop'
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'DNS Authentication'
