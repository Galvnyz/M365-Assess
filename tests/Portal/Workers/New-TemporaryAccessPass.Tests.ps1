BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/New-TemporaryAccessPass.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/new-temporary-access-pass.ps1'
    $script:dbRepo = Join-Path $script:repoRoot 'portal/db/src/tap-repository.ts'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    function script:New-TapMock {
        param(
            [switch]$FailCreate,
            [switch]$EmptyValue
        )
        $script:tapFailCreate = [bool]$FailCreate
        $script:tapEmptyValue = [bool]$EmptyValue
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($script:tapFailCreate) {
                throw 'graph refused the TAP create'
            }
            $payload = @{}
            if ($Body) {
                $payload = $Body | ConvertFrom-Json -AsHashtable
            }
            $value = 'tap-secret-value'
            if ($script:tapEmptyValue) {
                $value = ''
            }
            return @{
                id                   = 'tap-1'
                temporaryAccessPass  = $value
                lifetimeInMinutes    = $payload['lifetimeInMinutes']
                isUsableOnce         = $payload['isUsableOnce']
            }
        }
    }
}

Describe 'New-TemporaryAccessPass worker (T-0223)' {

    Context 'the worker files' {
        It 'ships the worker functions, the entrypoint, and the TAP record repository' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            Test-Path -LiteralPath $script:dbRepo | Should -BeTrue
            (Get-Command New-TemporaryAccessPass -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-TapJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'writes with POST only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method POST'
            $source | Should -Not -Match '-Method PATCH'
            $source | Should -Not -Match '-Method PUT'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match 'Invoke-Expression'
        }

        It 'never persists the pass value to disk, logs, or transcripts' {
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
            $entrySource | Should -Match 'New-TemporaryAccessPass.ps1'
            $entrySource | Should -Match 'Read-TapJob -Path'
            $entrySource | Should -Match 'New-TemporaryAccessPass'
            $entrySource | Should -Match 'ConvertTo-Json'
        }

        It 'the record repository persists metadata without a secret column' {
            $repo = Get-Content -LiteralPath $script:dbRepo -Raw
            $repo | Should -Match 'tap_records'
            $repo | Should -Match 'lifetimeMinutes'
            $repo | Should -Match 'oneTime'
            $repo | Should -Not -Match 'temporaryAccessPass\s+TEXT'
            $repo | Should -Not -Match 'passValue'
            $repo | Should -Not -Match 'secretValue'
            $repo | Should -Not -Match 'tapValue'
        }
    }

    Context 'TAP creation' {
        BeforeEach {
            script:New-TapMock
        }

        It 'requires the tenant and user identifiers' {
            { New-TemporaryAccessPass -TenantId '' -UserId 'user-1' -Confirmed } | Should -Throw
            { New-TemporaryAccessPass -TenantId 'tenant-a' -UserId '' -Confirmed } | Should -Throw
        }

        It 'refuses to issue without confirmation' {
            { New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' } | Should -Throw '*mfa.confirm_required*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'plans metadata with a null value on dry run and no Graph write' {
            $result = New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' -LifetimeMinutes 120 -DryRun
            $result.status | Should -Be 'planned'
            $result.lifetimeMinutes | Should -Be 120
            $result.oneTime | Should -BeTrue
            $result.temporaryAccessPass | Should -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'returns the pass value once with lifetime, one-time-use, and start time honored' {
            $result = New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' -LifetimeMinutes 480 -OneTime $false -StartTime '2026-09-27T08:00:00.000Z' -Confirmed
            $result.status | Should -Be 'applied'
            $result.temporaryAccessPass | Should -Be 'tap-secret-value'
            $result.lifetimeMinutes | Should -Be 480
            $result.oneTime | Should -BeFalse
            $result.startTime | Should -Not -BeNullOrEmpty
            $result.expiresAt | Should -Not -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Method -eq 'POST' }
        }

        It 'returns a failure without a value when Graph refuses' {
            script:New-TapMock -FailCreate
            $result = New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'failed'
            $result.temporaryAccessPass | Should -BeNullOrEmpty
            $result.error | Should -Match 'graph refused'
        }

        It 'returns a failure when Graph returns no pass value' {
            script:New-TapMock -EmptyValue
            $result = New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'failed'
            $result.temporaryAccessPass | Should -BeNullOrEmpty
        }
    }

    Context 'job envelope' {
        It 'reads TAP options from the envelope and rejects bad envelopes' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ('tap-job-{0}.json' -f [guid]::NewGuid())
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1'; lifetimeMinutes = 120; oneTime = $false; confirmed = $true } } |
                ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
            try {
                $job = Read-TapJob -Path $path
                $job['TenantId'] | Should -Be 'tenant-a'
                $job['UserId'] | Should -Be 'user-1'
                $job['LifetimeMinutes'] | Should -Be 120
                $job['OneTime'] | Should -BeFalse
                $job['Confirmed'] | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            { Read-TapJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'missing-tap-job.json') } | Should -Throw '*not found*'
        }

        It 'keeps a start time in UTC ISO form rather than a local-format date' {
            $path = Join-Path -Path $TestDrive -ChildPath 'tap-start.json'
            Set-Content -LiteralPath $path -Value '{"schemaVersion":"v1","tenantId":"t","payload":{"userId":"u","startTime":"2026-09-26T20:00:00Z"}}'
            $start = (Read-TapJob -Path $path)['StartTime']
            $start | Should -Match '^2026-09-26T20:00:00(\.0+)?Z$'
        }
    }
}
