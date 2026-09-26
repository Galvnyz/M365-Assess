BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-RoleAssignments.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-role-assignments.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-RoleAssignments worker (T-0241)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-RoleAssignments -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-RoleAssignmentsJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'is read-only: issues GET requests and no POST/DELETE/PATCH' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match '-Method PATCH'
        }
    }

    Context 'Get-RoleAssignments live mapping and filtering' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*/roleDefinitions*') {
                    return @{
                        value = @(
                            @{ id = 'role-ga'; displayName = 'Global Administrator' }
                            @{ id = 'role-sa'; displayName = 'Security Administrator' }
                        )
                    }
                }
                if ($Uri -like '*/roleAssignments*') {
                    return @{
                        value = @(
                            @{
                                id = 'ra-1'
                                roleDefinitionId = 'role-ga'
                                principalId = 'user-1'
                                directoryScopeId = '/'
                                principal = @{
                                    displayName = 'Alice Admin'
                                    userPrincipalName = 'alice@example.com'
                                    '@odata.type' = '#microsoft.graph.user'
                                }
                            }
                            @{
                                id = 'ra-2'
                                roleDefinitionId = 'role-sa'
                                principalId = 'sp-1'
                                directoryScopeId = '/'
                                principal = @{
                                    displayName = 'Automation SP'
                                    '@odata.type' = '#microsoft.graph.servicePrincipal'
                                }
                            }
                        )
                    }
                }
                if ($Uri -like '*/roleEligibilityScheduleInstances*') {
                    return @{
                        value = @(
                            @{
                                id = 'resi-1'
                                roleDefinitionId = 'role-ga'
                                principalId = 'user-2'
                                directoryScopeId = '/'
                                startDateTime = '2026-09-01T00:00:00Z'
                                endDateTime = '2027-09-01T00:00:00Z'
                                principal = @{
                                    displayName = 'Bob Eligible'
                                    userPrincipalName = 'bob@example.com'
                                    '@odata.type' = '#microsoft.graph.user'
                                }
                            }
                        )
                    }
                }
                return @{ value = @() }
            }
        }

        It 'returns assignments with §3.1 columns and distinguishes permanent from eligible' {
            $result = Get-RoleAssignments -TenantId 'tenant-test'
            $result.tenantId | Should -Be 'tenant-test'
            $result.items.Count | Should -Be 3

            $alice = $result.items | Where-Object { $_.principalDisplayName -eq 'Alice Admin' }
            $alice | Should -Not -BeNullOrEmpty
            $alice.assignmentType | Should -Be 'permanent'
            $alice.roleName | Should -Be 'Global Administrator'

            $bob = $result.items | Where-Object { $_.principalDisplayName -eq 'Bob Eligible' }
            $bob | Should -Not -BeNullOrEmpty
            $bob.assignmentType | Should -Be 'eligible'
            $bob.startDateTime | Should -Be '2026-09-01T00:00:00Z'
        }

        It 'filters by assignmentType' {
            $perm = Get-RoleAssignments -TenantId 'tenant-test' -AssignmentType 'permanent'
            $perm.items.Count | Should -Be 2
            ($perm.items | Where-Object { $_.assignmentType -ne 'permanent' }) | Should -BeNullOrEmpty

            $elig = Get-RoleAssignments -TenantId 'tenant-test' -AssignmentType 'eligible'
            $elig.items.Count | Should -Be 1
            $elig.items[0].principalDisplayName | Should -Be 'Bob Eligible'
        }

        It 'filters by principalType' {
            $sp = Get-RoleAssignments -TenantId 'tenant-test' -PrincipalType 'servicePrincipal'
            $sp.items.Count | Should -Be 1
            $sp.items[0].principalDisplayName | Should -Be 'Automation SP'
        }

        It 'filters by search' {
            $searched = Get-RoleAssignments -TenantId 'tenant-test' -Search 'bob'
            $searched.items.Count | Should -Be 1
            $searched.items[0].principalDisplayName | Should -Be 'Bob Eligible'
        }
    }
}
