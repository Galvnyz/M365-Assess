BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-TenantUserProperties.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-tenant-user-properties.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    $script:currentUser = @{
        id             = 'user-1'
        displayName    = 'Old Name'
        givenName      = 'Old'
        surname        = 'Name'
        department     = 'Engineering'
        jobTitle       = 'Engineer'
        officeLocation = 'HQ'
        mobilePhone    = '+1 555 0100'
        usageLocation  = 'US'
    }

    function script:New-PatchMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Method -eq 'GET') {
                return $script:currentUser
            }
            return @{}
        }
    }
}

Describe 'Set-TenantUserProperties worker (T-0203)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Set-TenantUserProperties -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Set-TenantUserBulkProperties -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-TenantUserPatchJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-TenantUserPatchInput -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Compare-TenantUserPatch -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'publishes the patchable property catalogue' {
            Get-PatchableUserProperty | Should -Be @('displayName', 'givenName', 'surname', 'department', 'jobTitle', 'officeLocation', 'mobilePhone', 'usageLocation')
        }

        It 'patches with PATCH only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method PATCH'
            $source | Should -Not -Match '-Method POST'
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

        It 'entrypoint reads the job envelope, delegates to the bulk worker, and emits JSON' {
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Match 'Set-TenantUserProperties.ps1'
            $entrySource | Should -Match 'Read-TenantUserPatchJob -Path'
            $entrySource | Should -Match 'Set-TenantUserBulkProperties'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'validation' {
        It 'requires the tenant and user identifiers' {
            { Set-TenantUserProperties -TenantId '' -UserId 'user-1' -Properties @{ department = 'Finance' } } | Should -Throw
            { Set-TenantUserProperties -TenantId 'tenant-a' -UserId '' -Properties @{ department = 'Finance' } } | Should -Throw
        }

        It 'rejects an unknown property without a Graph call' {
            Mock Invoke-MgGraphRequest { param($Method, $Uri, $Body) }

            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ employeeId = '123' }

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'employeeId'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'rejects a non-string value and a malformed usage location' {
            $badType = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ department = 42 }
            $badType.status | Should -Be 'failed'
            $badType.error | Should -Match 'department'

            $badLocation = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ usageLocation = 'USA' }
            $badLocation.status | Should -Be 'failed'
            $badLocation.error | Should -Match '2-letter'
        }

        It 'computes the diff over a shaped snapshot (changed rows only)' {
            $before = [pscustomobject]@{ displayName = 'Old Name'; department = 'Engineering'; usageLocation = 'US' }

            $diffs = Compare-TenantUserPatch -Before $before -Properties @{ displayName = 'Old Name'; department = 'Finance' }

            @($diffs) | Should -HaveCount 1
            $diffs[0].property | Should -Be 'department'
            $diffs[0].before | Should -Be 'Engineering'
            $diffs[0].after | Should -Be 'Finance'
        }
    }

    Context 'single patch' {
        BeforeEach {
            script:New-PatchMock
        }

        It 'previews the diff with no Graph write on dry run' {
            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ displayName = 'New Name'; department = 'Engineering' } -DryRun

            $result.status | Should -Be 'previewed'
            @($result.diffs) | Should -HaveCount 1
            $result.diffs[0].property | Should -Be 'displayName'
            $result.diffs[0].before | Should -Be 'Old Name'
            $result.diffs[0].after | Should -Be 'New Name'
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Method -eq 'GET' }
        }

        It 'patches only changed properties with before/after and a success audit' {
            $script:audits = @()
            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ displayName = 'New Name'; department = 'Engineering' } -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'patched'
            @($result.diffs) | Should -HaveCount 1
            $result.before.displayName | Should -Be 'Old Name'
            $result.after.id | Should -Be 'user-1'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' -and $Uri -eq '/v1.0/users/user-1' } -Times 1 -Exactly
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'success'
            $script:audits[0].action | Should -Be 'users.patch'
        }

        It 'skips the PATCH call when nothing would change' {
            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ department = 'Engineering' }

            $result.status | Should -Be 'patched'
            @($result.diffs) | Should -HaveCount 0
            Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Method -eq 'GET' }
        }

        It 'fails with a clear error when the user does not exist' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                throw 'Request_ResourceNotFound'
            }
            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-9' -Properties @{ department = 'Finance' }

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'was not found'
        }

        It 'returns a per-row failure with a failure audit when Graph rejects the write' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return $script:currentUser
                }
                throw 'Authorization_RequestDenied'
            }
            $script:audits = @()
            $result = Set-TenantUserProperties -TenantId 'tenant-a' -UserId 'user-1' -Properties @{ department = 'Finance' } -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'Authorization_RequestDenied'
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'failure'
        }
    }

    Context 'bulk patch' {
        BeforeEach {
            script:New-PatchMock
        }

        It 'patches every row with per-row results' {
            $results = Set-TenantUserBulkProperties -TenantId 'tenant-a' -Patches @(
                @{ userId = 'user-1'; properties = @{ department = 'Finance' } },
                @{ userId = 'user-2'; properties = @{ department = 'Finance' } }
            )

            @($results) | Should -HaveCount 2
            @($results | Where-Object { $_.status -eq 'patched' }) | Should -HaveCount 2
        }

        It 'reports an invalid row per row without aborting siblings' {
            $results = Set-TenantUserBulkProperties -TenantId 'tenant-a' -Patches @(
                @{ userId = 'user-1'; properties = @{ department = 'Finance' } },
                @{ userId = 'user-2'; properties = @{ employeeId = '123' } }
            )

            $results[0].status | Should -Be 'patched'
            $results[1].status | Should -Be 'failed'
            $results[1].error | Should -Match 'employeeId'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' } -Times 1 -Exactly
        }

        It 'reports a row missing its user id as a per-row failure' {
            $results = Set-TenantUserBulkProperties -TenantId 'tenant-a' -Patches @(
                @{ userId = ''; properties = @{ department = 'Finance' } }
            )

            $results[0].status | Should -Be 'failed'
            $results[0].error | Should -Match 'userId'
        }
    }

    Context 'job envelope' {
        It 'reads a patch envelope with the preview flag' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("user-patch-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    payload       = @{
                        users   = @(@{ userId = 'user-1'; properties = @{ department = 'Finance' } })
                        preview = $true
                        actor   = 'operator-1'
                    }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-TenantUserPatchJob -Path $path

                $job['TenantId'] | Should -Be 'tenant-a'
                @($job['Patches']) | Should -HaveCount 1
                $job['Preview'] | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'rejects a missing file, a bad schema version, and a missing tenant' {
            { Read-TenantUserPatchJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-job.json') } | Should -Throw

            $badVersion = Join-Path ([System.IO.Path]::GetTempPath()) ("user-patch-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v9'; tenantId = 'tenant-a'; payload = @{ users = @() } } | ConvertTo-Json | Set-Content -LiteralPath $badVersion -Encoding UTF8
            try {
                { Read-TenantUserPatchJob -Path $badVersion } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $badVersion -Force -ErrorAction SilentlyContinue
            }

            $noTenant = Join-Path ([System.IO.Path]::GetTempPath()) ("user-patch-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v1'; payload = @{ users = @() } } | ConvertTo-Json | Set-Content -LiteralPath $noTenant -Encoding UTF8
            try {
                { Read-TenantUserPatchJob -Path $noTenant } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $noTenant -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
