BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Connect-Service' {
    BeforeAll {
        $script:scriptPath = "$PSScriptRoot/../../src/M365-Assess/Common/Connect-Service.ps1"
    }

    Context 'parameter validation' {
        It 'Should reject invalid service names' {
            { & $script:scriptPath -Service 'InvalidService' } | Should -Throw
        }

        It 'Should accept Graph as a valid service' {
            Mock Get-Module { $null }
            { & $script:scriptPath -Service 'Graph' -ErrorAction Stop 2>$null } | Should -Throw -ExpectedMessage "*Microsoft.Graph.Authentication*"
        }

        It 'Should accept ExchangeOnline as a valid service' {
            Mock Get-Module { $null }
            { & $script:scriptPath -Service 'ExchangeOnline' -ErrorAction Stop 2>$null } | Should -Throw -ExpectedMessage "*ExchangeOnlineManagement*"
        }

        It 'Should accept Purview as a valid service' {
            Mock Get-Module { $null }
            { & $script:scriptPath -Service 'Purview' -ErrorAction Stop 2>$null } | Should -Throw -ExpectedMessage "*ExchangeOnlineManagement*"
        }

        It 'Should accept PowerBI as a valid service' {
            Mock Get-Module { $null }
            { & $script:scriptPath -Service 'PowerBI' -ErrorAction Stop 2>$null } | Should -Throw -ExpectedMessage "*MicrosoftPowerBIMgmt*"
        }

        It 'Should validate M365Environment values' {
            { & $script:scriptPath -Service 'Graph' -M365Environment 'invalid' } | Should -Throw
        }
    }

    Context 'module check' {
        It 'Should error when required module is not installed' {
            Mock Get-Module { $null }

            { & $script:scriptPath -Service 'Graph' -ErrorAction Stop } | Should -Throw -ExpectedMessage "*not installed*"
        }
    }
}
