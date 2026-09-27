BeforeAll {
    $script:WorkersRoot = Join-Path -Path $PSScriptRoot -ChildPath '../../../portal/workers'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body, $ContentType)
    }

    . (Join-Path -Path $script:WorkersRoot -ChildPath 'M365Portal.Workers/Set-AuthMethodsPolicy.ps1')
}

Describe 'Set-AuthMethodsPolicy worker (T-0225)' {
    Context 'Read-AuthMethodsPolicyJob' {
        It 'reads a valid job envelope' {
            $tmp = New-TemporaryFile
            try {
                @{
                    tenantId  = 'tenant-x'
                    policy    = @{
                        methods = @(
                            @{ id = 'fido2'; state = 'enabled' }
                        )
                    }
                    dryRun    = $true
                    confirmed = $false
                } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp.FullName -Encoding utf8

                $job = Read-AuthMethodsPolicyJob -Path $tmp.FullName
                $job.TenantId | Should -Be 'tenant-x'
                $job.DryRun | Should -BeTrue
                $job.Confirmed | Should -BeFalse
            } finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws when tenantId is missing' {
            $tmp = New-TemporaryFile
            try {
                @{ policy = @{} } | ConvertTo-Json | Set-Content -LiteralPath $tmp.FullName -Encoding utf8
                { Read-AuthMethodsPolicyJob -Path $tmp.FullName } | Should -Throw '*TenantId*'
            } finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Get-TenantAuthMethodsPolicy' {
        It 'throws when Graph fails instead of reporting every method disabled' {
            Mock Invoke-MgGraphRequest { throw 'Graph 403: Forbidden' } -ParameterFilter { $Method -eq 'GET' }
            { Get-TenantAuthMethodsPolicy -TenantId 'tenant-x' } | Should -Throw '*403*'
        }

        It 'refuses to apply when the current policy cannot be read' {
            Mock Invoke-MgGraphRequest { throw 'Graph 403: Forbidden' } -ParameterFilter { $Method -eq 'GET' }
            Mock Invoke-MgGraphRequest { } -ParameterFilter { $Method -eq 'PATCH' }
            $policy = @{ methods = @(@{ id = 'fido2'; state = 'enabled' }) }
            { Invoke-AuthMethodsPolicyApply -TenantId 'tenant-x' -Policy $policy -Confirmed } | Should -Throw '*403*'
            Should -Invoke Invoke-MgGraphRequest -ParameterFilter { $Method -eq 'PATCH' } -Times 0 -Exactly
        }
    }

    Context 'Invoke-AuthMethodsPolicyApply' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                return [pscustomobject]@{
                    value = @(
                        [pscustomobject]@{ id = 'fido2'; state = 'disabled' },
                        [pscustomobject]@{ id = 'voice'; state = 'enabled' }
                    )
                }
            } -ParameterFilter { $Method -eq 'GET' }

            Mock Invoke-MgGraphRequest {
                return $null
            } -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'refuses to apply without Confirmed when DryRun is false' {
            $policy = @{
                methods = @(
                    @{ id = 'fido2'; state = 'enabled' }
                )
            }
            { Invoke-AuthMethodsPolicyApply -TenantId 'tenant-x' -Policy $policy } | Should -Throw '*Confirmed*'
        }

        It 'computes diff and makes no Graph PATCH on DryRun' {
            $policy = @{
                methods = @(
                    @{ id = 'fido2'; state = 'enabled' }
                )
            }
            $result = Invoke-AuthMethodsPolicyApply -TenantId 'tenant-x' -Policy $policy -DryRun
            $result.status | Should -Be 'succeeded'
            $result.dryRun | Should -BeTrue
            $result.diff.Count | Should -Be 1
            $result.diff[0].id | Should -Be 'fido2'
            $result.diff[0].before | Should -Be 'disabled'
            $result.diff[0].after | Should -Be 'enabled'

            Assert-MockCalled Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Method -eq 'PATCH' }
        }

        It 'applies changed methods and calls PATCH when Confirmed' {
            $policy = @{
                methods = @(
                    @{ id = 'fido2'; state = 'enabled' }
                )
            }
            $result = Invoke-AuthMethodsPolicyApply -TenantId 'tenant-x' -Policy $policy -Confirmed
            $result.status | Should -Be 'succeeded'
            $result.dryRun | Should -BeFalse
            $result.diff.Count | Should -Be 1

            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'PATCH' }
        }
    }
}
