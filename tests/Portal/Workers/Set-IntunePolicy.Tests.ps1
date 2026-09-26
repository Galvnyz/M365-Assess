BeforeAll {
    $script:repoRoot    = Resolve-Path (Join-Path $PSScriptRoot '../../../')
    $script:worker      = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-IntunePolicy.ps1'
    $script:entrypoint  = Join-Path $script:repoRoot 'portal/workers/set-intune-policy.ps1'

    # Stub Invoke-MgGraphRequest before dot-sourcing the worker.
    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Set-IntunePolicy worker (T-0302)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker    | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetIntunePolicy     -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-IntunePolicyCrudJob   -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Job envelope reading' {
        It 'throws when envelope does not exist' {
            { Read-IntunePolicyCrudJob -Path '/path/does/not/exist.json' } | Should -Throw '*not found*'
        }

        It 'throws when tenantId is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"kind":"configuration","action":"create"}'
            try {
                { Read-IntunePolicyCrudJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'tenantId'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws when kind is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1","action":"create"}'
            try {
                { Read-IntunePolicyCrudJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'kind'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws when action is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1","kind":"configuration"}'
            try {
                { Read-IntunePolicyCrudJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'action'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws for unsupported kind (app-protection)' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1","kind":"app-protection","action":"create"}'
            try {
                { Read-IntunePolicyCrudJob -Path $tmp.FullName } | Should -Throw '*unsupported kind*'
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws for unknown action' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1","kind":"configuration","action":"clone"}'
            try {
                { Read-IntunePolicyCrudJob -Path $tmp.FullName } | Should -Throw '*unknown action*'
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'parses a valid envelope' {
            $tmp = New-TemporaryFile
            $envelope = @{
                tenantId    = 'tenant-123'
                kind        = 'compliance'
                action      = 'create'
                displayName = 'Windows Compliance v1'
                platform    = 'windows'
                dryRun      = $true
            } | ConvertTo-Json
            Set-Content -LiteralPath $tmp.FullName -Value $envelope
            try {
                $job = Read-IntunePolicyCrudJob -Path $tmp.FullName
                $job.TenantId    | Should -Be 'tenant-123'
                $job.Kind        | Should -Be 'compliance'
                $job.Action      | Should -Be 'create'
                $job.DisplayName | Should -Be 'Windows Compliance v1'
                $job.DryRun      | Should -BeTrue
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Create — configuration policy (dry-run plan preview)' {
        It 'returns a plan with diff and no audit event in DryRun mode' {
            $res = Invoke-SetIntunePolicy `
                -TenantId   'tenant-test' `
                -Kind       'configuration' `
                -Action     'create' `
                -DisplayName 'Security Baseline' `
                -Platform   'windows' `
                -DryRun     $true

            $res.success     | Should -BeTrue
            $res.plan        | Should -Not -BeNullOrEmpty
            $res.plan.action | Should -Be 'create'
            $res.plan.dryRun | Should -BeTrue
            $res.plan.diff.Count | Should -BeGreaterThan 0
            $res.plan.diff[0] | Should -BeLike '*Policy created*'
            $res.auditEvent  | Should -BeNullOrEmpty
        }
    }

    Context 'Create — configuration policy (live)' {
        It 'calls Graph POST and returns audit event' {
            $script:postCalled = $false
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST') {
                    $script:postCalled = $true
                    return [pscustomobject]@{ id = 'pol-new-123' }
                }
                return $null
            }

            $res = Invoke-SetIntunePolicy `
                -TenantId    'tenant-test' `
                -Kind        'configuration' `
                -Action      'create' `
                -DisplayName 'Security Baseline' `
                -Platform    'windows' `
                -DryRun      $false

            $script:postCalled | Should -BeTrue
            $res.success       | Should -BeTrue
            $res.plan.policyId | Should -Be 'pol-new-123'
            $res.auditEvent    | Should -Not -BeNullOrEmpty
            $res.auditEvent.action | Should -Be 'intune.configuration.create'
        }
    }

    Context 'Edit — compliance policy (dry-run plan preview)' {
        It 'fetches existing policy and returns diff plan' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                if ($Method -eq 'GET') {
                    return [pscustomobject]@{
                        id          = 'pol-cmp-1'
                        displayName = 'Old Compliance Name'
                        platform    = 'windows10AndLater'
                        assignments = @()
                    }
                }
                return $null
            }

            $res = Invoke-SetIntunePolicy `
                -TenantId    'tenant-test' `
                -Kind        'compliance' `
                -Action      'edit' `
                -PolicyId    'pol-cmp-1' `
                -DisplayName 'New Compliance Name' `
                -DryRun      $true

            $res.success     | Should -BeTrue
            $res.plan.action | Should -Be 'edit'
            $res.plan.dryRun | Should -BeTrue
            $res.plan.before | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Delete — confirmation required for assigned policy' {
        It 'throws when confirmName does not match policy name' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                if ($Method -eq 'GET') {
                    return [pscustomobject]@{
                        id          = 'pol-del-1'
                        displayName = 'Windows Compliance'
                        platform    = 'windows'
                        assignments = @(
                            [pscustomobject]@{ id = 'asgn-1' }
                        )
                    }
                }
                return $null
            }

            {
                Invoke-SetIntunePolicy `
                    -TenantId    'tenant-test' `
                    -Kind        'compliance' `
                    -Action      'delete' `
                    -PolicyId    'pol-del-1' `
                    -ConfirmName 'Wrong Name' `
                    -DryRun      $false
            } | Should -Throw '*ConfirmName*'
        }

        It 'succeeds when confirmName matches' {
            $script:deleteCalled = $false
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                if ($Method -eq 'GET') {
                    return [pscustomobject]@{
                        id          = 'pol-del-2'
                        displayName = 'Windows Compliance'
                        platform    = 'windows'
                        assignments = @(
                            [pscustomobject]@{ id = 'asgn-2' }
                        )
                    }
                }
                if ($Method -eq 'DELETE') {
                    $script:deleteCalled = $true
                    return $null
                }
                return $null
            }

            $res = Invoke-SetIntunePolicy `
                -TenantId    'tenant-test' `
                -Kind        'compliance' `
                -Action      'delete' `
                -PolicyId    'pol-del-2' `
                -ConfirmName 'Windows Compliance' `
                -DryRun      $false

            $script:deleteCalled | Should -BeTrue
            $res.success         | Should -BeTrue
            $res.auditEvent.action | Should -Be 'intune.compliance.delete'
        }
    }

    Context 'Create without displayName throws ValidationFailed' {
        It 'throws when displayName is not provided for create' {
            {
                Invoke-SetIntunePolicy `
                    -TenantId 'tenant-test' `
                    -Kind     'configuration' `
                    -Action   'create' `
                    -DryRun   $false
            } | Should -Throw '*ValidationFailed*displayName*'
        }
    }

    Context 'Edit without policyId throws' {
        It 'throws when policyId is not provided for edit' {
            {
                Invoke-SetIntunePolicy `
                    -TenantId 'tenant-test' `
                    -Kind     'compliance' `
                    -Action   'edit'
            } | Should -Throw '*ValidationFailed*policyId*'
        }
    }
}
