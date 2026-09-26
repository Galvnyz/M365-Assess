BeforeAll {
    $script:repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../../../')
    $script:worker   = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-IntunePolicies.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-intune-policies.ps1'

    # Stub Invoke-MgGraphRequest before dot-sourcing the worker.
    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-IntunePolicies worker (T-0301)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker     | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-IntunePolicies       -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-IntunePoliciesJob   -CommandType Function) | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Job envelope reading' {
        It 'throws when envelope does not exist' {
            { Read-IntunePoliciesJob -Path '/path/does/not/exist.json' } | Should -Throw '*not found*'
        }

        It 'throws when tenantId is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"kind":"configuration"}'
            try {
                { Read-IntunePoliciesJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'tenantId'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws when kind is missing' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1"}'
            try {
                { Read-IntunePoliciesJob -Path $tmp.FullName } | Should -Throw "*missing mandatory 'kind'*"
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'throws for an unknown kind' {
            $tmp = New-TemporaryFile
            Set-Content -LiteralPath $tmp.FullName -Value '{"tenantId":"t-1","kind":"scripts"}'
            try {
                { Read-IntunePoliciesJob -Path $tmp.FullName } | Should -Throw '*unknown kind*'
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }

        It 'parses a valid envelope with all fields' {
            $tmp = New-TemporaryFile
            $envelope = @{
                tenantId     = 'tenant-123'
                kind         = 'compliance'
                platform     = 'windows'
                search       = 'baseline'
                top          = 50
            } | ConvertTo-Json
            Set-Content -LiteralPath $tmp.FullName -Value $envelope
            try {
                $job = Read-IntunePoliciesJob -Path $tmp.FullName
                $job.TenantId | Should -Be 'tenant-123'
                $job.Kind     | Should -Be 'compliance'
                $job.Search   | Should -Be 'baseline'
                $job.Top      | Should -Be 50
            }
            finally {
                Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Configuration policy listing (windows, supported)' {
        It 'returns a paged list of configuration policies with assignment counts' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                $Method | Should -Be 'GET'
                $Uri | Should -BeLike '*configurationPolicies*'

                return [pscustomobject]@{
                    value = @(
                        [pscustomobject]@{
                            id                   = 'pol-cfg-1'
                            name                 = 'Windows Security Baseline'
                            platforms            = 'windows10'
                            lastModifiedDateTime = '2026-09-20T10:00:00Z'
                            createdBy            = [pscustomobject]@{
                                userPrincipalName = 'admin@contoso.com'
                            }
                            assignments = @(
                                [pscustomobject]@{
                                    id     = 'asgn-1'
                                    target = [pscustomobject]@{
                                        '@odata.type' = '#microsoft.graph.allDevicesAssignmentTarget'
                                    }
                                }
                            )
                        },
                        [pscustomobject]@{
                            id                   = 'pol-cfg-2'
                            name                 = 'BitLocker Policy'
                            platforms            = 'windows10'
                            lastModifiedDateTime = '2026-09-21T08:30:00Z'
                            createdBy            = [pscustomobject]@{
                                userPrincipalName = 'operator@contoso.com'
                            }
                            assignments = @(
                                [pscustomobject]@{
                                    id     = 'asgn-2'
                                    target = [pscustomobject]@{
                                        '@odata.type' = '#microsoft.graph.groupAssignmentTarget'
                                        groupId       = 'grp-123'
                                    }
                                }
                            )
                        }
                    )
                }
            }

            $res = Get-IntunePolicies -TenantId 'tenant-test' -Kind 'configuration'
            $res.tenantId   | Should -Be 'tenant-test'
            $res.kind       | Should -Be 'configuration'
            $res.totalCount | Should -Be 2

            $pol1 = $res.items[0]
            $pol1.id                   | Should -Be 'pol-cfg-1'
            $pol1.displayName          | Should -Be 'Windows Security Baseline'
            $pol1.policyType           | Should -Be 'Configuration Policy'
            $pol1.assignedToCount      | Should -Be 1
            $pol1.modifiedBy           | Should -Be 'admin@contoso.com'
            $pol1.lastModifiedDateTime | Should -Be '2026-09-20T10:00:00Z'
            $pol1.assignments[0].target | Should -Be 'All Devices'

            $pol2 = $res.items[1]
            $pol2.assignments[0].targetType | Should -Be 'groupAssignmentTarget'
        }
    }

    Context 'Compliance policy listing (windows, supported)' {
        It 'returns a paged list of compliance policies' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                $Uri | Should -BeLike '*deviceCompliancePolicies*'

                return [pscustomobject]@{
                    value = @(
                        [pscustomobject]@{
                            id                   = 'pol-cmp-1'
                            displayName          = 'Windows 10 Compliance'
                            platform             = 'windows10AndLater'
                            lastModifiedDateTime = '2026-09-22T14:00:00Z'
                            assignments          = @()
                        }
                    )
                }
            }

            $res = Get-IntunePolicies -TenantId 'tenant-test' -Kind 'compliance'
            $res.kind       | Should -Be 'compliance'
            $res.totalCount | Should -Be 1
            $res.items[0].policyType | Should -Be 'Compliance Policy'
        }
    }

    Context 'Unsupported kind' {
        It 'returns a structured unsupported error for app-protection' {
            $res = Get-IntunePolicies -TenantId 'tenant-test' -Kind 'app-protection'
            $res.error      | Should -Be 'intune.kind.unsupported'
            $res.statusCode | Should -Be 501
        }
    }

    Context 'Search filter' {
        It 'filters policies client-side by display name substring' {
            Mock Invoke-MgGraphRequest {
                return [pscustomobject]@{
                    value = @(
                        [pscustomobject]@{ id = 'p1'; name = 'Security Baseline'; assignments = @() },
                        [pscustomobject]@{ id = 'p2'; name = 'BitLocker Policy'; assignments = @() },
                        [pscustomobject]@{ id = 'p3'; name = 'Security Antivirus'; assignments = @() }
                    )
                }
            }

            $res = Get-IntunePolicies -TenantId 'tenant-test' -Kind 'configuration' -Search 'Security'
            $res.totalCount | Should -Be 2
            $res.items | ForEach-Object { $_.displayName | Should -BeLike '*Security*' }
        }
    }

    Context 'Empty result' {
        It 'handles gracefully when no policies are returned' {
            Mock Invoke-MgGraphRequest {
                return [pscustomobject]@{ value = @() }
            }

            $res = Get-IntunePolicies -TenantId 'tenant-test' -Kind 'configuration'
            $res.totalCount | Should -Be 0
            $res.items.Count | Should -Be 0
        }
    }
}
