BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-MfaReport.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-mfa-report.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:liveUsers = @(
        @{
            id                = 'user-1'
            displayName       = 'Member One'
            userPrincipalName = 'member.one@example.invalid'
            assignedLicenses  = @(@{ skuId = 'sku-1' })
            signInActivity    = @{ lastSignInDateTime = '2026-08-01T00:00:00.000Z' }
        },
        @{
            id                = 'user-2'
            displayName       = 'Admin Two'
            userPrincipalName = 'admin.two@example.invalid'
            assignedLicenses  = @(@{ skuId = 'sku-1' })
            signInActivity    = @{ lastSignInDateTime = '2026-08-02T00:00:00.000Z' }
        },
        @{
            id                = 'user-3'
            displayName       = 'Guest Three'
            userPrincipalName = 'guest.three@example.invalid'
            assignedLicenses  = @()
        }
    )

    $script:methodsByUser = @{
        'user-1' = @(
            @{ '@odata.type' = '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod'; id = 'm-1' }
            @{ '@odata.type' = '#microsoft.graph.phoneAuthenticationMethod'; id = 'm-2' }
        )
        'user-2' = @(
            @{ '@odata.type' = '#microsoft.graph.fido2AuthenticationMethod'; id = 'm-3' }
        )
        'user-3' = @()
    }

    $script:registrationDetails = @(
        @{ id = 'user-1'; userPrincipalName = 'member.one@example.invalid'; isMfaRegistered = $true }
        @{ id = 'user-2'; userPrincipalName = 'admin.two@example.invalid'; isMfaRegistered = $true }
        @{ id = 'user-3'; userPrincipalName = 'guest.three@example.invalid'; isMfaRegistered = $false }
    )

    function script:New-MfaReportMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Uri -like '*userRegistrationDetails*') {
                return @{ value = $script:registrationDetails }
            }
            if ($Uri -like '*roleAssignments*') {
                return @{ value = @(@{ principalId = 'user-2' }) }
            }
            if ($Uri -like '*/authentication/methods*') {
                foreach ($userId in @($script:methodsByUser.Keys)) {
                    if ($Uri -like "*/users/$userId/authentication/methods*") {
                        return @{ value = $script:methodsByUser[$userId] }
                    }
                }
                return @{ value = @() }
            }
            if ($Uri -like '*/authentication/signInPreferences*') {
                return @{ preferredMethod = $null }
            }
            if ($Uri -like '*/users?*') {
                return @{ value = $script:liveUsers }
            }
            return @{ value = @() }
        }
    }
}

Describe 'Get-MfaReport worker (T-0221)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-MfaReport -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-MfaReportJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Get-MfaUserMethods -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command ConvertTo-MfaMethodId -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-MfaPhishingResistant -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'reads with GET only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method PATCH'
            $source | Should -Not -Match '-Method PUT'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match 'Invoke-Expression'
        }

        It 'never persists user data to disk, logs, or transcripts' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Not -Match 'Out-File'
            $source | Should -Not -Match 'Export-Csv'
            $source | Should -Not -Match 'Export-Clixml'
            $source | Should -Not -Match 'Add-Content'
            $source | Should -Not -Match 'Set-Content'
            $source | Should -Not -Match 'Start-Transcript'
            $source | Should -Not -Match 'Write-Host'
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Not -Match 'Out-File'
            $entrySource | Should -Not -Match 'Start-Transcript'
            $entrySource | Should -Not -Match 'Write-Host'
        }

        It 'entrypoint reads the job envelope, delegates to the worker, and emits JSON' {
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Match 'Get-MfaReport.ps1'
            $entrySource | Should -Match 'Read-MfaReportJob -Path'
            $entrySource | Should -Match 'Get-MfaReport'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'phishing-resistant classification' {
        It 'classifies the §11.4 set and excludes TAP and one-time methods' {
            Test-MfaPhishingResistant -MethodId 'fido2' | Should -BeTrue
            Test-MfaPhishingResistant -MethodId 'passkey' | Should -BeTrue
            Test-MfaPhishingResistant -MethodId 'windowsHelloForBusiness' | Should -BeTrue
            Test-MfaPhishingResistant -MethodId 'certificateBasedAuthentication' | Should -BeTrue
            Test-MfaPhishingResistant -MethodId 'temporaryAccessPass' | Should -BeFalse
            Test-MfaPhishingResistant -MethodId 'microsoftAuthenticator' | Should -BeFalse
            Test-MfaPhishingResistant -MethodId 'phone' | Should -BeFalse
            Test-MfaPhishingResistant -MethodId 'password' | Should -BeFalse
        }

        It 'maps Graph types to canonical ids and unknown types to null' {
            ConvertTo-MfaMethodId -OdataType '#microsoft.graph.fido2AuthenticationMethod' | Should -Be 'fido2'
            ConvertTo-MfaMethodId -OdataType '#microsoft.graph.platformCredentialAuthenticationMethod' | Should -Be 'passkey'
            ConvertTo-MfaMethodId -OdataType '#microsoft.graph.x509CertificateAuthenticationMethod' | Should -Be 'certificateBasedAuthentication'
            ConvertTo-MfaMethodId -OdataType '#microsoft.graph.someFutureMethod' | Should -BeNullOrEmpty
        }

        It 'flags a fido2 holder as phishing-resistant and an authenticator holder as not' {
            script:New-MfaReportMock
            (Get-MfaUserMethods -UserId 'user-2').phishingResistant | Should -Be 'phishing-resistant'
            $one = Get-MfaUserMethods -UserId 'user-1'
            $one.phishingResistant | Should -Be 'not-phishing-resistant'
            $one.methods | Should -Contain 'microsoftAuthenticator'
        }
    }

    Context 'report aggregation' {
        BeforeEach {
            script:New-MfaReportMock
        }

        It 'requires the tenant identifier' {
            { Get-MfaReport -TenantId '' } | Should -Throw
        }

        It 'returns every user with methods, default method, and phishing-resistant state' {
            $result = Get-MfaReport -TenantId 'tenant-a'
            $result.tenantId | Should -Be 'tenant-a'
            $result.rows.Count | Should -Be 3
            $row = @($result.rows | Where-Object { $_.userId -eq 'user-2' })[0]
            $row.methods | Should -Contain 'fido2'
            $row.phishingResistant | Should -Be 'phishing-resistant'
            $row.state | Should -Be 'registered'
            $row.isAdmin | Should -BeTrue
            $guest = @($result.rows | Where-Object { $_.userId -eq 'user-3' })[0]
            $guest.state | Should -Be 'notRegistered'
            $guest.isAdmin | Should -BeFalse
        }

        It 'filters by method and registration state' {
            (Get-MfaReport -TenantId 'tenant-a' -Method 'fido2').rows.Count | Should -Be 1
            (Get-MfaReport -TenantId 'tenant-a' -Registered 'notRegistered').rows.Count | Should -Be 1
            (Get-MfaReport -TenantId 'tenant-a' -PhishingResistant 'phishing-resistant').rows.Count | Should -Be 1
            (Get-MfaReport -TenantId 'tenant-a' -License 'unlicensed').rows.Count | Should -Be 1
            (Get-MfaReport -TenantId 'tenant-a' -AdminRole 'true').rows.Count | Should -Be 1
        }

        It 'pages with an opaque cursor' {
            $first = Get-MfaReport -TenantId 'tenant-a' -Top 2
            $first.rows.Count | Should -Be 2
            $first.nextCursor | Should -Not -BeNullOrEmpty
            $second = Get-MfaReport -TenantId 'tenant-a' -Top 2 -Cursor $first.nextCursor
            $second.rows.Count | Should -Be 1
            $second.nextCursor | Should -BeNullOrEmpty
        }
    }

    Context 'job envelope' {
        It 'reads filters from the envelope and rejects bad envelopes' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ('mfa-report-job-{0}.json' -f [guid]::NewGuid())
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{ filters = @{ method = 'fido2'; top = 25 } } } |
                ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
            try {
                $job = Read-MfaReportJob -Path $path
                $job['TenantId'] | Should -Be 'tenant-a'
                $job['Method'] | Should -Be 'fido2'
                $job['Top'] | Should -Be 25
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            { Read-MfaReportJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'missing-mfa-job.json') } | Should -Throw '*not found*'
        }
    }
}
