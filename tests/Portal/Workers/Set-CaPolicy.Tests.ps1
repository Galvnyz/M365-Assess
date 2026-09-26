BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-CaPolicy.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-ca-policy.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Set-CaPolicy worker (T-0282)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetCaPolicy -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetCaPolicyJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Guardrail validation' {
        It 'hard-blocks All users + Block without break-glass exclusion' {
            $payload = @{
                displayName = 'Block All Policy'
                conditions = @{
                    users = @{
                        includeUsers = @('All')
                        excludeUsers = @()
                    }
                }
                grantControls = @{
                    builtInControls = @('block')
                }
            }

            { Test-CaGuardrails -Payload $payload } | Should -Throw "*cannot block All users without an explicit break-glass exclusion*"
        }

        It 'permits All users + Block with break-glass exclusion' {
            $payload = @{
                displayName = 'Block All Policy'
                conditions = @{
                    users = @{
                        includeUsers = @('All')
                        excludeUsers = @('breakglass@contoso.com')
                    }
                }
                grantControls = @{
                    builtInControls = @('block')
                }
            }

            { Test-CaGuardrails -Payload $payload } | Should -Not -Throw
        }
    }

    Context 'Create operation' {
        It 'DryRun returns a plan preview without calling POST' {
            $postCalled = $false
            Mock Invoke-MgGraphRequest {
                $postCalled = $true
            }

            $res = Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'create' -DisplayName 'New CA Policy' -DryRun $true
            $res.success | Should -BeTrue
            $res.plan.action | Should -Be 'create'
            $res.plan.targetName | Should -Be 'New CA Policy'
            $res.plan.after.state | Should -Be 'enabledForReportingButNotEnforced'
            $res.plan.diff.Count | Should -BeGreaterThan 0
            $postCalled | Should -BeFalse
        }

        It 'executes create with POST and records audit event' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'POST') {
                    return @{ id = 'new-policy-id'; displayName = 'New CA Policy'; state = 'enabledForReportingButNotEnforced' }
                }
                return @{}
            }

            $res = Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'create' -DisplayName 'New CA Policy' -DryRun $false
            $res.success | Should -BeTrue
            $res.plan.policyId | Should -Be 'new-policy-id'
            $res.auditEvent | Should -Not -BeNullOrEmpty
            $res.auditEvent.action | Should -Be 'ca.policy.create'
            $res.auditEvent.targetId | Should -Be 'new-policy-id'
        }
    }

    Context 'Edit operation' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{
                        id = 'policy-123'
                        displayName = 'Existing Policy'
                        state = 'enabledForReportingButNotEnforced'
                        conditions = @{
                            users = @{ includeUsers = @('All'); excludeUsers = @('bg@contoso.com') }
                        }
                        grantControls = @{ builtInControls = @('mfa') }
                    }
                }
                if ($Method -eq 'PATCH') {
                    return @{ id = 'policy-123'; displayName = 'Updated Policy' }
                }
                return @{}
            }
        }

        It 'DryRun returns diff preview without calling PATCH' {
            $patchCalled = $false
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{
                        id = 'policy-123'
                        displayName = 'Existing Policy'
                        state = 'enabledForReportingButNotEnforced'
                    }
                }
                if ($Method -eq 'PATCH') {
                    $patchCalled = $true
                }
            }

            $res = Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'edit' -PolicyId 'policy-123' -DisplayName 'Updated Policy' -DryRun $true
            $res.success | Should -BeTrue
            $res.plan.action | Should -Be 'edit'
            ($res.plan.diff -join "`n") | Should -Match "displayName: 'Existing Policy' -> 'Updated Policy'"
            $patchCalled | Should -BeFalse
        }

        It 'executes edit and records audit event' {
            $res = Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'edit' -PolicyId 'policy-123' -DisplayName 'Updated Policy' -DryRun $false
            $res.success | Should -BeTrue
            $res.auditEvent.action | Should -Be 'ca.policy.edit'
            $res.auditEvent.targetId | Should -Be 'policy-123'
        }
    }

    Context 'Delete operation' {
        It 'requires naming confirmation to delete an enforced policy' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{
                        id = 'enforced-pol'
                        displayName = 'Strict MFA Enforced'
                        state = 'enabled'
                    }
                }
                return @{}
            }

            { Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'delete' -PolicyId 'enforced-pol' -ConfirmName 'Wrong Name' } | Should -Throw "*requires ConfirmName matching*"
        }

        It 'succeeds when ConfirmName matches enforced policy' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET') {
                    return @{
                        id = 'enforced-pol'
                        displayName = 'Strict MFA Enforced'
                        state = 'enabled'
                    }
                }
                return @{}
            }

            $res = Invoke-SetCaPolicy -TenantId 'tenant-test' -Action 'delete' -PolicyId 'enforced-pol' -ConfirmName 'Strict MFA Enforced' -DryRun $false
            $res.success | Should -BeTrue
            $res.auditEvent.action | Should -Be 'ca.policy.delete'
        }
    }
}
