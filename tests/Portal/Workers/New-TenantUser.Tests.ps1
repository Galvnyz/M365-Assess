BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/New-TenantUser.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/new-tenant-user.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker

    function script:New-Plan {
        param(
            [string]$Upn = 'new.user@example.invalid',
            [string]$DisplayName = 'New User',
            [string]$UsageLocation = 'US'
        )
        return [pscustomobject]@{
            userPrincipalName = $Upn
            displayName       = $DisplayName
            givenName         = 'New'
            surname           = 'User'
            usageLocation     = $UsageLocation
            licenses          = @()
            groups            = @()
            password          = ''
        }
    }

    function script:New-CreateMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Uri -like '*assignLicense*') {
                return @{}
            }
            if ($Uri -like '*/members/*') {
                return @{}
            }
            return @{ id = 'user-99'; userPrincipalName = 'new.user@example.invalid' }
        }
    }
}

Describe 'New-TenantUser worker (T-0202)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command New-TenantUser -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command New-TenantUserBulk -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-TenantUserCreateJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-TenantUserCreateInput -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'writes with POST only and never evaluates strings as code' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method POST'
            $source | Should -Not -Match '-Method PUT'
            $source | Should -Not -Match '-Method PATCH'
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
            $source | Should -Not -Match 'Tee-Object'
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Not -Match 'Out-File'
            $entrySource | Should -Not -Match 'Start-Transcript'
            $entrySource | Should -Not -Match 'Write-Host'
        }

        It 'entrypoint reads the job envelope, delegates to the bulk worker, and emits JSON' {
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Match 'New-TenantUser.ps1'
            $entrySource | Should -Match 'Read-TenantUserCreateJob -Path'
            $entrySource | Should -Match 'New-TenantUserBulk'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'validation' {
        It 'requires the tenant identifier' {
            { New-TenantUser -TenantId '' -User (script:New-Plan) } | Should -Throw
            { New-TenantUserBulk -TenantId '' -Users @((script:New-Plan)) } | Should -Throw
        }

        It 'rejects a missing UPN and display name per row' {
            $user = script:New-Plan -Upn '' -DisplayName '  '
            $result = New-TenantUser -TenantId 'tenant-a' -User $user

            $result.status | Should -Be 'failed'
            $result.id | Should -BeNullOrEmpty
            $result.error | Should -Match 'userPrincipalName is required'
            $result.error | Should -Match 'displayName is required'
        }

        It 'rejects a malformed UPN' {
            $result = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan -Upn 'not-a-upn')

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'not-a-upn'
        }

        It 'rejects a missing or malformed usage location' {
            $missing = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan -UsageLocation '')
            $missing.status | Should -Be 'failed'
            $missing.error | Should -Match 'usageLocation is required'

            $malformed = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan -UsageLocation 'USA')
            $malformed.status | Should -Be 'failed'
            $malformed.error | Should -Match '2-letter'
        }

        It 'rejects a license outside the tenant catalogue' {
            $user = script:New-Plan
            $user.licenses = @('sku-9')

            $result = New-TenantUser -TenantId 'tenant-a' -User $user -KnownLicenses @('sku-1')

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'sku-9'
        }

        It 'derives a mailNickname from the UPN prefix' {
            Get-TenantUserMailNickname -UserPrincipalName 'new.user@example.invalid' | Should -Be 'new.user'
            Get-TenantUserMailNickname -UserPrincipalName 'odd+tag@example.invalid' | Should -Be 'odd.tag'
        }
    }

    Context 'single create' {
        BeforeEach {
            script:New-CreateMock
        }

        It 'plans the intended change with no Graph write on dry run' {
            $result = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan) -DryRun

            $result.status | Should -Be 'planned'
            $result.after.userPrincipalName | Should -Be 'new.user@example.invalid'
            $result.before | Should -BeNullOrEmpty
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'creates the user, assigns licenses, and adds group members' {
            $script:audits = @()
            $user = script:New-Plan
            $user.licenses = @('sku-1')
            $user.groups = @('group-1')
            $result = New-TenantUser -TenantId 'tenant-a' -User $user -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'created'
            $result.id | Should -Be 'user-99'
            $result.before | Should -BeNullOrEmpty
            $result.after.userPrincipalName | Should -Be 'new.user@example.invalid'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'POST' -and $Uri -eq '/v1.0/users' }
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Uri -like '*assignLicense*' }
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Uri -like '*/members/*' }
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'success'
            $script:audits[0].action | Should -Be 'users.create'
        }

        It 'returns a generated one-time password only in the result' {
            $result = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan)

            $result.status | Should -Be 'created'
            $result.password | Should -Not -BeNullOrEmpty
        }

        It 'uses a caller-supplied password when provided' {
            $user = script:New-Plan
            $user.password = 'Caller-Secret-1!'

            $result = New-TenantUser -TenantId 'tenant-a' -User $user

            $result.status | Should -Be 'created'
            $result.password | Should -Be 'Caller-Secret-1!'
        }

        It 'returns a per-row failure with an audit record when Graph rejects the create' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                throw 'Request_Denied: create not permitted'
            }
            $script:audits = @()
            $result = New-TenantUser -TenantId 'tenant-a' -User (script:New-Plan) -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'failed'
            $result.id | Should -BeNullOrEmpty
            $result.error | Should -Match 'Request_Denied'
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'failure'
        }
    }

    Context 'bulk create' {
        BeforeEach {
            script:New-CreateMock
        }

        It 'creates every row with 1-based row numbers' {
            $results = New-TenantUserBulk -TenantId 'tenant-a' -Users @((script:New-Plan), (script:New-Plan -Upn 'second@example.invalid'))

            @($results) | Should -HaveCount 2
            $results[0].row | Should -Be 1
            $results[1].row | Should -Be 2
            @($results | Where-Object { $_.status -eq 'created' }) | Should -HaveCount 2
        }

        It 'reports a validation failure per row without aborting siblings' {
            $results = New-TenantUserBulk -TenantId 'tenant-a' -Users @((script:New-Plan), (script:New-Plan -Upn 'bad-upn'))

            @($results) | Should -HaveCount 2
            $results[0].status | Should -Be 'created'
            $results[1].status | Should -Be 'failed'
            $results[1].error | Should -Match 'bad-upn'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Uri -eq '/v1.0/users' } -Times 1 -Exactly
        }

        It 'reports an apply failure per row without aborting siblings' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Body -like '*second@example.invalid*') {
                    throw 'Request_Denied: duplicate'
                }
                if ($Uri -like '*assignLicense*' -or $Uri -like '*/members/*') {
                    return @{}
                }
                return @{ id = 'user-99' }
            }
            $results = New-TenantUserBulk -TenantId 'tenant-a' -Users @((script:New-Plan), (script:New-Plan -Upn 'second@example.invalid'))

            $results[0].status | Should -Be 'created'
            $results[1].status | Should -Be 'failed'
            $results[1].error | Should -Match 'duplicate'
        }

        It 'plans all rows with no Graph write on dry run' {
            $results = New-TenantUserBulk -TenantId 'tenant-a' -Users @((script:New-Plan), (script:New-Plan -Upn 'bad-upn')) -DryRun

            $results[0].status | Should -Be 'planned'
            $results[1].status | Should -Be 'failed'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }
    }

    Context 'job envelope' {
        It 'reads a single-user envelope' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("user-create-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    payload       = @{
                        user                = @{ userPrincipalName = 'solo@example.invalid'; displayName = 'Solo'; usageLocation = 'US' }
                        dryRun              = $true
                        defaultUsageLocation = 'US'
                        knownLicenses       = @('sku-1')
                    }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-TenantUserCreateJob -Path $path

                $job['TenantId'] | Should -Be 'tenant-a'
                @($job['Users']) | Should -HaveCount 1
                $job['DryRun'] | Should -BeTrue
                $job['DefaultUsageLocation'] | Should -Be 'US'
                @($job['KnownLicenses']) | Should -Be @('sku-1')
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'reads a bulk envelope' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("user-create-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    payload       = @{
                        users = @(
                            @{ userPrincipalName = 'a@example.invalid'; displayName = 'A'; usageLocation = 'US' }
                            @{ userPrincipalName = 'b@example.invalid'; displayName = 'B'; usageLocation = 'GB' }
                        )
                    }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-TenantUserCreateJob -Path $path

                @($job['Users']) | Should -HaveCount 2
                $job['DryRun'] | Should -BeFalse
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'rejects a missing file, a bad schema version, and a missing tenant' {
            { Read-TenantUserCreateJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-job.json') } | Should -Throw

            $badVersion = Join-Path ([System.IO.Path]::GetTempPath()) ("user-create-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v9'; tenantId = 'tenant-a'; payload = @{} } | ConvertTo-Json | Set-Content -LiteralPath $badVersion -Encoding UTF8
            try {
                { Read-TenantUserCreateJob -Path $badVersion } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $badVersion -Force -ErrorAction SilentlyContinue
            }

            $noTenant = Join-Path ([System.IO.Path]::GetTempPath()) ("user-create-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v1'; payload = @{} } | ConvertTo-Json | Set-Content -LiteralPath $noTenant -Encoding UTF8
            try {
                { Read-TenantUserCreateJob -Path $noTenant } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $noTenant -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
