# tests/Smoke/Cross-Platform.Tests.ps1 — B6 #777
#
# Catches platform-shaped bugs (path separators, case-sensitivity in dot-source
# paths, line-ending differences) without paying the heavy install cost of
# Microsoft.Graph / ExchangeOnlineManagement / Microsoft.PowerApps modules.
# Pester-on-Windows remains the source of truth; this lane just verifies that
# the parts of the module that DON'T require the Graph SDK still load and
# behave on Linux + macOS.

BeforeAll {
    $script:repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $script:moduleRoot = Join-Path $script:repoRoot 'src/M365-Assess'
    $script:manifestPath = Join-Path $script:moduleRoot 'M365-Assess.psd1'
}

Describe 'Cross-platform smoke (B6 #777)' {

    Context 'Manifest parses without platform-specific assumptions' {
        It 'should parse via Import-PowerShellDataFile on the current platform' {
            $manifest = Import-PowerShellDataFile -Path $script:manifestPath
            $manifest.ModuleVersion | Should -Match '^\d+\.\d+\.\d+$'
            $manifest.RootModule    | Should -BeLike '*.psm1'
        }

        It 'FileList entries resolve case-correctly (Linux is case-sensitive)' {
            $manifest = Import-PowerShellDataFile -Path $script:manifestPath
            $missing = @()
            foreach ($rel in $manifest.FileList) {
                # The case of the file as listed in the manifest must match the
                # case on disk. Linux runners reject mismatches that Windows + macOS
                # silently accept, so a stale FileList entry surfaces here first.
                $candidate = Join-Path $script:moduleRoot $rel
                if (-not (Test-Path $candidate)) {
                    $missing += $rel
                }
            }
            if ($missing.Count -gt 0) {
                throw "FileList contains $($missing.Count) entry(ies) that don't resolve on this platform:`n$(($missing | Select-Object -First 10) -join "`n")"
            }
        }
    }

    Context 'Control registry imports cleanly' {
        It 'should load registry.json + framework JSONs without parse errors' {
            . (Join-Path $script:moduleRoot 'Common/Import-ControlRegistry.ps1')
            . (Join-Path $script:moduleRoot 'Common/Import-FrameworkDefinitions.ps1')

            $registry = Import-ControlRegistry -ControlsPath (Join-Path $script:moduleRoot 'controls')
            $registry | Should -Not -BeNullOrEmpty
            $registry.Count | Should -BeGreaterThan 100

            $frameworks = Import-FrameworkDefinitions -FrameworksPath (Join-Path $script:moduleRoot 'controls/frameworks')
            $frameworks | Should -Not -BeNullOrEmpty
            ($frameworks | Measure-Object).Count | Should -BeGreaterThan 5
        }
    }

    Context 'SecurityConfigHelper contract works on this platform' {
        It 'should accept findings via Add-SecuritySetting and export them' {
            . (Join-Path $script:moduleRoot 'Common/SecurityConfigHelper.ps1')

            $ctx = Initialize-SecurityConfig
            Add-SecuritySetting -Settings $ctx.Settings -CheckIdCounter $ctx.CheckIdCounter `
                -Category 'Smoke' -Setting 'cross-platform check' -CurrentValue 'ok' `
                -RecommendedValue 'ok' -Status 'Pass' -CheckId 'SMOKE-001'

            $ctx.Settings.Count | Should -Be 1
            $ctx.Settings[0].Status | Should -Be 'Pass'
            $ctx.Settings[0].CheckId | Should -Be 'SMOKE-001.1'
        }
    }

    Context 'Build-ReportDataJson produces valid output from synthetic findings' {
        It 'should emit a well-formed window.REPORT_DATA assignment without tenant calls' {
            . (Join-Path $script:moduleRoot 'Common/Build-ReportData.ps1')

            $synthetic = @(
                [PSCustomObject]@{
                    CheckId          = 'SMOKE-001.1'
                    Category         = 'Smoke'
                    Setting          = 'platform parity'
                    CurrentValue     = 'ok'
                    RecommendedValue = 'ok'
                    Status           = 'Pass'
                    Remediation      = ''
                    Section          = 'Smoke'
                }
            )

            $json = Build-ReportDataJson -AllFindings $synthetic
            $json | Should -Not -BeNullOrEmpty
            $json | Should -Match '^window\.REPORT_DATA\s*='
            # The closing semicolon is required for the inline <script> contract.
            $json.TrimEnd() | Should -Match ';\s*$'
        }
    }

    Context 'Portable app-only certificate authentication (#1009)' {
        BeforeAll {
            $script:connectServicePath = Join-Path $script:moduleRoot 'Common/Connect-Service.ps1'
            $connectServiceSource = Get-Content -Path $script:connectServicePath -Raw

            # This smoke test is added ahead of the portable-auth implementation on
            # the maintenance branch. Skip there; the PR that introduces the new
            # parameters will exercise these assertions on Ubuntu/macOS.
            $script:portableAuthAvailable =
                $connectServiceSource -match '\[System\.Security\.Cryptography\.X509Certificates\.X509Certificate2\]\$Certificate' -and
                $connectServiceSource -match '\$CertificatePath' -and
                $connectServiceSource -match 'Resolve-InitialDomain'

            if (-not $script:portableAuthAvailable) { return }

            # The smoke lane deliberately has no Graph, EXO, or Purview modules.
            # Stub only the commands needed to exercise Connect-Service's parameter
            # plumbing; no network or tenant calls are possible.
            if (-not (Get-Command -Name Connect-ExchangeOnline -ErrorAction SilentlyContinue)) {
                function global:Connect-ExchangeOnline {
                    param(
                        $AppId, $Organization, $Certificate, $CertificateThumbprint,
                        $ShowBanner, $ExchangeEnvironmentName
                    )
                }
                $script:createdPortableAuthStubs += 'Connect-ExchangeOnline'
            }
            if (-not (Get-Command -Name Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
                function global:Invoke-MgGraphRequest { param($Method, $Uri) }
                $script:createdPortableAuthStubs += 'Invoke-MgGraphRequest'
            }

            Mock Get-Module { @{ Name = $Name } }
            Mock Connect-ExchangeOnline { }
            Mock Invoke-MgGraphRequest {
                @{ value = @{ verifiedDomains = @(
                    @{ name = 'primary.example.com';     isInitial = $false }
                    @{ name = 'contoso.onmicrosoft.com'; isInitial = $true  }
                ) } }
            } -ParameterFilter { $Uri -like '/v1.0/organization*' }

            $rsa = [System.Security.Cryptography.RSA]::Create(2048)
            $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
                'CN=M365Assess-Smoke', $rsa,
                [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
            $script:portableSmokeCertificate = $request.CreateSelfSigned(
                [System.DateTimeOffset]::UtcNow.AddDays(-1),
                [System.DateTimeOffset]::UtcNow.AddDays(1))
        }

        AfterAll {
            foreach ($commandName in @($script:createdPortableAuthStubs)) {
                Remove-Item -Path "function:global:$commandName" -ErrorAction SilentlyContinue
            }
        }

        It 'should pass an X509Certificate2 object and relative Graph lookup to Exchange Online' {
            if (-not $script:portableAuthAvailable) {
                Set-ItResult -Skipped -Because 'portable certificate parameters are not present on this branch'
                return
            }

            & $script:connectServicePath -Service 'ExchangeOnline' `
                -TenantId '00000000-0000-0000-0000-000000000000' `
                -ClientId 'smoke-app-id' -Certificate $script:portableSmokeCertificate `
                -ErrorAction Stop -WarningAction SilentlyContinue

            Should -Invoke Connect-ExchangeOnline -ParameterFilter {
                $AppId -eq 'smoke-app-id' -and
                $Organization -eq 'contoso.onmicrosoft.com' -and
                $Certificate.Thumbprint -eq $script:portableSmokeCertificate.Thumbprint -and
                -not $CertificateThumbprint
            }
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter {
                $Uri -eq '/v1.0/organization?$select=verifiedDomains'
            }
        }

        It 'should reject a bare Exchange thumbprint on non-Windows' {
            if (-not $script:portableAuthAvailable) {
                Set-ItResult -Skipped -Because 'portable certificate parameters are not present on this branch'
                return
            }
            if ($IsWindows) {
                Set-ItResult -Skipped -Because 'thumbprints are supported by the Windows certificate store'
                return
            }

            { & $script:connectServicePath -Service 'ExchangeOnline' `
                -TenantId 'contoso.onmicrosoft.com' -ClientId 'smoke-app-id' `
                -CertificateThumbprint 'AB12CD34EF56' -ErrorAction Stop } |
                Should -Throw -ExpectedMessage '*Windows-only*'
        }
    }
}
