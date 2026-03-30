BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Resolve-DnsRecord' {
    BeforeAll {
        # Reset the cached backend so each context can set its own
        $script:DnsBackend = $null
        . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-DnsRecord.ps1"
    }

    Context 'when using Resolve-DnsName backend (Windows)' {
        BeforeAll {
            $script:DnsBackend = $null
            . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-DnsRecord.ps1"
            Mock Get-Command { [PSCustomObject]@{ Name = 'Resolve-DnsName' } } -ParameterFilter { $Name -eq 'Resolve-DnsName' }
            Mock Get-Command { $null } -ParameterFilter { $Name -eq 'dig' }
        }

        It 'Should return TXT records from Resolve-DnsName' {
            Mock Resolve-DnsName {
                @([PSCustomObject]@{
                    Name    = 'contoso.com'
                    Type    = 'TXT'
                    Strings = @('v=spf1 include:spf.protection.outlook.com -all')
                })
            }

            $result = Resolve-DnsRecord -Name 'contoso.com' -Type TXT
            $result | Should -Not -BeNullOrEmpty
            $result[0].Strings | Should -Contain 'v=spf1 include:spf.protection.outlook.com -all'
        }

        It 'Should return CNAME records from Resolve-DnsName' {
            Mock Resolve-DnsName {
                @([PSCustomObject]@{
                    Name     = 'selector1._domainkey.contoso.com'
                    Type     = 'CNAME'
                    NameHost = 'selector1-contoso._domainkey.contoso.onmicrosoft.com'
                })
            }

            $result = Resolve-DnsRecord -Name 'selector1._domainkey.contoso.com' -Type CNAME
            $result | Should -Not -BeNullOrEmpty
            $result[0].NameHost | Should -Be 'selector1-contoso._domainkey.contoso.onmicrosoft.com'
        }

        It 'Should pass Server parameter when specified' {
            Mock Resolve-DnsName {
                @([PSCustomObject]@{ Name = 'test.com'; Type = 'TXT'; Strings = @('test') })
            }

            Resolve-DnsRecord -Name 'test.com' -Type TXT -Server '8.8.8.8'
            Should -Invoke Resolve-DnsName -Times 1 -ParameterFilter { $Server -eq '8.8.8.8' }
        }
    }

    Context 'when using dig backend (macOS/Linux)' {
        BeforeAll {
            $script:DnsBackend = $null
            . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-DnsRecord.ps1"
            # Define dig as a function so Pester can mock it (dig is an external binary)
            function dig { }
            Mock Get-Command { $null } -ParameterFilter { $Name -eq 'Resolve-DnsName' }
            Mock Get-Command { [PSCustomObject]@{ Name = 'dig' } } -ParameterFilter { $Name -eq 'dig' }
        }

        It 'Should parse dig TXT output into Strings property' {
            Mock dig { '"v=spf1 include:spf.protection.outlook.com -all"' }
            $script:LASTEXITCODE = 0

            $result = Resolve-DnsRecord -Name 'contoso.com' -Type TXT
            $result | Should -Not -BeNullOrEmpty
            $result[0].Strings | Should -Contain 'v=spf1 include:spf.protection.outlook.com -all'
            $result[0].Type | Should -Be 'TXT'
        }

        It 'Should parse dig CNAME output into NameHost property' {
            Mock dig { 'selector1-contoso._domainkey.contoso.onmicrosoft.com.' }
            $script:LASTEXITCODE = 0

            $result = Resolve-DnsRecord -Name 'selector1._domainkey.contoso.com' -Type CNAME
            $result | Should -Not -BeNullOrEmpty
            $result[0].NameHost | Should -Be 'selector1-contoso._domainkey.contoso.onmicrosoft.com'
        }

        It 'Should return null on empty dig output' {
            Mock dig { '' }
            $script:LASTEXITCODE = 0

            $result = Resolve-DnsRecord -Name 'nonexistent.com' -Type TXT
            $result | Should -BeNullOrEmpty
        }
    }

    Context 'when no DNS backend is available' {
        BeforeAll {
            $script:DnsBackend = $null
            . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-DnsRecord.ps1"
            # Force backend to None (simulates no Resolve-DnsName and no dig)
            $script:DnsBackend = 'None'
        }

        It 'Should return null with Continue error action' {
            $result = Resolve-DnsRecord -Name 'test.com' -Type TXT -ErrorAction Continue -WarningAction SilentlyContinue
            $result | Should -BeNullOrEmpty
        }

        It 'Should throw with Stop error action' {
            { Resolve-DnsRecord -Name 'test.com' -Type TXT -ErrorAction Stop } | Should -Throw -ExpectedMessage "*No DNS resolution backend*"
        }
    }

    Context 'parameter validation' {
        BeforeAll {
            $script:DnsBackend = $null
            . "$PSScriptRoot/../../src/M365-Assess/Common/Resolve-DnsRecord.ps1"
        }

        It 'Should reject invalid record types' {
            { Resolve-DnsRecord -Name 'test.com' -Type 'MX' } | Should -Throw
        }

        It 'Should require Name parameter' {
            { Resolve-DnsRecord -Type 'TXT' } | Should -Throw
        }
    }
}
