BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-MfaAction.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/invoke-mfa-action.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:actionMethods = @(
        @{ '@odata.type' = '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod'; id = 'auth-1' }
        @{ '@odata.type' = '#microsoft.graph.phoneAuthenticationMethod'; id = 'phone-1' }
    )

    function script:New-MfaActionMock {
        param(
            [switch]$NoAuthenticator
        )
        $script:actionNoAuthenticator = [bool]$NoAuthenticator
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Uri -like '*/authentication/methods*') {
                $methods = $script:actionMethods
                if ($script:actionNoAuthenticator) {
                    $methods = @($methods | Where-Object { $_['@odata.type'] -notlike '*icrosoftAuthenticator*' })
                }
                return @{ value = $methods }
            }
            return @{ id = 'ok' }
        }
    }
}

Describe 'Invoke-MfaAction worker (T-0224)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-MfaAction -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-MfaActionJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Send-MfaPush -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Set-MfaDefaultMethod -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'publishes the section-3.2 action set' {
            Get-MfaActions | Should -Be @('push', 'defaultMethod')
        }

        It 'writes with POST and PATCH only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method POST'
            $source | Should -Match 'Invoke-MgGraphRequest -Method PATCH'
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
            $entrySource | Should -Match 'Invoke-MfaAction.ps1'
            $entrySource | Should -Match 'Read-MfaActionJob -Path'
            $entrySource | Should -Match 'Invoke-MfaAction'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'push dispatch' {
        BeforeEach {
            script:New-MfaActionMock
        }

        It 'requires the tenant and user identifiers' {
            { Send-MfaPush -TenantId '' -UserId 'user-1' -Confirmed } | Should -Throw
            { Send-MfaPush -TenantId 'tenant-a' -UserId '' -Confirmed } | Should -Throw
        }

        It 'refuses to send without confirmation' {
            { Send-MfaPush -TenantId 'tenant-a' -UserId 'user-1' } | Should -Throw '*mfa.confirm_required*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'POST' }
        }

        It 'sends only to a registered device and reports the target' {
            $result = Send-MfaPush -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'applied'
            $result.pushTarget | Should -Be 'auth-1'
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Method -eq 'POST' }
        }

        It 'plans the target on dry run with no Graph write' {
            $result = Send-MfaPush -TenantId 'tenant-a' -UserId 'user-1' -DryRun
            $result.status | Should -Be 'planned'
            $result.pushTarget | Should -Be 'auth-1'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'POST' }
        }

        It 'refuses the push when no push-capable device is registered' {
            script:New-MfaActionMock -NoAuthenticator
            $result = Send-MfaPush -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
            $result.status | Should -Be 'failed'
            $result.code | Should -Be 'no_push_device'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'POST' }
        }
    }

    Context 'default-method dispatch' {
        BeforeEach {
            script:New-MfaActionMock
        }

        It 'accepts a method from the registered set' {
            $result = Set-MfaDefaultMethod -TenantId 'tenant-a' -UserId 'user-1' -Method 'phone' -Confirmed
            $result.status | Should -Be 'applied'
            $result.defaultMethod | Should -Be 'phone'
            $result.methods | Should -Contain 'microsoftAuthenticator'
        }

        It 'refuses an unregistered method with the registered set returned' {
            $result = Set-MfaDefaultMethod -TenantId 'tenant-a' -UserId 'user-1' -Method 'fido2' -Confirmed
            $result.status | Should -Be 'failed'
            $result.code | Should -Be 'unregistered_method'
            $result.methods | Should -Contain 'phone'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'refuses to change without confirmation' {
            { Set-MfaDefaultMethod -TenantId 'tenant-a' -UserId 'user-1' -Method 'phone' } | Should -Throw '*mfa.confirm_required*'
        }
    }

    Context 'action dispatcher' {
        BeforeEach {
            script:New-MfaActionMock
        }

        It 'routes push and defaultMethod by name' {
            (Invoke-MfaAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'push' -Confirmed).status | Should -Be 'applied'
            (Invoke-MfaAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'defaultMethod' -Method 'phone' -Confirmed).status | Should -Be 'applied'
        }

        It 'refuses an unknown action with a structured error and no Graph call' {
            { Invoke-MfaAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'wipeEverything' -Confirmed } | Should -Throw '*mfa.unknown_action*'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }
    }

    Context 'job envelope' {
        It 'reads the action from the envelope and rejects bad envelopes' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ('mfa-action-job-{0}.json' -f [guid]::NewGuid())
            @{ schemaVersion = 'v1'; tenantId = 'tenant-a'; payload = @{ userId = 'user-1'; action = 'push'; confirmed = $true } } |
                ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
            try {
                $job = Read-MfaActionJob -Path $path
                $job['TenantId'] | Should -Be 'tenant-a'
                $job['Action'] | Should -Be 'push'
                $job['Confirmed'] | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            { Read-MfaActionJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'missing-mfa-action-job.json') } | Should -Throw '*not found*'
        }
    }
}
