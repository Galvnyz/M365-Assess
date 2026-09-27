BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/New-PimRequest.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'New-PimRequest worker (T-0245)' {

    Context 'the worker functions' {
        It 'ships the functions' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            (Get-Command New-PimRequest -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-PimRequestJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'ships an entrypoint that signs in to the tenant' {
            $entrypoint = Join-Path $script:repoRoot 'portal/workers/new-pim-request.ps1'
            Test-Path -LiteralPath $entrypoint | Should -BeTrue
            (Get-Content -LiteralPath $entrypoint -Raw) | Should -Match 'Connect-WorkerTenant -JobFile'
        }
    }

    Context 'Mandatory justification' {
        It 'rejects request without justification' {
            {
                New-PimRequest -TenantId 'tenant-test' -PrincipalId 'u-1' -RoleId 'r-1' -Justification ''
            } | Should -Throw '*justification is required*'
        }
    }

    Context 'Submission and state transitions' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{
                    id = 'req-123'
                    status = 'Granted'
                }
            }
        }

        It 'submits valid request and activates directly when approval not required' {
            $result = New-PimRequest -TenantId 'tenant-test' -PrincipalId 'u-1' -RoleId 'r-1' -Justification 'Emergency incident INC-123'

            $result.state | Should -Be 'active'
            $result.id | Should -Be 'req-123'
            $result.startsAt | Should -Not -BeNullOrEmpty
            $result.endsAt | Should -Not -BeNullOrEmpty
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'POST' }
        }

        It 'enters pending state when approval is configured' {
            $result = New-PimRequest -TenantId 'tenant-test' -PrincipalId 'u-1' -RoleId 'r-1' -Justification 'Planned maintenance' -ApprovalRequired

            $result.state | Should -Be 'pending'
            $result.startsAt | Should -BeNullOrEmpty
        }
    }
}
