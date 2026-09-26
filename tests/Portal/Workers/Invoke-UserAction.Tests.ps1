BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-UserAction.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/invoke-user-action.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:liveUser = @{
        id                = 'user-1'
        displayName       = 'Member One'
        userPrincipalName = 'member.one@example.invalid'
        accountEnabled    = $true
    }

    function script:New-ActionMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Uri -like '*/deletedItems/*') {
                if ($Method -eq 'GET') {
                    return $script:liveUser
                }
                return @{ id = 'user-1' }
            }
            if ($Method -eq 'GET') {
                return $script:liveUser
            }
            return @{}
        }
    }
}

Describe 'Invoke-UserAction worker (T-0204)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-TenantUserAction -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-UserActionJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Get-UserLifecycleActions -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'publishes the section-4.3 action set and the confirmation set' {
            Get-UserLifecycleActions | Should -Be @('resetPassword', 'requirePasswordChange', 'revokeSessions', 'disable', 'enable', 'restore')
            Get-UserActionConfirmation | Should -Be @('revokeSessions', 'disable', 'restore')
        }

        It 'writes with POST and PATCH only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method PATCH'
            $source | Should -Match 'Invoke-MgGraphRequest -Method POST'
            $source | Should -Not -Match '-Method PUT'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match 'Invoke-Expression'
        }

        It 'never persists user data or passwords to disk, logs, or transcripts' {
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
            $entrySource | Should -Match 'Invoke-UserAction.ps1'
            $entrySource | Should -Match 'Read-UserActionJob -Path'
            $entrySource | Should -Match 'Invoke-TenantUserAction'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'action dispatch' {
        BeforeEach {
            script:New-ActionMock
        }

        It 'requires the tenant identifier and user identifier' {
            { Invoke-TenantUserAction -TenantId '' -UserId 'user-1' -Action 'enable' } | Should -Throw
            { Invoke-TenantUserAction -TenantId 'tenant-a' -UserId '' -Action 'enable' } | Should -Throw
        }

        It 'refuses an unknown action with a structured error and no Graph call' {
            { Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'wipeEverything' } | Should -Throw '*users.unknown_action*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'requires confirmation for session-breaking and destructive actions' {
            foreach ($action in @('revokeSessions', 'disable', 'restore')) {
                { Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action $action } | Should -Throw '*users.confirm_required*'
            }
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'plans the intended change with no Graph write on dry run' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'disable' -DryRun

            $result.status | Should -Be 'planned'
            $result.password | Should -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'disables the user with before/after capture and a success audit' {
            $script:audits = @()
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'disable' -Confirmed -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'applied'
            $result.before.accountEnabled | Should -BeTrue
            $result.after.id | Should -Be 'user-1'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' -and $Uri -eq '/v1.0/users/user-1' }
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'success'
        }

        It 'enables the user without confirmation' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'enable'

            $result.status | Should -Be 'applied'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'revokes sessions with confirmation' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'revokeSessions' -Confirmed

            $result.status | Should -Be 'applied'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'POST' -and $Uri -eq '/v1.0/users/user-1/revokeSignInSessions' }
        }

        It 'returns a one-time password for resetPassword without logging it' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'resetPassword'

            $result.status | Should -Be 'applied'
            $result.password | Should -Not -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'uses a caller-supplied password when provided' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'resetPassword' -OneTimeSecret 'Caller-Secret-1!'

            $result.status | Should -Be 'applied'
            $result.password | Should -Be 'Caller-Secret-1!'
        }

        It 'restores a soft-deleted user through the deleted-items path' {
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'restore' -Confirmed

            $result.status | Should -Be 'applied'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'GET' -and $Uri -like '*/deletedItems/*' }
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'POST' -and $Uri -like '*/deletedItems/*/restore' }
        }

        It 'fails restore with a clear error when no deleted user exists' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*/deletedItems/*' -and $Method -eq 'GET') {
                    throw 'Request_ResourceNotFound'
                }
                return @{}
            }
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-9' -Action 'restore' -Confirmed

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'soft-deleted'
        }

        It 'returns a per-action failure with a failure audit when Graph rejects the write' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return $script:liveUser
                }
                throw 'Authorization_RequestDenied'
            }
            $script:audits = @()
            $result = Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'disable' -Confirmed -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'failed'
            $result.password | Should -BeNullOrEmpty
            $result.error | Should -Match 'Authorization_RequestDenied'
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'failure'
        }
    }

    Context 'job envelope' {
        It 'reads an action envelope with confirmation and dry-run flags' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("user-action-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    correlationId = 'correlation-1'
                    payload       = @{ userId = 'user-1'; action = 'disable'; confirm = $true; dryRun = $false; actor = 'operator-1' }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-UserActionJob -Path $path

                $job['TenantId'] | Should -Be 'tenant-a'
                $job['UserId'] | Should -Be 'user-1'
                $job['Action'] | Should -Be 'disable'
                $job['Confirmed'] | Should -BeTrue
                $job['DryRun'] | Should -BeFalse
                $job['CorrelationId'] | Should -Be 'correlation-1'
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'rejects a missing file, a bad schema version, and missing fields' {
            { Read-UserActionJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-job.json') } | Should -Throw

            $badVersion = Join-Path ([System.IO.Path]::GetTempPath()) ("user-action-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v9'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1'; action = 'enable' } } | ConvertTo-Json | Set-Content -LiteralPath $badVersion -Encoding UTF8
            try {
                { Read-UserActionJob -Path $badVersion } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $badVersion -Force -ErrorAction SilentlyContinue
            }

            $noAction = Join-Path ([System.IO.Path]::GetTempPath()) ("user-action-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1' } } | ConvertTo-Json | Set-Content -LiteralPath $noAction -Encoding UTF8
            try {
                { Read-UserActionJob -Path $noAction } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $noAction -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
