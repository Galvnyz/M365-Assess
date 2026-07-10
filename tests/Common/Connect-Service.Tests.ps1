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

    Context 'Exchange/Purview certificate app-only auth (portable, #1009)' {
        BeforeAll {
            # Stub the Exchange/Purview cmdlets + Graph request so nothing reaches a tenant.
            function global:Connect-ExchangeOnline {
                param($AppId, $Organization, $Certificate, $CertificateThumbprint,
                      $ManagedIdentity, $Device, $UserPrincipalName, $ExchangeEnvironmentName)
            }
            function global:Connect-IPPSSession {
                param($AppId, $Organization, $Certificate, $CertificateThumbprint,
                      $UserPrincipalName, $ConnectionUri, $AzureADAuthorizationEndpointUri)
            }
            if (-not (Get-Command -Name Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
                function global:Invoke-MgGraphRequest { param($Method, $Uri) }
            }
            Mock Get-Module { @{ Name = 'ExchangeOnlineManagement' } }
            Mock Import-Module { }
            Mock Connect-ExchangeOnline { }
            Mock Connect-IPPSSession { }
            # Relative-URI Graph lookup returns an initial domain distinct from -TenantId.
            Mock Invoke-MgGraphRequest {
                @{ value = @{ verifiedDomains = @(
                    @{ name = 'primary.example.com';        isInitial = $false }
                    @{ name = 'contoso.onmicrosoft.com';    isInitial = $true  }
                ) } }
            } -ParameterFilter { $Uri -like '*organization*' }

            # Cross-platform ephemeral self-signed certificate (no Windows Cert: provider).
            $rsa = [System.Security.Cryptography.RSA]::Create(2048)
            $req = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
                'CN=M365Assess-Test', $rsa,
                [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
            $script:testCert  = $req.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))
            $script:testThumb = $script:testCert.Thumbprint
        }

        AfterAll {
            Remove-Item -Path 'function:global:Connect-ExchangeOnline' -ErrorAction SilentlyContinue
            Remove-Item -Path 'function:global:Connect-IPPSSession' -ErrorAction SilentlyContinue
            Remove-Item -Path 'function:global:Invoke-MgGraphRequest' -ErrorAction SilentlyContinue
        }

        It 'Exchange Online with -Certificate connects with the object + resolved Organization' {
            & $script:scriptPath -Service 'ExchangeOnline' -TenantId '00000000-0000-0000-0000-000000000000' `
                -ClientId 'app-id' -Certificate $script:testCert -WarningAction SilentlyContinue
            Should -Invoke Connect-ExchangeOnline -ParameterFilter {
                $Certificate.Thumbprint -eq $script:testThumb -and
                $Organization -eq 'contoso.onmicrosoft.com' -and
                $AppId -eq 'app-id' -and
                -not $CertificateThumbprint
            }
        }

        It 'Purview with -Certificate connects with the object + resolved Organization' {
            & $script:scriptPath -Service 'Purview' -TenantId '00000000-0000-0000-0000-000000000000' `
                -ClientId 'app-id' -Certificate $script:testCert -WarningAction SilentlyContinue
            Should -Invoke Connect-IPPSSession -ParameterFilter {
                $Certificate.Thumbprint -eq $script:testThumb -and
                $Organization -eq 'contoso.onmicrosoft.com' -and
                $AppId -eq 'app-id'
            }
        }

        It 'resolves the initial domain via a RELATIVE Graph request (sovereign-cloud safe)' {
            & $script:scriptPath -Service 'ExchangeOnline' -TenantId '00000000-0000-0000-0000-000000000000' `
                -ClientId 'app-id' -Certificate $script:testCert -WarningAction SilentlyContinue
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter {
                $Uri -notmatch '^https?://' -and $Uri -like '/v1.0/organization*'
            }
        }

        It 'uses -TenantId directly when it already is an initial domain (no Graph call)' {
            & $script:scriptPath -Service 'ExchangeOnline' -TenantId 'fabrikam.onmicrosoft.com' `
                -ClientId 'app-id' -Certificate $script:testCert -WarningAction SilentlyContinue
            Should -Invoke Connect-ExchangeOnline -ParameterFilter { $Organization -eq 'fabrikam.onmicrosoft.com' }
            Should -Not -Invoke Invoke-MgGraphRequest
        }

        It 'loads the certificate from -CertificatePath' {
            $certPwd = ConvertTo-SecureString 'p@ss' -AsPlainText -Force
            $pfxBytes = $script:testCert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $certPwd)
            $pfxPath  = Join-Path ([System.IO.Path]::GetTempPath()) ("m365a-test-{0}.pfx" -f [System.IO.Path]::GetRandomFileName())
            [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)
            try {
                & $script:scriptPath -Service 'ExchangeOnline' -TenantId 'fabrikam.onmicrosoft.com' `
                    -ClientId 'app-id' -CertificatePath $pfxPath -CertificatePassword $certPwd -WarningAction SilentlyContinue
                Should -Invoke Connect-ExchangeOnline -ParameterFilter { $Certificate.Thumbprint -eq $script:testThumb }
            }
            finally { Remove-Item -Path $pfxPath -ErrorAction SilentlyContinue }
        }

        It 'uses -CertificateThumbprint on Windows' -Skip:(-not $IsWindows) {
            & $script:scriptPath -Service 'ExchangeOnline' -TenantId 'fabrikam.onmicrosoft.com' `
                -ClientId 'app-id' -CertificateThumbprint 'AB12CD34EF56' -WarningAction SilentlyContinue
            Should -Invoke Connect-ExchangeOnline -ParameterFilter {
                $CertificateThumbprint -eq 'AB12CD34EF56' -and -not $Certificate
            }
        }

        It 'throws for a bare thumbprint on Linux/macOS (Cert store is Windows-only)' -Skip:($IsWindows) {
            { & $script:scriptPath -Service 'ExchangeOnline' -TenantId 'fabrikam.onmicrosoft.com' `
                -ClientId 'app-id' -CertificateThumbprint 'AB12CD34EF56' -ErrorAction Stop } |
                Should -Throw -ExpectedMessage '*Windows-only*'
        }
    }
}
