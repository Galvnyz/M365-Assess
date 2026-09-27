BeforeAll {
    $script:repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../../../')
    $script:worker   = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-IntunePolicies.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-intune-policies.ps1'

    # Stub Invoke-MgGraphRequest before dot-sourcing the worker.
    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
    . (Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Connect-WorkerTenant.ps1')
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

    Context 'List filters (T-0812)' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                return @{
                    value = @(
                        @{ id = 'p1'; displayName = 'Win Baseline'; platform = 'windows10'; lastModifiedDateTime = '2026-09-10T10:00:00Z'; assignments = @(@{ id = 'a1'; target = @{ '@odata.type' = '#microsoft.graph.allDevicesAssignmentTarget' } }) },
                        @{ id = 'p2'; displayName = 'iOS Baseline'; platform = 'iOS'; lastModifiedDateTime = '2026-09-20T10:00:00Z'; assignments = @() },
                        @{ id = 'p3'; displayName = 'Win Legacy'; platform = 'windows10'; lastModifiedDateTime = '2026-08-01T10:00:00Z'; assignments = @() },
                        @{ id = 'p4'; displayName = 'No date'; platform = 'windows10'; assignments = @() }
                    )
                }
            }
        }

        It 'filters by platform prefix, case-insensitively' {
            $res = Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Platform 'windows'
            @($res.items.id) | Should -Be @('p1', 'p3', 'p4')
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Platform 'ios').items.id | Should -Be 'p2'
        }

        It 'filters by policy type' {
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -PolicyType 'compliance policy').totalCount | Should -Be 4
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -PolicyType 'Configuration Policy').totalCount | Should -Be 0
        }

        It 'filters by assignment state' {
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Assigned 'true').items.id | Should -Be 'p1'
            @((Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Assigned 'false').items.id) | Should -Be @('p2', 'p3', 'p4')
        }

        It 'keeps policies modified on or after the date and drops undated ones' {
            @((Get-IntunePolicies -TenantId 't' -Kind 'compliance' -ModifiedDate '2026-09-10').items.id) | Should -Be @('p1', 'p2')
        }

        It 'rejects an invalid modified date' {
            { Get-IntunePolicies -TenantId 't' -Kind 'compliance' -ModifiedDate 'last tuesday' } | Should -Throw '*not a valid date*'
        }

        It 'treats search text literally, not as a wildcard pattern' {
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Search '*').totalCount | Should -Be 0
            @((Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Search 'baseline').items.id) | Should -Be @('p1', 'p2')
        }

        It 'combines filters' {
            (Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Platform 'windows' -Assigned 'false' -Search 'legacy').items.id | Should -Be 'p3'
        }
    }

    Context 'Paging after filtering (T-0812)' {
        It 'follows Graph nextLink pages before filtering' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                if ($Uri -like '*page2*') {
                    return @{ value = @(@{ id = 'p3'; displayName = 'Win C'; assignments = @() }) }
                }
                return @{
                    value             = @(@{ id = 'p1'; displayName = 'Win A'; assignments = @() }, @{ id = 'p2'; displayName = 'Other'; assignments = @() })
                    '@odata.nextLink' = 'https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies?page2'
                }
            }
            $res = Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Search 'Win'
            @($res.items.id) | Should -Be @('p1', 'p3')
            Should -Invoke Invoke-MgGraphRequest -Times 2
        }

        It 'pages the filtered set with an offset cursor' {
            Mock Invoke-MgGraphRequest {
                return @{ value = @(1..5 | ForEach-Object { @{ id = "p$_"; displayName = "Win $_"; assignments = @() } }) + @(@{ id = 'x'; displayName = 'Other'; assignments = @() }) }
            }
            $first = Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Search 'Win' -Top 2
            @($first.items.id) | Should -Be @('p1', 'p2')
            $first.totalCount | Should -Be 5
            $first.nextCursor | Should -Be '2'
            $last = Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Search 'Win' -Top 2 -Cursor '4'
            @($last.items.id) | Should -Be @('p5')
            $last.nextCursor | Should -BeNullOrEmpty
            { Get-IntunePolicies -TenantId 't' -Kind 'compliance' -Cursor 'abc' } | Should -Throw '*cursor*'
        }
    }

    Context 'Entrypoint (T-0812)' {
        It 'reads every filter from the envelope and passes it through' {
            # Tenant sign-in is Connect-WorkerTenant's concern (T-0826); stub it here.
            Mock Connect-WorkerTenant { $null }
            Mock Disconnect-WorkerTenant { }
            Mock Invoke-MgGraphRequest {
                return @{ value = @(
                        @{ id = 'p1'; displayName = 'Win A'; platform = 'windows10'; lastModifiedDateTime = '2026-09-20T00:00:00Z'; assignments = @(@{ id = 'a'; target = @{ '@odata.type' = '#microsoft.graph.allDevicesAssignmentTarget' } }) },
                        @{ id = 'p2'; displayName = 'Win B'; platform = 'windows10'; lastModifiedDateTime = '2026-09-20T00:00:00Z'; assignments = @() }
                    ) }
            }
            $path = Join-Path $TestDrive 'job.json'
            @{ tenantId = 't'; kind = 'compliance'; platform = 'windows'; policyType = 'Compliance Policy'; assigned = $true; modifiedDate = '2026-09-01'; search = 'win'; top = 10 } |
                ConvertTo-Json | Set-Content -LiteralPath $path
            $job = Read-IntunePoliciesJob -Path $path
            $job.Assigned | Should -Be 'true'
            $out = & $script:entrypoint -JobFile $path | ConvertFrom-Json
            @($out.items.id) | Should -Be @('p1')
        }
    }

    Context 'Policy detail for compare (T-0820)' {
        It 'returns the configuration body without identity fields, with settings and assignments' {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri)
                $Uri | Should -BeLike '*/configurationPolicies/p-1?$expand=settings,assignments'
                return @{
                    id                   = 'p-1'
                    name                 = 'Defender'
                    platforms            = 'windows10'
                    lastModifiedDateTime = '2026-09-20T00:00:00Z'
                    'settings@odata.context' = 'x'
                    settings             = @(@{ settingInstance = @{ settingDefinitionId = 'a' } })
                    assignments          = @(@{ target = @{ '@odata.type' = '#microsoft.graph.allDevicesAssignmentTarget' } })
                }
            }
            $detail = Get-IntunePolicyDetail -Kind configuration -PolicyId 'p-1'
            $detail.id | Should -Be 'p-1'
            $detail.displayName | Should -Be 'Defender'
            $detail.body.Keys | Sort-Object | Should -Be @('name', 'platforms', 'settings')
            @($detail.assignments).Count | Should -Be 1
        }

        It 'expands only assignments for compliance policies' {
            Mock Invoke-MgGraphRequest { param($Method, $Uri) $Uri | Should -BeLike '*deviceCompliancePolicies/c-1?$expand=assignments'; @{ id = 'c-1'; displayName = 'C'; passwordRequired = $true } }
            (Get-IntunePolicyDetail -Kind compliance -PolicyId 'c-1').body.passwordRequired | Should -BeTrue
        }

        It 'returns null for a policy that does not exist' {
            Mock Invoke-MgGraphRequest { throw 'Response status code does not indicate success: NotFound (Not Found).' }
            Get-IntunePolicyDetail -Kind compliance -PolicyId 'gone' | Should -BeNullOrEmpty
        }

        It 'serves a detail read through the entrypoint when the job names a policy' {
            Mock Connect-WorkerTenant { $null }
            Mock Disconnect-WorkerTenant { }
            Mock Invoke-MgGraphRequest { @{ id = 'c-1'; displayName = 'C'; passwordRequired = $true } }
            $path = Join-Path $TestDrive 'detail.json'
            @{ tenantId = 't'; kind = 'compliance'; policyId = 'c-1' } | ConvertTo-Json | Set-Content -LiteralPath $path
            $out = & $script:entrypoint -JobFile $path | ConvertFrom-Json
            $out.id | Should -Be 'c-1'
            $out.body.passwordRequired | Should -BeTrue
        }
    }
}
