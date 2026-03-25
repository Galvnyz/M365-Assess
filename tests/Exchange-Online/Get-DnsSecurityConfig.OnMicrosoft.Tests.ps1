BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-DnsSecurityConfig .onmicrosoft.com DKIM handling' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }
        function Get-AcceptedDomain { }
        function Resolve-DnsRecord { }
        function Get-DkimSigningConfig { }

        Mock Get-AcceptedDomain {
            return @(
                [PSCustomObject]@{ DomainName = 'contoso.onmicrosoft.com'; DomainType = 'Authoritative' }
            )
        }

        # DNS returns nothing for .onmicrosoft.com DKIM selectors
        Mock Resolve-DnsRecord {
            param($Name, $Type)
            if ($Name -eq 'contoso.onmicrosoft.com' -and $Type -eq 'TXT') {
                return @([PSCustomObject]@{ Strings = @('v=spf1 include:spf.protection.outlook.com -all') })
            }
            if ($Name -eq '_dmarc.contoso.onmicrosoft.com' -and $Type -eq 'TXT') {
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

        # EXO says DKIM is enabled
        Mock Get-DkimSigningConfig {
            return @([PSCustomObject]@{
                Domain  = 'contoso.onmicrosoft.com'
                Enabled = $true
            })
        }

        . "$PSScriptRoot/../../Exchange-Online/Get-DnsSecurityConfig.ps1"
    }

    It 'Should pass DKIM check when EXO confirms signing for .onmicrosoft.com domain' {
        $settings | Should -Not -BeNullOrEmpty
        $dkimRow = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $dkimRow | Should -Not -BeNullOrEmpty
        $dkimRow.Status | Should -Be 'Pass'
    }

    It 'Should note that DKIM is EXO-confirmed for .onmicrosoft.com in CurrentValue' {
        $dkimRow = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $dkimRow.CurrentValue | Should -Match 'EXO.confirmed|onmicrosoft'
    }
}
