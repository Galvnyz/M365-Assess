BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Reset-UserMfa.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/reset-user-mfa.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:methodsUser1 = @(
        @{ '@odata.type' = '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod'; id = 'm-1' }
        @{ '@odata.type' = '#microsoft.graph.phoneAuthenticationMethod'; id = 'm-2' }
    )

    function script:New-MfaResetMock {
        param(
            [string[]]$DeletesToFail = @()
        )
        $script:deletedIds = [System.Collections.Generic.List[string]]::new()
        $script:deletesToFailIds = @($DeletesToFail)
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Method -eq 'DELETE') {
                if ($Uri -match '/([^/]+)$') {
                    $script:deletedIds.Add($Matches[1])
                }
                foreach ($id in $script:deletesToFailIds) {
                    if ($Uri -like "*$id") {
                        throw "graph refused the delete of $id"
                    }
                }
                return @{}
            }
            if ($Uri -like '*/authentication/methods*') {
                $remaining = @($script:methodsUser1 | Where-Object { $script:deletedIds -notcontains $_.id })
                return @{ value = $remaining }
            }
            return @{ value = @() }
        }
    }
}

Describe 'Reset-UserMfa worker (T-0222)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-MfaReset -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-MfaResetJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Get-MfaResettableSegments -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'writes with DELETE only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method DELETE'
            $source | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method PATCH'
            $source | Should -Not -Match '-Method PUT'
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
            $entrySource | Should -Match 'Reset-UserMfa.ps1'
            $entrySource | Should -Match 'Read-MfaResetJob -Path'
            $entrySource | Should -Match 'Invoke-MfaReset'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'reset dispatch' {
        BeforeEach {
            script:New-MfaResetMock
        }

        It 'requires the tenant and user identifiers' {
            { Invoke-MfaReset -TenantId '' -UserId 'user-1' -Confirmed } | Should -Throw
            { Invoke-MfaReset -TenantId 'tenant-a' -UserId '' -Confirmed } | Should -Throw
        }

        It 'refuses to apply without confirmation' {
            { Invoke-MfaReset -TenantId 'tenant-a' -UserId 'user-1' } | Should -Throw '*mfa.confirm_required*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' }
        }

        It 'plans the would-remove methods on dry run with no Graph write' {
            $result = Invoke-MfaReset -TenantId 'tenant-a' -UserId 'user-1' -DryRun
            $result.status | Should -Be 'planned'
            $result.methods | Should -Contain 'microsoftAuthenticator'
            $result.methods | Should -Contain 'phone'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' }
        }

        It 'removes every method and returns the post-reset state' {
            $result = Invoke-MfaReset -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'applied'
            $result.removed.Count | Should -Be 2
            $result.methodsAfter.Count | Should -Be 0
            $result.error | Should -BeNullOrEmpty
        }

        It 'records a per-method failure without aborting the remaining deletes' {
            script:New-MfaResetMock -DeletesToFail @('m-1')
            $result = Invoke-MfaReset -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'm-1'
            $script:deletedIds.Count | Should -Be 2
        }
    }

    Context 'job envelope' {
        It 'reads the user and flags from the envelope and rejects bad envelopes' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ('mfa-reset-job-{0}.json' -f [guid]::NewGuid())
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1'; confirmed = $true } } |
                ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
            try {
                $job = Read-MfaResetJob -Path $path
                $job['TenantId'] | Should -Be 'tenant-a'
                $job['UserId'] | Should -Be 'user-1'
                $job['Confirmed'] | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            { Read-MfaResetJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'missing-mfa-reset-job.json') } | Should -Throw '*not found*'
        }
    }
}
