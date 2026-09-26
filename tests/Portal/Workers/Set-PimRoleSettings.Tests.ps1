BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Set-PimRoleSettings.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/set-pim-role-settings.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Set-PimRoleSettings worker (T-0244)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Set-PimRoleSettings -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-SetPimRoleSettingsJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'DryRun (plan preview)' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{ value = @() }
            }
        }

        It 'returns current vs proposed diff and issues no PATCH request' {
            $result = Set-PimRoleSettings -TenantId 'tenant-test' -RoleId 'role-ga' -Settings @{ maximumDurationInHours = 4; requireMfa = $true } -DryRun

            $result.dryRun | Should -BeTrue
            $result.applied | Should -BeNullOrEmpty
            $result.before.maximumDurationInHours | Should -Be 8
            $result.after.maximumDurationInHours | Should -Be 4

            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'PATCH' }
        }
    }

    Context 'Apply mode' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                if ($Method -eq 'GET' -and $Uri -like '*/roleManagementPolicies*') {
                    return @{ value = @(@{ id = 'pol-123' }) }
                }
                if ($Method -eq 'PATCH') {
                    return @{}
                }
                return @{ value = @() }
            }
        }

        It 'issues PATCH to policy rules and returns applied settings' {
            $result = Set-PimRoleSettings -TenantId 'tenant-test' -RoleId 'role-ga' -Settings @{ maximumDurationInHours = 4; requireMfa = $true }

            $result.dryRun | Should -BeFalse
            $result.applied | Should -Not -BeNullOrEmpty
            $result.applied.maximumDurationInHours | Should -Be 4
            $result.applied.requireMfa | Should -BeTrue

            Assert-MockCalled Invoke-MgGraphRequest -Times 2 -ParameterFilter { $Method -eq 'PATCH' }
        }
    }
}
