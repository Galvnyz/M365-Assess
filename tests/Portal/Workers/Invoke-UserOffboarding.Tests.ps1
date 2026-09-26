BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-UserOffboarding.ps1'
    $script:rerun = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Rerun-OffboardingStep.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/invoke-user-offboarding.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
    . $script:rerun

    $script:licensedUser = @{
        id                = 'user-1'
        displayName       = 'Member One'
        userPrincipalName = 'member.one@example.invalid'
        accountEnabled    = $true
        assignedLicenses  = @(@{ skuId = 'sku-1' }, @{ skuId = 'sku-2' })
    }

    function script:New-OffboardingMock {
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $Body)
            if ($Method -eq 'GET' -and $Uri -like '*/memberOf*') {
                return @{ value = @(@{ id = 'group-1' }, @{ id = 'group-2' }) }
            }
            if ($Method -eq 'GET') {
                return $script:licensedUser
            }
            return @{}
        }
    }

    function script:New-Plan {
        return @(
            [pscustomobject]@{ order = 1; action = 'disable-sign-in' },
            [pscustomobject]@{ order = 2; action = 'remove-licenses' },
            [pscustomobject]@{ order = 3; action = 'remove-groups' }
        )
    }

    function script:New-ProgressCapture {
        $capture = @{ events = @() }
        $seam = { param($ProgressEvent) $capture.events += $ProgressEvent }.GetNewClosure()
        return @{ capture = $capture; seam = $seam }
    }
}

Describe 'Invoke-UserOffboarding worker (T-0206)' {

    Context 'the worker files' {
        It 'ships the worker functions, the rerun module, and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:rerun | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-UserOffboarding -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Invoke-OffboardingStep -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Invoke-OffboardingStepRerun -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-OffboardingJob -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Get-OffboardingStepCatalogue -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'publishes the v1 first-cut step catalogue' {
            Get-OffboardingStepCatalogue | Should -Be @('disable-sign-in', 'remove-licenses', 'convert-mailbox', 'remove-groups')
        }

        It 'never persists job data to disk, logs, or transcripts' {
            foreach ($file in @($script:worker, $script:rerun)) {
                $source = Get-Content -LiteralPath $file -Raw
                $source | Should -Not -Match 'Out-File'
                $source | Should -Not -Match 'Export-Csv'
                $source | Should -Not -Match 'Export-Clixml'
                $source | Should -Not -Match 'Add-Content'
                $source | Should -Not -Match 'Set-Content'
                $source | Should -Not -Match 'Start-Transcript'
                $source | Should -Not -Match 'Write-Host'
                $source | Should -Not -Match 'Invoke-Expression'
            }
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Not -Match 'Out-File'
            $entrySource | Should -Not -Match 'Start-Transcript'
            $entrySource | Should -Not -Match 'Write-Host'
        }

        It 'entrypoint reads the job envelope, delegates to the workers, and emits JSON' {
            $entrySource = Get-Content -LiteralPath $script:entrypoint -Raw
            $entrySource | Should -Match 'Invoke-UserOffboarding.ps1'
            $entrySource | Should -Match 'Rerun-OffboardingStep.ps1'
            $entrySource | Should -Match 'Read-OffboardingJob -Path'
            $entrySource | Should -Match 'Invoke-UserOffboarding -TenantId'
            $entrySource | Should -Match 'Invoke-OffboardingStepRerun'
            $entrySource | Should -Match 'ConvertTo-Json'
        }
    }

    Context 'single steps' {
        BeforeEach {
            script:New-OffboardingMock
        }

        It 'requires the tenant, job, user, and a known step' {
            { Invoke-OffboardingStep -TenantId '' -JobId 'job-1' -UserId 'user-1' -Action 'disable-sign-in' } | Should -Throw
            { Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'wipe-device' } | Should -Throw '*users.offboarding_unknown_step*'
        }

        It 'plans the intended change with no Graph write on dry run' {
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'disable-sign-in' -DryRun

            $result.status | Should -Be 'planned'
            $result.after.intendedAction | Should -Be 'disable-sign-in'
            Should -Invoke Invoke-MgGraphRequest -Times 0 -Exactly
        }

        It 'disables sign-in with before/after and a success audit' {
            $script:audits = @()
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'disable-sign-in' -WriteAudit { param($AuditEvent) $script:audits += $AuditEvent }

            $result.status | Should -Be 'succeeded'
            $result.before.accountEnabled | Should -BeTrue
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' -and $Uri -eq '/v1.0/users/user-1' } -Times 1 -Exactly
            $script:audits | Should -HaveCount 1
            $script:audits[0].result | Should -Be 'success'
        }

        It 'removes every assigned license in one call' {
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'remove-licenses'

            $result.status | Should -Be 'succeeded'
            $result.before.licenses | Should -Be @('sku-1', 'sku-2')
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'POST' -and $Uri -like '*assignLicense*' } -Times 1 -Exactly
        }

        It 'converts the mailbox through the injected converter with the access mode recorded' {
            $script:converted = @()
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'convert-mailbox' `
                -MailboxAccess @{ mode = 'send-as'; automap = $true } `
                -MailboxConverter { param($ConvertedUser) $script:converted += $ConvertedUser }

            $result.status | Should -Be 'succeeded'
            $script:converted | Should -Be @('user-1')
            $result.after.mailboxType | Should -Be 'Shared'
            $result.after.mailboxAccess.mode | Should -Be 'send-as'
        }

        It 'fails mailbox conversion with a re-runnable reason when Exchange Online is unavailable' {
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'convert-mailbox'

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'users.offboarding_exo_required'
        }

        It 'removes every group membership' {
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'remove-groups'

            $result.status | Should -Be 'succeeded'
            $result.after.removedGroups | Should -Be @('group-1', 'group-2')
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'DELETE' } -Times 2 -Exactly
        }

        It 'fails with a clear error when the user does not exist' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                throw 'Request_ResourceNotFound'
            }
            $result = Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-9' -Action 'disable-sign-in'

            $result.status | Should -Be 'failed'
            $result.error | Should -Match 'was not found'
        }
    }

    Context 'job orchestration' {
        BeforeEach {
            script:New-OffboardingMock
        }

        It 'runs steps sequentially and records each outcome' {
            $progress = script:New-ProgressCapture
            $result = Invoke-UserOffboarding -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps (script:New-Plan) -WriteProgress $progress.seam

            $result.state | Should -Be 'completed'
            @($result.steps) | Should -HaveCount 3
            @($result.steps | Where-Object { $_.state -eq 'succeeded' }) | Should -HaveCount 3
            $sections = @($progress.capture.events | ForEach-Object { $_.section })
            $sections | Should -Contain '1/disable-sign-in'
            $sections | Should -Contain '3/remove-groups'
        }

        It 'stops at the first failed step and surfaces it for re-run' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST' -and $Uri -like '*assignLicense*') {
                    throw 'ServiceUnavailable: license service timed out'
                }
                if ($Method -eq 'GET' -and $Uri -like '*/memberOf*') {
                    return @{ value = @() }
                }
                if ($Method -eq 'GET') {
                    return $script:licensedUser
                }
                return @{}
            }
            $progress = script:New-ProgressCapture
            $result = Invoke-UserOffboarding -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps (script:New-Plan) -WriteProgress $progress.seam

            $result.state | Should -Be 'failed'
            @($result.steps) | Should -HaveCount 2
            $result.steps[0].state | Should -Be 'succeeded'
            $result.steps[1].state | Should -Be 'failed'
            $result.steps[1].error | Should -Match 'timed out'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'DELETE' } -Times 0 -Exactly
            $failedEvents = @($progress.capture.events | Where-Object { $_.state -eq 'failed' })
            @($failedEvents) | Should -HaveCount 1
        }

        It 're-runs one failed step without re-executing applied steps' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return $script:licensedUser
                }
                return @{}
            }
            $first = Invoke-OffboardingStepRerun -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps (script:New-Plan) -Order 2

            $first.order | Should -Be 2
            $first.action | Should -Be 'remove-licenses'
            $first.state | Should -Be 'succeeded'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' } -Times 0 -Exactly
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'DELETE' } -Times 0 -Exactly
        }

        It 'rejects a re-run order outside the plan' {
            { Invoke-OffboardingStepRerun -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps (script:New-Plan) -Order 9 } | Should -Throw '*users.offboarding_step_not_found*'
        }

        It 'honors the selected mailbox access mode on results' {
            $result = Invoke-UserOffboarding -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') `
                -Steps @([pscustomobject]@{ order = 1; action = 'disable-sign-in' }) `
                -MailboxAccess @{ mode = 'send-on-behalf'; automap = $false } -DryRun

            $result.steps[0].result.outcomes[0].after.mailboxAccess.mode | Should -Be 'send-on-behalf'
        }
    }

    Context 'job envelope' {
        It 'reads a full plan envelope with mailbox access and dry-run flags' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("offboarding-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    correlationId = 'correlation-1'
                    payload       = @{
                        jobId         = 'job-1'
                        userIds       = @('user-1', 'user-2')
                        steps         = @(@{ order = 1; action = 'disable-sign-in' })
                        mailboxAccess = @{ mode = 'full'; automap = $false }
                        dryRun        = $true
                        actor         = 'operator-1'
                    }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-OffboardingJob -Path $path

                $job['TenantId'] | Should -Be 'tenant-a'
                $job['JobId'] | Should -Be 'job-1'
                @($job['UserIds']) | Should -Be @('user-1', 'user-2')
                @($job['Steps']) | Should -HaveCount 1
                $job['DryRun'] | Should -BeTrue
                $job['RerunOrder'] | Should -Be 0
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'reads a single-step re-run envelope' {
            $path = Join-Path ([System.IO.Path]::GetTempPath()) ("offboarding-{0}.json" -f ([guid]::NewGuid()))
            try {
                @{
                    schemaVersion = 'v1'
                    tenantId      = 'tenant-a'
                    payload       = @{
                        jobId      = 'job-1'
                        userIds    = @('user-1')
                        steps      = @(@{ order = 2; action = 'remove-licenses' })
                        rerunOrder = 2
                    }
                } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8

                $job = Read-OffboardingJob -Path $path

                $job['RerunOrder'] | Should -Be 2
            }
            finally {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
        }

        It 'rejects a missing file, a bad schema version, and a missing tenant' {
            { Read-OffboardingJob -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-job.json') } | Should -Throw

            $badVersion = Join-Path ([System.IO.Path]::GetTempPath()) ("offboarding-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v9'; tenantId = 'tenant-a'; payload = @{} } | ConvertTo-Json | Set-Content -LiteralPath $badVersion -Encoding UTF8
            try {
                { Read-OffboardingJob -Path $badVersion } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $badVersion -Force -ErrorAction SilentlyContinue
            }

            $noTenant = Join-Path ([System.IO.Path]::GetTempPath()) ("offboarding-{0}.json" -f ([guid]::NewGuid()))
            @{ schemaVersion = 'v1'; payload = @{} } | ConvertTo-Json | Set-Content -LiteralPath $noTenant -Encoding UTF8
            try {
                { Read-OffboardingJob -Path $noTenant } | Should -Throw
            }
            finally {
                Remove-Item -LiteralPath $noTenant -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
