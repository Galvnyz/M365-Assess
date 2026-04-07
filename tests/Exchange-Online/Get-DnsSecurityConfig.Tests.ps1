BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DnsSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO/DNS cmdlets so Mock can find them
        function Get-AcceptedDomain { }
        function Resolve-DnsRecord { }
        function Get-DkimSigningConfig { }

        # Mock accepted domains with one authoritative domain
        Mock Get-AcceptedDomain {
            return @([PSCustomObject]@{
                DomainName = 'contoso.com'
                DomainType = 'Authoritative'
            })
        }

        # Mock cross-platform DNS resolution for SPF and DMARC
        Mock Resolve-DnsRecord {
            param($Name, $Type)
            if ($Name -eq 'contoso.com' -and $Type -eq 'TXT') {
                return @([PSCustomObject]@{
                    Strings = @('v=spf1 include:spf.protection.outlook.com -all')
                })
            }
            if ($Name -eq '_dmarc.contoso.com' -and $Type -eq 'TXT') {
                return @([PSCustomObject]@{
                    Strings = @('v=DMARC1; p=reject; rua=mailto:dmarc@contoso.com')
                })
            }
            return $null
        }

        # Mock Get-Command for Update-CheckProgress guard
        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Update-CheckProgress') {
                return [PSCustomObject]@{ Name = 'Update-CheckProgress' }
            }
            return $null
        }

        # DKIM is now checked via try/catch instead of Get-Command guard
        Mock Get-DkimSigningConfig {
            return @([PSCustomObject]@{
                Domain  = 'contoso.com'
                Enabled = $true
            })
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All settings have required properties' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A')
        foreach ($s in $settings) {
            $s.Status | Should -BeIn $validStatuses `
                -Because "Setting '$($s.Setting)' has status '$($s.Status)'"
        }
    }

    It 'All non-empty CheckIds follow naming convention' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        $withCheckId.Count | Should -BeGreaterThan 0
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}(\.\d+)?$' `
                -Because "CheckId '$($s.CheckId)' should follow convention"
        }
    }

    It 'All CheckIds use the DNS- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^DNS-' `
                -Because "CheckId '$($s.CheckId)' should start with DNS-"
        }
    }

    It 'SPF check passes for properly configured domain' {
        $check = $settings | Where-Object { $_.Setting -eq 'SPF Records' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'DKIM check passes for properly configured domain' {
        $check = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'DMARC check passes for domain with p=reject' {
        $check = $settings | Where-Object { $_.Setting -eq 'DMARC Records' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Produces exactly 3 settings (SPF, DKIM, DMARC)' {
        $settings.Count | Should -Be 3
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DnsSecurityConfig - Missing Records' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub EXO/DNS cmdlets so Mock can find them
        function Get-AcceptedDomain { }
        function Resolve-DnsRecord { }
        function Get-DkimSigningConfig { }

        Mock Get-AcceptedDomain {
            return @([PSCustomObject]@{
                DomainName = 'example.com'
                DomainType = 'Authoritative'
            })
        }

        # No DNS records found
        Mock Resolve-DnsRecord {
            return $null
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Get-DkimSigningConfig') {
                return [PSCustomObject]@{ Name = 'Get-DkimSigningConfig' }
            }
            if ($Name -eq 'Update-CheckProgress') {
                return [PSCustomObject]@{ Name = 'Update-CheckProgress' }
            }
            return $null
        }

        Mock Get-DkimSigningConfig {
            return @()
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1"
    }

    It 'SPF check fails when no SPF record exists' {
        $check = $settings | Where-Object { $_.Setting -eq 'SPF Records' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'DKIM check fails when not configured' {
        $check = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'DMARC check fails when no DMARC record exists' {
        $check = $settings | Where-Object { $_.Setting -eq 'DMARC Records' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-DnsSecurityConfig - .onmicrosoft.com filtering' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        function Get-AcceptedDomain { }
        function Resolve-DnsRecord { }
        function Get-DkimSigningConfig { }

        # Return one real domain plus one Microsoft-managed .onmicrosoft.com domain
        Mock Get-AcceptedDomain {
            return @(
                [PSCustomObject]@{ DomainName = 'contoso.com'; DomainType = 'Authoritative' }
                [PSCustomObject]@{ DomainName = 'contoso.onmicrosoft.com'; DomainType = 'Authoritative' }
            )
        }

        Mock Resolve-DnsRecord {
            param($Name, $Type)
            if ($Name -eq 'contoso.com' -and $Type -eq 'TXT') {
                return @([PSCustomObject]@{ Strings = @('v=spf1 include:spf.protection.outlook.com -all') })
            }
            if ($Name -eq '_dmarc.contoso.com' -and $Type -eq 'TXT') {
                return @([PSCustomObject]@{ Strings = @('v=DMARC1; p=reject; rua=mailto:dmarc@contoso.com') })
            }
            return $null
        }

        Mock Get-Command {
            param($Name, $ErrorAction)
            if ($Name -eq 'Update-CheckProgress') {
                return [PSCustomObject]@{ Name = 'Update-CheckProgress' }
            }
            return $null
        }

        Mock Get-DkimSigningConfig {
            return @([PSCustomObject]@{ Domain = 'contoso.com'; Enabled = $true })
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1"
    }

    It 'should produce a Pass verdict when the real domain passes (not penalized for .onmicrosoft.com)' {
        $check = $settings | Where-Object { $_.Setting -eq 'SPF Records' }
        $check.Status | Should -Be 'Pass'
    }

    It 'should report 1/1 in CurrentValue -- .onmicrosoft.com excluded from domain count' {
        $check = $settings | Where-Object { $_.Setting -eq 'SPF Records' }
        $check.CurrentValue | Should -Match '1/1'
    }

    It 'should not attempt DNS resolution for .onmicrosoft.com' {
        Should -Invoke Resolve-DnsRecord -ParameterFilter { $Name -like '*onmicrosoft*' } -Times 0 -Exactly
    }

    It 'DKIM check passes for the real domain only' {
        $check = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $check.Status | Should -Be 'Pass'
    }

    It 'DMARC check passes for the real domain only' {
        $check = $settings | Where-Object { $_.Setting -eq 'DMARC Records' }
        $check.Status | Should -Be 'Pass'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
