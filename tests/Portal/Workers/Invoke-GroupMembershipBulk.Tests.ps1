BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-GroupMembershipBulk.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/group-membership-bulk.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Invoke-GroupMembershipBulk worker (T-0268)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Invoke-GroupMembershipBulk -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-GroupMembershipBulkJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Bulk membership and owner operations' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -like '*/members*') {
                    return @{
                        value = @(
                            @{ id = 'user-1'; userPrincipalName = 'user1@contoso.com' }
                        )
                    }
                }
                if ($Method -eq 'GET' -and $Uri -like '*/owners*') {
                    return @{
                        value = @(
                            @{ id = 'owner-1'; userPrincipalName = 'owner1@contoso.com' }
                        )
                    }
                }
                if ($Method -eq 'POST') {
                    return @{}
                }
                if ($Method -eq 'DELETE') {
                    return @{}
                }
            }
        }

        It 'DryRun returns exact add diff without issuing writes' {
            $plan = Invoke-GroupMembershipBulk -TenantId 'tenant-test' -GroupId 'grp-123' -Role 'members' -Operation 'add' -Users @('user-1', 'user-2') -DryRun $true
            $plan.dryRun | Should -BeTrue
            $plan.total | Should -Be 2
            $plan.toAdd | Should -Be 1
            $plan.toSkip | Should -Be 1
            $plan.diff[0] | Should -Be 'Add user-2 to members'
            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'DryRun returns exact remove diff without issuing writes' {
            $plan = Invoke-GroupMembershipBulk -TenantId 'tenant-test' -GroupId 'grp-123' -Role 'members' -Operation 'remove' -Users @('user-1', 'user-2') -DryRun $true
            $plan.toRemove | Should -Be 1
            $plan.toSkip | Should -Be 1
            $plan.diff[0] | Should -Be 'Remove user-1 from members'
            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'DELETE' }
        }

        It 'applies batched additions, returns per-row status and per-change audit records' {
            $res = Invoke-GroupMembershipBulk -TenantId 'tenant-test' -GroupId 'grp-123' -Role 'members' -Operation 'add' -Users @('user-1', 'user-2') -DryRun $false
            $res.success | Should -BeTrue
            $res.results.Count | Should -Be 2

            $r1 = $res.results | Where-Object { $_.user -eq 'user-1' }
            $r1.status | Should -Be 'skipped'

            $r2 = $res.results | Where-Object { $_.user -eq 'user-2' }
            $r2.status | Should -Be 'added'

            $res.auditEvents.Count | Should -Be 1
            $res.auditEvents[0].action | Should -Be 'group.members.add'
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'works identically for owners' {
            $res = Invoke-GroupMembershipBulk -TenantId 'tenant-test' -GroupId 'grp-123' -Role 'owners' -Operation 'add' -Users @('owner-2') -DryRun $false
            $res.results[0].status | Should -Be 'added'
            $res.auditEvents[0].action | Should -Be 'group.owners.add'
        }
    }
}
