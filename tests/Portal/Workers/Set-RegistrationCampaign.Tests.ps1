BeforeAll {
    $script:WorkersRoot = Join-Path -Path $PSScriptRoot -ChildPath '../../../portal/workers'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body, $ContentType)
    }

    . (Join-Path -Path $script:WorkersRoot -ChildPath 'M365Portal.Workers/Set-RegistrationCampaign.ps1')
}

Describe 'Set-RegistrationCampaign worker (T-0226)' {
    Context 'Read-RegistrationCampaignJob' {
        It 'reads a valid job envelope' {
            $tmp = New-TemporaryFile
            try {
                @{
                    tenantId             = 'tenant-x'
                    state                = 'enabled'
                    snoozeDurationInDays = 3
                    includeTargets       = @('grp-1')
                    excludeTargets       = @('grp-2')
                    confirmed            = $true
                } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp.FullName -Encoding utf8

                $job = Read-RegistrationCampaignJob -Path $tmp.FullName
                $job.TenantId | Should -Be 'tenant-x'
                $job.State | Should -Be 'enabled'
                $job.SnoozeDurationInDays | Should -Be 3
                $job.IncludeTargets | Should -Contain 'grp-1'
                $job.ExcludeTargets | Should -Contain 'grp-2'
                $job.Confirmed | Should -BeTrue
            } finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws when tenantId is missing' {
            $tmp = New-TemporaryFile
            try {
                @{ state = 'enabled' } | ConvertTo-Json | Set-Content -LiteralPath $tmp.FullName -Encoding utf8
                { Read-RegistrationCampaignJob -Path $tmp.FullName } | Should -Throw '*TenantId*'
            } finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Get-TenantRegistrationCampaign' {
        It 'reads campaign state from Graph policy' {
            Mock Invoke-MgGraphRequest {
                return [pscustomobject]@{
                    registrationEnforcement = [pscustomobject]@{
                        authenticationMethodsRegistrationCampaign = [pscustomobject]@{
                            state                = 'enabled'
                            snoozeDurationInDays = 2
                            includeTargets       = @([pscustomobject]@{ id = 'g-inc' })
                            excludeTargets       = @([pscustomobject]@{ id = 'g-exc' })
                        }
                    }
                }
            } -ParameterFilter { $Method -eq 'GET' }

            $res = Get-TenantRegistrationCampaign -TenantId 'tenant-x'
            $res.tenantId | Should -Be 'tenant-x'
            $res.state | Should -Be 'enabled'
            $res.snoozeDurationInDays | Should -Be 2
            $res.includeTargets | Should -Contain 'g-inc'
            $res.excludeTargets | Should -Contain 'g-exc'
        }
    }

    Context 'Invoke-RegistrationCampaignSet' {
        It 'refuses to apply without Confirmed' {
            {
                Invoke-RegistrationCampaignSet -TenantId 'tenant-x' -State 'enabled'
            } | Should -Throw '*Confirmed*'
        }

        It 'calls Graph PATCH with registrationEnforcement payload' {
            $script:lastBody = $null
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body, $ContentType)
                $script:lastBody = $Body | ConvertFrom-Json
                return $null
            } -ParameterFilter { $Method -eq 'PATCH' }

            $res = Invoke-RegistrationCampaignSet -TenantId 'tenant-x' -State 'enabled' -SnoozeDurationInDays 5 -IncludeTargets @('grp-a') -ExcludeTargets @('grp-b') -Confirmed

            $res.status | Should -Be 'succeeded'
            $res.state | Should -Be 'enabled'
            $res.snoozeDurationInDays | Should -Be 5
            Assert-MockCalled Invoke-MgGraphRequest -Times 1 -ParameterFilter { $Method -eq 'PATCH' }
            $script:lastBody.registrationEnforcement.authenticationMethodsRegistrationCampaign.state | Should -Be 'enabled'
            $script:lastBody.registrationEnforcement.authenticationMethodsRegistrationCampaign.snoozeDurationInDays | Should -Be 5
        }
    }
}
