function Invoke-DnsAuthentication {
    [CmdletBinding()]
    param(
        [string]$AssessmentFolder,
        [string]$ProjectRoot,
        [System.Collections.Generic.List[PSCustomObject]]$SummaryResults,
        [System.Collections.Generic.List[PSCustomObject]]$Issues,
        [hashtable]$DnsCollector
    )

if ($script:runDnsAuthentication) {
    $acceptedDomains = $script:cachedAcceptedDomains
    if (-not $acceptedDomains -or $acceptedDomains.Count -eq 0) {
        try {
            $acceptedDomains = @(Get-AcceptedDomain -ErrorAction Stop)
        }
        catch {
            Write-AssessmentLog -Level WARN -Message "Skipping deferred DNS checks -- no cached domains and EXO unavailable" -Section 'Email'
        }
    }

    if ($acceptedDomains -and $acceptedDomains.Count -gt 0) {

    # Exclude Microsoft-managed .onmicrosoft.com domains -- no DNS records can be published for them
    $msftCount = @($acceptedDomains | Where-Object { $_.DomainName -like '*.onmicrosoft.com' }).Count
    $acceptedDomains = @($acceptedDomains | Where-Object { $_.DomainName -notlike '*.onmicrosoft.com' })
    if ($msftCount -gt 0) {
        Write-Verbose "Skipped $msftCount .onmicrosoft.com domain(s) from DNS enumeration -- Microsoft-managed, no public DNS records"
    }

    # Collect prefetched DNS cache (started during Graph connect)
    $dnsCache = @{}
    if ($script:dnsPrefetchJobs) {
        Write-Verbose "Collecting DNS prefetch results..."
        $prefetchResults = $script:dnsPrefetchJobs | Wait-Job | Receive-Job
        $script:dnsPrefetchJobs | Remove-Job -Force
        foreach ($pr in $prefetchResults) { $dnsCache[$pr.Domain] = $pr }
        $script:dnsPrefetchJobs = $null
    }

    # --- DNS Security Config collector (uses prefetch cache) ---
    $dnsSecConfigCollector = @{ Name = '12b-DNS-Security-Config'; Label = 'DNS Security Config' }
    $dnsSecStart = Get-Date
    $dnsSecCsvPath = Join-Path -Path $assessmentFolder -ChildPath "$($dnsSecConfigCollector.Name).csv"
    $dnsSecStatus = 'Skipped'
    $dnsSecItemCount = 0
    $dnsSecError = ''

    Write-AssessmentLog -Level INFO -Message "Running: $($dnsSecConfigCollector.Label)" -Section 'Email' -Collector $dnsSecConfigCollector.Label
    try {
        $dnsSecScriptPath = Join-Path -Path $projectRoot -ChildPath 'Exchange-Online\Get-DnsSecurityConfig.ps1'
        $dnsSecDkimData = if ($script:cachedDkimConfigs) { $script:cachedDkimConfigs } else { $null }
        $dnsSecResults = & $dnsSecScriptPath -AcceptedDomains $acceptedDomains -DkimConfigs $dnsSecDkimData
        if ($dnsSecResults) {
            $dnsSecItemCount = Export-AssessmentCsv -Path $dnsSecCsvPath -Data @($dnsSecResults) -Label $dnsSecConfigCollector.Label
            $dnsSecStatus = 'Complete'
        }
    }
    catch {
        $dnsSecError = $_.Exception.Message
        $dnsSecStatus = 'Failed'
        Write-AssessmentLog -Level ERROR -Message "DNS Security Config failed: $dnsSecError" -Section 'Email' -Collector $dnsSecConfigCollector.Label
    }

    $dnsSecDuration = (Get-Date) - $dnsSecStart
    $summaryResults.Add([PSCustomObject]@{
        Section   = 'Email'
        Collector = $dnsSecConfigCollector.Label
        FileName  = "$($dnsSecConfigCollector.Name).csv"
        Status    = $dnsSecStatus
        Items     = $dnsSecItemCount
        Duration  = '{0:mm\:ss}' -f $dnsSecDuration
        Error     = $dnsSecError
    })
    Show-CollectorResult -Label $dnsSecConfigCollector.Label -Status $dnsSecStatus -Items $dnsSecItemCount -DurationSeconds $dnsSecDuration.TotalSeconds -ErrorMessage $dnsSecError
    Write-AssessmentLog -Level INFO -Message "Completed: $($dnsSecConfigCollector.Label) -- $dnsSecStatus, $dnsSecItemCount items" -Section 'Email' -Collector $dnsSecConfigCollector.Label

    # --- DNS Authentication enumeration ---
    $dnsStart = Get-Date
    $dnsCsvPath = Join-Path -Path $assessmentFolder -ChildPath "$($dnsCollector.Name).csv"
    $dnsStatus = 'Skipped'
    $dnsItemCount = 0
    $dnsError = ''

    Write-AssessmentLog -Level INFO -Message "Running: $($dnsCollector.Label)" -Section 'Email' -Collector $dnsCollector.Label

    try {
        $dnsResults = foreach ($domain in $acceptedDomains) {
            $domainName = $domain.DomainName
            $cached = $dnsCache[$domainName]

            # ------- SPF -------
            $spf = 'Not configured'
            $spfEnforcement = 'N/A'
            $spfLookupCount = 'N/A'
            $spfDuplicates = 'No'

            try {
                $txtRecords = if ($cached -and $cached.PSObject.Properties['Spf']) { @($cached.Spf) } else { @(Resolve-DnsRecord -Name $domainName -Type TXT -ErrorAction SilentlyContinue) }
                $spfRecords = @($txtRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=spf1') })

                if ($spfRecords.Count -gt 1) {
                    $spfDuplicates = "Yes ($($spfRecords.Count) records -- PermError)"
                }

                if ($spfRecords.Count -ge 1) {
                    $spfValue = $spfRecords[0].Strings -join ''
                    $spf = $spfValue

                    if ($spfValue -match '-all$') { $spfEnforcement = 'Hard Fail (-all)' }
                    elseif ($spfValue -match '~all$') { $spfEnforcement = 'Soft Fail (~all)' }
                    elseif ($spfValue -match '\?all$') { $spfEnforcement = 'Neutral (?all)' }
                    elseif ($spfValue -match '\+all$') { $spfEnforcement = 'Pass (+all) WARNING' }
                    else { $spfEnforcement = 'No all mechanism' }

                    $lookupMechanisms = @(
                        [regex]::Matches($spfValue, '\b(include:|a:|a/|mx:|mx/|ptr:|exists:|redirect=)').Count
                    )
                    $spfLookupCount = "$($lookupMechanisms[0]) / 10"
                    if ($lookupMechanisms[0] -gt 10) {
                        $spfLookupCount = "$($lookupMechanisms[0]) / 10 -- EXCEEDS LIMIT"
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
                $dmarcTxtRecords = if ($cached -and $cached.PSObject.Properties['Dmarc']) { @($cached.Dmarc) } else { @(Resolve-DnsRecord -Name "_dmarc.$domainName" -Type TXT -ErrorAction SilentlyContinue) }
                $dmarcRecords = @($dmarcTxtRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=DMARC1') })

                if ($dmarcRecords.Count -gt 1) {
                    $dmarcDuplicates = "Yes ($($dmarcRecords.Count) records -- PermError)"
                }

                if ($dmarcRecords.Count -ge 1) {
                    $dmarcValue = $dmarcRecords[0].Strings -join ''
                    $dmarc = $dmarcValue

                    if ($dmarcValue -match 'p=(\w+)') {
                        $dmarcPolicy = $Matches[1]
                        if ($dmarcPolicy -eq 'none') { $dmarcPolicy = 'none (monitoring only)' }
                    }

                    if ($dmarcValue -match 'pct=(\d+)') {
                        $dmarcPct = "$($Matches[1])%"
                    }
                    else {
                        $dmarcPct = '100% (default)'
                    }

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
                $dkim1Records = if ($cached -and $cached.PSObject.Properties['Dkim1']) { $cached.Dkim1 } else { Resolve-DnsRecord -Name "selector1._domainkey.$domainName" -Type CNAME -ErrorAction SilentlyContinue }
                if ($dkim1Records.NameHost) { $dkimSelector1 = $dkim1Records.NameHost }
            }
            catch { Write-Verbose "DKIM selector1 lookup failed for $domainName`: $_" }

            try {
                $dkim2Records = if ($cached -and $cached.PSObject.Properties['Dkim2']) { $cached.Dkim2 } else { Resolve-DnsRecord -Name "selector2._domainkey.$domainName" -Type CNAME -ErrorAction SilentlyContinue }
                if ($dkim2Records.NameHost) { $dkimSelector2 = $dkim2Records.NameHost }
            }
            catch { Write-Verbose "DKIM selector2 lookup failed for $domainName`: $_" }

            # ------- DKIM EXO cross-reference -------
            $dkimStatus = 'N/A'
            $dkimDnsFound = ($dkimSelector1 -ne 'Not configured') -or ($dkimSelector2 -ne 'Not configured')
            if ($script:cachedDkimConfigs) {
                $exoDkim = @($script:cachedDkimConfigs | Where-Object { $_.Domain -eq $domainName })
                $exoDkimEnabled = [bool]($exoDkim | Where-Object { $_.Enabled })

                if ($dkimDnsFound -and $exoDkimEnabled) {
                    $dkimStatus = 'OK'
                }
                elseif (-not $dkimDnsFound -and $exoDkimEnabled) {
                    $dkimStatus = 'Mismatch: EXO enabled but DNS CNAME not found'
                }
                elseif ($dkimDnsFound -and -not $exoDkimEnabled) {
                    $dkimStatus = 'Mismatch: DNS CNAME exists but EXO signing disabled'
                }
                else {
                    $dkimStatus = 'Not configured'
                }
            }

            # ------- MTA-STS (RFC 8461) -------
            $mtaSts = 'Not configured'
            try {
                $mtaStsRecords = if ($cached -and $cached.PSObject.Properties['MtaSts']) { @($cached.MtaSts) } else { @(Resolve-DnsRecord -Name "_mta-sts.$domainName" -Type TXT -ErrorAction SilentlyContinue) }
                $mtaStsRecord = $mtaStsRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match 'v=STSv1') } | Select-Object -First 1
                if ($mtaStsRecord) {
                    $mtaSts = $mtaStsRecord.Strings -join ''
                }
            }
            catch { Write-Verbose "MTA-STS lookup failed for $domainName`: $_" }

            # ------- TLS-RPT (RFC 8460) -------
            $tlsRpt = 'Not configured'
            try {
                $tlsRptRecords = if ($cached -and $cached.PSObject.Properties['TlsRpt']) { @($cached.TlsRpt) } else { @(Resolve-DnsRecord -Name "_smtp._tls.$domainName" -Type TXT -ErrorAction SilentlyContinue) }
                $tlsRptRecord = $tlsRptRecords | Where-Object { $_.Strings -and ($_.Strings -join '' -match '^v=TLSRPTv1') } | Select-Object -First 1
                if ($tlsRptRecord) {
                    $tlsRpt = $tlsRptRecord.Strings -join ''
                }
            }
            catch { Write-Verbose "TLS-RPT lookup failed for $domainName`: $_" }

            # ------- Public DNS Validation -------
            $publicDnsConfirmed = 'N/A'
            if ($spf -ne 'Not configured' -and $spf -ne 'DNS lookup failed') {
                $publicChecks = @()
                foreach ($publicServer in @('8.8.8.8', '1.1.1.1')) {
                    try {
                        $publicTxt = @(Resolve-DnsRecord -Name $domainName -Type TXT -Server $publicServer -ErrorAction Stop)
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
                DKIMStatus       = $dkimStatus
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
    Write-AssessmentLog -Level INFO -Message "Completed: $($dnsCollector.Label) -- $dnsStatus, $dnsItemCount items" -Section 'Email' -Collector $dnsCollector.Label

    }
}

# Clean up check progress display
if (Get-Command -Name Complete-CheckProgress -ErrorAction SilentlyContinue) {
    Complete-CheckProgress
}

}
