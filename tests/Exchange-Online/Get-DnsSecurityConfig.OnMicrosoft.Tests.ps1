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

        # Only a .onmicrosoft.com domain -- filtered out at domain assembly
        Mock Get-AcceptedDomain {
            return @(
                [PSCustomObject]@{ DomainName = 'contoso.onmicrosoft.com'; DomainType = 'Authoritative' }
            )
        }

        Mock Resolve-DnsRecord {
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
            return @([PSCustomObject]@{
                Domain  = 'contoso.onmicrosoft.com'
                Enabled = $true
            })
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Exchange-Online/Get-DnsSecurityConfig.ps1"
    }

    It 'Should emit Review status when all accepted domains are .onmicrosoft.com (no checkable domains)' {
        $settings | Should -Not -BeNullOrEmpty
        $dkimRow = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $dkimRow | Should -Not -BeNullOrEmpty
        $dkimRow.Status | Should -Be 'Review'
    }

    It 'Should report no authoritative domains found when only .onmicrosoft.com domains exist' {
        $dkimRow = $settings | Where-Object { $_.Setting -eq 'DKIM Signing' }
        $dkimRow.CurrentValue | Should -Match 'No authoritative domains'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
