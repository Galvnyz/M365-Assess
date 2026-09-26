BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/New-JitGrant.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/new-jit-grant.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'New-JitGrant worker (T-0246)' {

    Context 'the worker files' {
        It 'ships the functions and entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command New-JitGrant -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Revoke-JitGrant -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Extend-JitGrant -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-NewJitGrantJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'never deletes or mutates standard permanent role assignments' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            # Permanent assignments are in /roleManagement/directory/roleAssignments
            $source | Should -Not -Match '/roleManagement/directory/roleAssignments"'
            $source | Should -Not -Match 'DELETE'
        }
    }

    Context 'Grant, Revoke, and Extend execution' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{ id = 'schedule-req-1' }
            }
        }

        It 'creates a bounded JIT grant with startsAt and endsAt' {
            $result = New-JitGrant -TenantId 'tenant-test' -UserId 'user-alice' -RoleId 'role-ga' -DurationHours 4

            $result.state | Should -Be 'active'
            $result.durationHours | Should -Be 4
            $result.startsAt | Should -Not -BeNullOrEmpty
            $result.endsAt | Should -Not -BeNullOrEmpty
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'enforces maximum duration on grant' {
            {
                New-JitGrant -TenantId 'tenant-test' -UserId 'user-alice' -RoleId 'role-ga' -DurationHours 36 -MaxDurationHours 24
            } | Should -Throw '*exceeds maximum allowed duration*'
        }

        It 'revokes a JIT grant early' {
            $result = Revoke-JitGrant -TenantId 'tenant-test' -UserId 'user-alice' -RoleId 'role-ga'

            $result.state | Should -Be 'revoked'
            $result.revokedAt | Should -Not -BeNullOrEmpty
            Assert-MockCalled Invoke-MgGraphRequest -Times 1
        }

        It 'extends a JIT grant within max duration' {
            $result = Extend-JitGrant -TenantId 'tenant-test' -UserId 'user-alice' -RoleId 'role-ga' -AdditionalHours 4 -CurrentDurationHours 8 -MaxDurationHours 24

            $result.state | Should -Be 'extended'
            $result.durationHours | Should -Be 12
        }

        It 'rejects extension that exceeds max duration' {
            {
                Extend-JitGrant -TenantId 'tenant-test' -UserId 'user-alice' -RoleId 'role-ga' -AdditionalHours 20 -CurrentDurationHours 8 -MaxDurationHours 24
            } | Should -Throw '*exceeds maximum allowed duration*'
        }
    }
}
