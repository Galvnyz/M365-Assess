BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Invoke-DnsAuthentication' {
    BeforeAll {
        # Stub external commands
        function Get-MgContext { }
        function Get-AcceptedDomain { }
        function Resolve-DnsRecord { }
        function Show-CollectorResult { }
        function Complete-CheckProgress { }
        function Export-AssessmentCsv { return 0 }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/Invoke-DnsAuthentication.ps1"

        Mock Write-Host { }
        Mock Write-AssessmentLog { }
        Mock Show-CollectorResult { }
        Mock Complete-CheckProgress { }
    }

    Context 'when runDnsAuthentication is false' {
        BeforeAll {
            $script:runDnsAuthentication = $false
            $summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
            $issues = [System.Collections.Generic.List[PSCustomObject]]::new()
            $dnsCollector = @{ Name = '12-DNS-Email-Authentication'; Label = 'DNS Email Authentication' }

            Invoke-DnsAuthentication -AssessmentFolder $TestDrive -ProjectRoot $TestDrive -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector
        }

        It 'should not add any summary results' {
            $summaryResults.Count | Should -Be 0
        }

        It 'should not add any issues' {
            $issues.Count | Should -Be 0
        }
    }

    Context 'when runDnsAuthentication is true but no accepted domains' {
        BeforeAll {
            $script:runDnsAuthentication = $true
            $script:cachedAcceptedDomains = @()
            $summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
            $issues = [System.Collections.Generic.List[PSCustomObject]]::new()
            $dnsCollector = @{ Name = '12-DNS-Email-Authentication'; Label = 'DNS Email Authentication' }

            Mock Get-AcceptedDomain { return @() }

            Invoke-DnsAuthentication -AssessmentFolder $TestDrive -ProjectRoot $TestDrive -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector
        }

        It 'should not produce summary results when no domains available' {
            $summaryResults.Count | Should -Be 0
        }
    }

    Context 'when accepted domains exist and DNS resolves successfully' {
        BeforeAll {
            $script:runDnsAuthentication = $true
            $script:cachedAcceptedDomains = @(
                [PSCustomObject]@{ DomainName = 'contoso.com'; DomainType = 'Authoritative'; Default = $true }
            )
            $script:cachedDkimConfigs = @(
                [PSCustomObject]@{ Domain = 'contoso.com'; Enabled = $true }
            )
            $script:dnsPrefetchJobs = $null

            $summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
            $issues = [System.Collections.Generic.List[PSCustomObject]]::new()
            $dnsCollector = @{ Name = '12-DNS-Email-Authentication'; Label = 'DNS Email Authentication' }
            $assessmentFolder = $TestDrive
            $projectRoot = Join-Path $PSScriptRoot '../../src/M365-Assess'

            # Create a mock DNS Security Config script
            $dnsSecScript = Join-Path $projectRoot 'Exchange-Online/Get-DnsSecurityConfig.ps1'

            Mock Export-AssessmentCsv { return 1 }

            # Mock Resolve-DnsRecord for various record types
            Mock Resolve-DnsRecord {
                [PSCustomObject]@{ Strings = @('v=spf1 include:spf.protection.outlook.com -all') }
            } -ParameterFilter { $Type -eq 'TXT' -and $Name -notlike '_dmarc.*' -and $Name -notlike '_mta-sts.*' -and $Name -notlike '_smtp._tls.*' }

            Mock Resolve-DnsRecord {
                [PSCustomObject]@{ Strings = @('v=DMARC1; p=reject; rua=mailto:dmarc@contoso.com') }
            } -ParameterFilter { $Type -eq 'TXT' -and $Name -like '_dmarc.*' }

            Mock Resolve-DnsRecord {
                [PSCustomObject]@{ NameHost = 'selector1-contoso-com._domainkey.contoso.onmicrosoft.com' }
            } -ParameterFilter { $Type -eq 'CNAME' -and $Name -like 'selector1.*' }

            Mock Resolve-DnsRecord {
                [PSCustomObject]@{ NameHost = 'selector2-contoso-com._domainkey.contoso.onmicrosoft.com' }
            } -ParameterFilter { $Type -eq 'CNAME' -and $Name -like 'selector2.*' }

            Mock Resolve-DnsRecord { $null } -ParameterFilter { $Name -like '_mta-sts.*' }
            Mock Resolve-DnsRecord { $null } -ParameterFilter { $Name -like '_smtp._tls.*' }

            # We need the DNS Security Config script path to exist for the & call
            # but we can't easily mock script invocation -- let it fail gracefully
            # The DNS Authentication enumeration (the main path we test) runs separately
        }

        It 'should add summary results for DNS collectors' {
            Invoke-DnsAuthentication -AssessmentFolder $assessmentFolder -ProjectRoot $projectRoot -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector
            # At minimum, the DNS Security Config and DNS Authentication collectors add entries
            $summaryResults.Count | Should -BeGreaterOrEqual 1
        }

        It 'should set section to Email' {
            $emailResults = $summaryResults | Where-Object { $_.Section -eq 'Email' }
            $emailResults | Should -Not -BeNullOrEmpty
        }
    }

    Context 'when accepted domains include .onmicrosoft.com' {
        BeforeAll {
            $script:runDnsAuthentication = $true
            $script:cachedAcceptedDomains = @(
                [PSCustomObject]@{ DomainName = 'contoso.com'; DomainType = 'Authoritative'; Default = $true }
                [PSCustomObject]@{ DomainName = 'contoso.onmicrosoft.com'; DomainType = 'Authoritative'; Default = $false }
            )
            $script:cachedDkimConfigs = $null
            $script:dnsPrefetchJobs = $null

            $summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
            $issues = [System.Collections.Generic.List[PSCustomObject]]::new()
            $dnsCollector = @{ Name = '12-DNS-Email-Authentication'; Label = 'DNS Email Authentication' }
            $assessmentFolder = $TestDrive
            $projectRoot = Join-Path $PSScriptRoot '../../src/M365-Assess'

            Mock Export-AssessmentCsv { return 1 }
            Mock Resolve-DnsRecord { $null }

            Invoke-DnsAuthentication -AssessmentFolder $assessmentFolder -ProjectRoot $projectRoot -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector
        }

        It 'should not attempt DNS resolution for .onmicrosoft.com domains' {
            Should -Invoke Resolve-DnsRecord -ParameterFilter { $Name -like '*onmicrosoft*' } -Times 0 -Exactly
        }

        It 'should complete without issues' {
            $issues.Count | Should -Be 0
        }
    }

    Context 'when Get-AcceptedDomain throws (fallback from cache)' {
        BeforeAll {
            $script:runDnsAuthentication = $true
            $script:cachedAcceptedDomains = $null
            $summaryResults = [System.Collections.Generic.List[PSCustomObject]]::new()
            $issues = [System.Collections.Generic.List[PSCustomObject]]::new()
            $dnsCollector = @{ Name = '12-DNS-Email-Authentication'; Label = 'DNS Email Authentication' }

            Mock Get-AcceptedDomain { throw 'EXO not connected' }
        }

        It 'should log a warning and skip without error' {
            { Invoke-DnsAuthentication -AssessmentFolder $TestDrive -ProjectRoot $TestDrive -SummaryResults $summaryResults -Issues $issues -DnsCollector $dnsCollector } | Should -Not -Throw
            Should -Invoke Write-AssessmentLog -ParameterFilter { $Level -eq 'WARN' }
        }
    }
}
