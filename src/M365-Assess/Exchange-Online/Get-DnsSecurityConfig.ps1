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

    # ---- Tracking collections used across all DNS checks -------------------------
    # Domains whose zones return SERVFAIL: skipped in all checks, DNS-ZONE-001 emitted.
    $servfailDomains = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    # Domains with null/defensive SPF (v=spf1 -all): excluded from DKIM evaluation.
    $spfNullDomains = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    # Domains with RFC 7505 null MX (0 .): treated as Pass in MX check.
    $nullMxDomains = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    # Domains with enforcing DMARC (p=reject or p=quarantine): used for lockdown detection.
    $dmarcEnforcingDomains = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    # -- SERVFAIL pre-pass: probe each zone before evaluating records ---------------
    # Guarded by Get-Command so test environments that mock Get-Command to return $null
    # for unknown names automatically skip this block without any test changes.
    if (Get-Command -Name Test-DnsZoneAvailable -ErrorAction SilentlyContinue) {
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            if (-not (Test-DnsZoneAvailable -Name $domainName)) {
                $null = $servfailDomains.Add($domainName)
                Write-Verbose "DNS SERVFAIL detected for zone: $domainName"
            }
        }
    }
    if ($servfailDomains.Count -gt 0) {
        $settingParams = @{
            Category         = 'DNS Authentication'
            Setting          = 'DNS Zone Health'
            CurrentValue     = "SERVFAIL: $($servfailDomains -join ', ')"
            RecommendedValue = 'All accepted domain zones must respond to DNS queries'
            Status           = 'Fail'
            CheckId          = 'DNS-ZONE-001'
            Remediation      = "Investigate DNS zone failures for: $($servfailDomains -join ', '). Contact your DNS provider -- the authoritative nameservers are not responding. SPF, DKIM, DMARC, and MX checks for these domains are suppressed to avoid false positives."
        }
        Add-Setting @settingParams
    }

    # ------------------------------------------------------------------
    # 1. SPF Records (CIS 2.1.8)
    # ------------------------------------------------------------------
    try {
        Write-Verbose "Checking SPF records..."
        $spfMissing = @()
        $spfPresent = @()
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            if ($servfailDomains.Contains($domainName)) { continue }
            $txtRecords = @(Resolve-DnsRecord -Name $domainName -Type TXT -ErrorAction SilentlyContinue)
            $spfRecord = $txtRecords | Where-Object { $_.Strings -and $_.Strings -match '^v=spf1' }
            if ($spfRecord) {
                $spfPresent += $domainName
                # Detect null/defensive SPF (v=spf1 -all with no mechanisms): domain is a
                # non-sending domain and should be excluded from the DKIM check.
                $spfFull = ($spfRecord.Strings -join '')
                if ($spfFull -match '^v=spf1\s+-all\s*$') {
                    $null = $spfNullDomains.Add($domainName)
                }
            }
            else { $spfMissing += $domainName }
        }

        $spfTotal = $spfPresent.Count + $spfMissing.Count
        if ($spfMissing.Count -eq 0) {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'SPF Records'
                CurrentValue     = "$($spfPresent.Count)/$spfTotal domains have SPF"
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
                CurrentValue     = "$($spfPresent.Count)/$spfTotal domains -- missing: $($spfMissing -join ', ')"
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
            if ($servfailDomains.Contains($domainName)) { continue }
            # Non-sending domains (v=spf1 -all) do not send email: DKIM is not applicable.
            if ($spfNullDomains.Contains($domainName)) { continue }
            $config = $DkimConfigs | Where-Object { $_.Domain -eq $domainName }
            if ($config -and $config.Enabled) { $dkimEnabled += $domainName }
            else { $dkimMissing += $domainName }
        }

        $dkimTotal = $dkimEnabled.Count + $dkimMissing.Count
        if ($dkimMissing.Count -eq 0) {
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DKIM Signing'
                CurrentValue     = "$($dkimEnabled.Count)/$dkimTotal domains have DKIM enabled"
                RecommendedValue = 'DKIM for all sending domains'
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
                CurrentValue     = "$($dkimEnabled.Count)/$dkimTotal domains -- missing: $($dkimMissing -join ', ')"
                RecommendedValue = 'DKIM for all sending domains'
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
            RecommendedValue = 'DKIM for all sending domains'
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
        $dmarcMissing    = @()
        $dmarcNone       = @()   # p=none — monitoring only, no enforcement
        $dmarcQuarantine = @()   # p=quarantine — staged rollout in progress
        $dmarcReject     = @()   # p=reject — fully enforced
        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            if ($servfailDomains.Contains($domainName)) { continue }
            $dmarcRecords = @(Resolve-DnsRecord -Name "_dmarc.$domainName" -Type TXT -ErrorAction SilentlyContinue)
            $dmarcRecord = $dmarcRecords | Where-Object { $_.Strings -and $_.Strings -match '^v=DMARC1' }
            if (-not $dmarcRecord) {
                $dmarcMissing += $domainName
            }
            else {
                $policy = ($dmarcRecord.Strings | Select-Object -First 1)
                if ($policy -match 'p=reject') {
                    $dmarcReject += $domainName
                    $null = $dmarcEnforcingDomains.Add($domainName)
                }
                elseif ($policy -match 'p=quarantine') {
                    $dmarcQuarantine += $domainName
                    $null = $dmarcEnforcingDomains.Add($domainName)
                }
                else {
                    $dmarcNone += $domainName
                }
            }
        }

        $totalDomains = $dmarcReject.Count + $dmarcQuarantine.Count + $dmarcNone.Count + $dmarcMissing.Count
        if ($dmarcMissing.Count -eq 0 -and $dmarcNone.Count -eq 0 -and $dmarcQuarantine.Count -eq 0) {
            # All domains at p=reject
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DMARC Records'
                CurrentValue     = "$($dmarcReject.Count)/$totalDomains domains at p=reject"
                RecommendedValue = 'DMARC p=reject for all domains'
                Status           = 'Pass'
                CheckId          = 'DNS-DMARC-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        elseif ($dmarcMissing.Count -eq 0 -and $dmarcNone.Count -eq 0) {
            # All domains at quarantine or reject — staged rollout in progress
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DMARC Records'
                CurrentValue     = "$($dmarcReject.Count)/$totalDomains at p=reject; $($dmarcQuarantine.Count) at p=quarantine (staged): $($dmarcQuarantine -join ', ')"
                RecommendedValue = 'DMARC p=reject for all domains'
                Status           = 'Warning'
                CheckId          = 'DNS-DMARC-001'
                Remediation      = "Advance p=quarantine domains to p=reject once DMARC reports confirm no legitimate mail is failing: $($dmarcQuarantine -join ', ')"
            }
            Add-Setting @settingParams
        }
        else {
            $issues = @()
            if ($dmarcMissing.Count -gt 0) { $issues += "missing: $($dmarcMissing -join ', ')" }
            if ($dmarcNone.Count -gt 0) { $issues += "p=none: $($dmarcNone -join ', ')" }
            if ($dmarcQuarantine.Count -gt 0) { $issues += "p=quarantine (staged): $($dmarcQuarantine -join ', ')" }
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'DMARC Records'
                CurrentValue     = "$($dmarcReject.Count)/$totalDomains at p=reject -- $($issues -join '; ')"
                RecommendedValue = 'DMARC p=reject for all domains'
                Status           = 'Fail'
                CheckId          = 'DNS-DMARC-001'
                Remediation      = "Add/update DMARC for: $($issues -join '; '). Start with p=none + rua= to gather reports, then advance to p=quarantine, then p=reject. Example: v=DMARC1; p=reject; rua=mailto:dmarc@yourdomain.com"
            }
            Add-Setting @settingParams
        }
    }
    catch {
        Write-Warning "Could not check DMARC records: $_"
    }

    # ------------------------------------------------------------------
    # 4. MX Records (DNS-MX-001)
    # ------------------------------------------------------------------
    try {
        Write-Verbose "Checking MX records..."
        $mxPass    = @()   # domains routed to Exchange Online
        $mxNullMx  = @()   # domains with RFC 7505 null MX (0 .): intentional non-sending
        $mxWarning = @()   # domains with third-party relay MX
        $mxFail    = @()   # domains with no MX record

        foreach ($domain in $authDomains) {
            $domainName = $domain.DomainName
            if ($servfailDomains.Contains($domainName)) { continue }
            $mxRecords = @(Resolve-DnsRecord -Name $domainName -Type MX -ErrorAction SilentlyContinue)

            if (-not $mxRecords -or $mxRecords.Count -eq 0) {
                $mxFail += $domainName
                continue
            }

            # RFC 7505 null MX: NameExchange is '.' — explicit declaration that the domain
            # accepts no mail. Treat as Pass; non-sending domain lockdown is intentional.
            $isNullMx = $mxRecords | Where-Object { $_.NameExchange -eq '.' -or $_.NameExchange -eq '' }
            if ($isNullMx) {
                $mxNullMx += $domainName
                $null = $nullMxDomains.Add($domainName)
                continue
            }

            $pointsToExo = $mxRecords | Where-Object { $_.NameExchange -like '*.mail.protection.outlook.com' }
            if ($pointsToExo) { $mxPass += $domainName }
            else { $mxWarning += "$domainName ($($mxRecords[0].NameExchange))" }
        }

        $total = $mxPass.Count + $mxNullMx.Count + $mxWarning.Count + $mxFail.Count
        if ($mxFail.Count -eq 0 -and $mxWarning.Count -eq 0) {
            $nullNote = if ($mxNullMx.Count -gt 0) { "; $($mxNullMx.Count) null MX (non-sending)" } else { '' }
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'MX Records'
                CurrentValue     = "$($mxPass.Count)/$total domains route to Exchange Online$nullNote"
                RecommendedValue = 'MX pointing to *.mail.protection.outlook.com for all sending domains'
                Status           = 'Pass'
                CheckId          = 'DNS-MX-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        elseif ($mxFail.Count -gt 0) {
            $details = @()
            if ($mxPass.Count -gt 0)    { $details += "$($mxPass.Count) EXO" }
            if ($mxNullMx.Count -gt 0)  { $details += "$($mxNullMx.Count) null MX" }
            if ($mxWarning.Count -gt 0) { $details += "$($mxWarning.Count) third-party" }
            if ($mxFail.Count -gt 0)    { $details += "missing: $($mxFail -join ', ')" }
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'MX Records'
                CurrentValue     = "$($mxPass.Count)/$total to EXO -- $($details -join '; ')"
                RecommendedValue = 'MX pointing to *.mail.protection.outlook.com for all sending domains'
                Status           = 'Fail'
                CheckId          = 'DNS-MX-001'
                Remediation      = "Add MX records for: $($mxFail -join ', '). Required value: <domain>-com.mail.protection.outlook.com"
            }
            Add-Setting @settingParams
        }
        else {
            # All domains have MX but some point to third-party relays (Proofpoint, Mimecast, etc.)
            $settingParams = @{
                Category         = 'DNS Authentication'
                Setting          = 'MX Records'
                CurrentValue     = "$($mxPass.Count)/$total to EXO; third-party relay: $($mxWarning -join '; ')"
                RecommendedValue = 'MX pointing to *.mail.protection.outlook.com for all sending domains'
                Status           = 'Warning'
                CheckId          = 'DNS-MX-001'
                Remediation      = 'Verify third-party relay is intentional (e.g. Proofpoint, Mimecast). If not, update MX to <domain>-com.mail.protection.outlook.com.'
            }
            Add-Setting @settingParams
        }
    }
    catch {
        Write-Warning "Could not check MX records: $_"
    }

    # -- Defensive lockdown Info: domains with full non-sending lockdown pattern ----
    # Requires all three signals: null SPF (v=spf1 -all) + null MX (RFC 7505) +
    # enforcing DMARC (p=reject or p=quarantine). Missing any one signal means the
    # domain is only partially protected.
    $lockdownDomains = @($authDomains | Where-Object {
        $spfNullDomains.Contains($_.DomainName) -and
        $nullMxDomains.Contains($_.DomainName) -and
        $dmarcEnforcingDomains.Contains($_.DomainName)
    } | ForEach-Object { $_.DomainName })
    if ($lockdownDomains.Count -gt 0) {
        $settingParams = @{
            Category         = 'DNS Authentication'
            Setting          = 'Non-Sending Domain Lockdown'
            CurrentValue     = "$($lockdownDomains.Count) domain(s) fully locked down: $($lockdownDomains -join ', ')"
            RecommendedValue = 'v=spf1 -all, null MX (0 . per RFC 7505), DMARC p=reject for non-sending domains'
            Status           = 'Pass'
            CheckId          = 'DNS-LOCKDOWN-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }

    $ErrorActionPreference = 'Stop'
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'DNS Authentication'
