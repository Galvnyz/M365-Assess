BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-Group.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-group.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Set-Group worker (T-0262)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-SetGroup -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Test-DynamicRuleSyntax -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetGroupJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Dynamic-rule validation' {
        It 'accepts valid rule syntax' {
            $check = Test-DynamicRuleSyntax -Rule '(user.department -eq "Sales")'
            $check.Valid | Should -BeTrue

            $check2 = Test-DynamicRuleSyntax -Rule '(user.city -startsWith "New")'
            $check2.Valid | Should -BeTrue
        }

        It 'rejects empty or whitespace rules' {
            $check = Test-DynamicRuleSyntax -Rule '  '
            $check.Valid | Should -BeFalse
            $check.Message | Should -Match 'cannot be empty'
        }

        It 'rejects rules with mismatched parentheses' {
            $check = Test-DynamicRuleSyntax -Rule '(user.department -eq "Sales"'
            $check.Valid | Should -BeFalse
            $check.Message | Should -Match 'enclosed in parentheses|Mismatched'
        }

        It 'rejects rules without valid operators' {
            $check = Test-DynamicRuleSyntax -Rule '(user.department is "Sales")'
            $check.Valid | Should -BeFalse
            $check.Message | Should -Match 'valid comparison operator'
        }
    }

    Context 'Group CRUD operations and plan preview' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -like '*/groups/grp-123') {
                    return @{
                        id          = 'grp-123'
                        displayName = 'Old Security Group'
                        description = 'Old description'
                        mail        = $null
                        membershipRule = $null
                    }
                }
                if ($Method -eq 'POST' -and $Uri -like '*/groups') {
                    return @{
                        id          = 'grp-new-1'
                        displayName = 'New Sec Group'
                    }
                }
                if ($Method -eq 'PATCH') {
                    return @{
                        id          = 'grp-123'
                        displayName = 'Updated Security Group'
                    }
                }
                if ($Method -eq 'DELETE') {
                    return @{ deleted = $true }
                }
            }
        }

        It 'create with DryRun returns a plan preview without calling POST' {
            $plan = Invoke-SetGroup -TenantId 'tenant-test' -Action 'create' -DisplayName 'Test Group' -GroupType 'security' -DryRun $true
            $plan.valid | Should -BeTrue
            $plan.dryRun | Should -BeTrue
            $plan.targetName | Should -Be 'Test Group'
            $plan.diff | Should -Not -BeNullOrEmpty
            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'create without DryRun calls POST and produces an audit record' {
            $res = Invoke-SetGroup -TenantId 'tenant-test' -Action 'create' -DisplayName 'New Sec Group' -GroupType 'security' -DryRun $false
            $res.success | Should -BeTrue
            $res.auditEvent | Should -Not -BeNullOrEmpty
            $res.auditEvent.action | Should -Be 'group.create'
            $res.auditEvent.targetId | Should -Be 'grp-new-1'
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'edit with DryRun returns diff against existing group' {
            $plan = Invoke-SetGroup -TenantId 'tenant-test' -Action 'edit' -GroupId 'grp-123' -DisplayName 'Renamed Group' -DryRun $true
            $plan.valid | Should -BeTrue
            $plan.diff[0] | Should -Match 'Change displayName'
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'GET' }
            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'delete requires naming confirmation' {
            {
                Invoke-SetGroup -TenantId 'tenant-test' -Action 'delete' -GroupId 'grp-123' -ConfirmName 'Wrong Name'
            } | Should -Throw '*ConfirmationRequired*'
        }

        It 'delete succeeds when ConfirmName matches' {
            $res = Invoke-SetGroup -TenantId 'tenant-test' -Action 'delete' -GroupId 'grp-123' -ConfirmName 'Old Security Group'
            $res.success | Should -BeTrue
            $res.auditEvent.action | Should -Be 'group.delete'
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'DELETE' }
        }
    }
}
