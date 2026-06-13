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

    Context 'client-secret warning (#790)' {
        BeforeAll {
            # CI runners may not have Microsoft.Graph.Authentication or MicrosoftPowerBIMgmt
            # installed -- Pester's Mock requires the command to exist before it can shim it.
            # Stub the connect cmdlets globally if missing so Mock has something to replace.
            if (-not (Get-Command -Name Connect-MgGraph -ErrorAction SilentlyContinue)) {
                function global:Connect-MgGraph { param() }
            }
            if (-not (Get-Command -Name Connect-PowerBIServiceAccount -ErrorAction SilentlyContinue)) {
                function global:Connect-PowerBIServiceAccount { param() }
            }

            # Modules appear installed
            Mock Get-Module { @{ Name = 'Microsoft.Graph.Authentication' } }
            # No-op the actual connections so we don't reach out to a tenant
            Mock Connect-MgGraph { }
            Mock Connect-PowerBIServiceAccount { }
            # Get-Command introspection for the Graph NoWelcome check
            Mock Get-Command {
                [pscustomobject]@{ Parameters = @{ NoWelcome = $true } }
            } -ParameterFilter { $Name -eq 'Connect-MgGraph' }
        }

        AfterAll {
            # Tear down any global stubs we created so they don't leak into other tests
            Remove-Item -Path 'function:global:Connect-MgGraph' -ErrorAction SilentlyContinue
            Remove-Item -Path 'function:global:Connect-PowerBIServiceAccount' -ErrorAction SilentlyContinue
        }

        It 'Graph client-secret path emits a warning recommending certificate auth' {
            $secret = ConvertTo-SecureString 'fake-secret-value' -AsPlainText -Force
            $warningVar = $null
            & $script:scriptPath -Service 'Graph' -ClientId 'fake-app-id' -ClientSecret $secret -WarningVariable warningVar -WarningAction SilentlyContinue
            ($warningVar -join ' ') | Should -Match '(?i)certificate'
        }

        It 'Power BI client-secret path emits a warning recommending certificate auth' {
            $secret = ConvertTo-SecureString 'fake-secret-value' -AsPlainText -Force
            $warningVar = $null
            & $script:scriptPath -Service 'PowerBI' -ClientId 'fake-app-id' -ClientSecret $secret -WarningVariable warningVar -WarningAction SilentlyContinue
            ($warningVar -join ' ') | Should -Match '(?i)certificate'
        }

        It 'Graph certificate path does not emit the client-secret warning' {
            $warningVar = $null
            & $script:scriptPath -Service 'Graph' -ClientId 'fake-app-id' -CertificateThumbprint 'AB12CD34EF56' -WarningVariable warningVar -WarningAction SilentlyContinue
            ($warningVar -join ' ') | Should -Not -Match '(?i)client secret'
        }
    }

    Context 'Power BI sovereign-cloud environment routing (#943)' {
        BeforeAll {
            # Define the stub UNCONDITIONALLY with the parameters the collector
            # passes. On CI (no MicrosoftPowerBIMgmt module) the earlier client-
            # secret context leaves a param()-less residual command, so a
            # conditional `if (-not Get-Command)` stub would never be created and
            # the collector's -Environment arg would fail to bind before the mock
            # recorded the call -- invisible locally where the real module supplies
            # -Environment. Forcing our own param-ful stub makes binding (and the
            # ParameterFilter) reliable in both environments.
            function global:Connect-PowerBIServiceAccount {
                [CmdletBinding()]
                param(
                    $Environment, $Tenant, [switch]$ServicePrincipal,
                    $ApplicationId, $CertificateThumbprint, $Credential
                )
            }
            Mock Get-Module { @{ Name = 'MicrosoftPowerBIMgmt' } }
            Mock Connect-PowerBIServiceAccount { }
        }

        AfterAll {
            Remove-Item -Path 'function:global:Connect-PowerBIServiceAccount' -ErrorAction SilentlyContinue
        }

        It 'routes <Cloud> to the Power BI <PbiEnv> environment' -ForEach @(
            @{ Cloud = 'gcc';      PbiEnv = 'USGov' }
            @{ Cloud = 'gcchigh';  PbiEnv = 'USGovHigh' }
            @{ Cloud = 'dod';      PbiEnv = 'USGovMil' }
        ) {
            & $script:scriptPath -Service 'PowerBI' -M365Environment $Cloud -WarningAction SilentlyContinue
            Should -Invoke Connect-PowerBIServiceAccount -ParameterFilter {
                $Environment -eq $PbiEnv
            }
        }

        It 'does not pass an Environment for commercial' {
            & $script:scriptPath -Service 'PowerBI' -M365Environment 'commercial' -WarningAction SilentlyContinue
            Should -Invoke Connect-PowerBIServiceAccount -ParameterFilter {
                -not $PSBoundParameters.ContainsKey('Environment')
            }
        }
    }
}
