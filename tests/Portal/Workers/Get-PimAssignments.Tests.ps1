BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-PimAssignments.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-pim-assignments.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-PimAssignments worker (T-0242)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-PimAssignments -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-PimAssignmentsJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'is read-only: issues GET requests only' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match '-Method PATCH'
        }
    }

    Context 'when P2 is present' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Uri -like '*/roleDefinitions*') {
                    return @{
                        value = @(
                            @{ id = 'role-ga'; displayName = 'Global Administrator' }
                        )
                    }
                }
                if ($Uri -like '*/roleEligibilityScheduleInstances*') {
                    return @{
                        value = @(
                            @{
                                id = 'elig-1'
                                roleDefinitionId = 'role-ga'
                                principalId = 'user-1'
                                directoryScopeId = '/'
                                startDateTime = '2026-09-01T00:00:00Z'
                                endDateTime = '2027-09-01T00:00:00Z'
                                principal = @{
                                    displayName = 'Alice Eligible'
                                    userPrincipalName = 'alice@contoso.com'
                                    '@odata.type' = '#microsoft.graph.user'
                                }
                            }
                        )
                    }
                }
                if ($Uri -like '*/roleAssignmentScheduleInstances*') {
                    return @{
                        value = @(
                            @{
                                id = 'act-1'
                                roleDefinitionId = 'role-ga'
                                principalId = 'user-2'
                                directoryScopeId = '/'
                                startDateTime = '2026-09-26T12:00:00Z'
                                endDateTime = '2026-09-26T20:00:00Z'
                                principal = @{
                                    displayName = 'Bob Active'
                                    userPrincipalName = 'bob@contoso.com'
                                    '@odata.type' = '#microsoft.graph.user'
                                }
                            }
                        )
                    }
                }
                return @{ value = @() }
            }
        }

        It 'returns eligible and active assignments with gate.supported = true' {
            $result = Get-PimAssignments -TenantId 'tenant-p2'
            $result.gate.supported | Should -BeTrue
            $result.gate.status | Should -Be 'licensed'
            $result.items.Count | Should -Be 2

            $elig = $result.items | Where-Object { $_.assignmentType -eq 'eligible' }
            $elig.principalDisplayName | Should -Be 'Alice Eligible'

            $act = $result.items | Where-Object { $_.assignmentType -eq 'active' }
            $act.principalDisplayName | Should -Be 'Bob Active'
        }

        It 'filters by assignmentType' {
            $actOnly = Get-PimAssignments -TenantId 'tenant-p2' -AssignmentType 'active'
            $actOnly.items.Count | Should -Be 1
            $actOnly.items[0].principalDisplayName | Should -Be 'Bob Active'
        }
    }

    Context 'when P2 is absent or unavailable' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                throw "Graph error: 403 Forbidden - RoleManagementPolicy requires Entra ID P2 license."
            }
        }

        It 'returns a structured license-missing gate payload instead of throwing' {
            $result = Get-PimAssignments -TenantId 'tenant-no-p2'
            $result.gate.supported | Should -BeFalse
            $result.gate.status | Should -Be 'license-missing'
            $result.gate.requiredLicense | Should -Be 'Entra ID P2'
            $result.gate.message | Should -Match 'requires Microsoft Entra ID P2'
            $result.items.Count | Should -Be 0
        }
    }
}
