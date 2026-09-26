BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-CaPolicies.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-ca-policies.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-CaPolicies worker (T-0281)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-CaPolicies -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-CaPoliciesJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'is read-only: issues GET requests and no POST/DELETE/PATCH' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest @graphParams'
            $source | Should -Match "Method\s*=\s*'GET'"
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match '-Method PATCH'
        }
    }

    Context 'Get-CaPolicies live mapping and projection' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{
                    value = @(
                        @{
                            id = 'ca-001'
                            displayName = 'Require MFA for Admins'
                            state = 'enabled'
                            conditions = @{
                                users = @{
                                    includeRoles = @('62e90394-69f5-4237-9190-012177145e10')
                                    excludeUsers = @('breakglass@contoso.com')
                                }
                                applications = @{
                                    includeApplications = @('All')
                                }
                                clientAppTypes = @('all')
                                locations = @{
                                    includeLocations = @('All')
                                    excludeLocations = @('AllTrusted')
                                }
                            }
                            grantControls = @{
                                operator = 'OR'
                                builtInControls = @('mfa')
                            }
                            createdDateTime = '2026-01-15T10:00:00Z'
                            modifiedDateTime = '2026-09-20T12:00:00Z'
                            modifiedBy = 'admin@contoso.com'
                        }
                        @{
                            id = 'ca-002'
                            displayName = 'Block Legacy Authentication'
                            state = 'enabledForReportingButNotEnforced'
                            conditions = @{
                                users = @{
                                    includeUsers = @('All')
                                }
                                applications = @{
                                    includeApplications = @('All')
                                }
                                clientAppTypes = @('exchangeActiveSync', 'other')
                            }
                            grantControls = @{
                                operator = 'OR'
                                builtInControls = @('block')
                            }
                            createdDateTime = '2026-02-01T10:00:00Z'
                            modifiedDateTime = '2026-09-22T14:30:00Z'
                            modifiedBy = 'secops@contoso.com'
                        }
                        @{
                            id = 'ca-003'
                            displayName = 'Compliant Devices for Salesforce'
                            state = 'disabled'
                            conditions = @{
                                users = @{
                                    includeGroups = @('grp-sales')
                                }
                                applications = @{
                                    includeApplications = @('app-salesforce')
                                }
                                platforms = @{
                                    includePlatforms = @('windows', 'macOS')
                                }
                            }
                            grantControls = @{
                                operator = 'AND'
                                builtInControls = @('compliantDevice')
                            }
                            createdDateTime = '2026-03-01T10:00:00Z'
                            modifiedDateTime = '2026-08-10T09:00:00Z'
                            modifiedBy = 'helpdesk@contoso.com'
                        }
                    )
                }
            }
        }

        It 'projects state, targets, controls, conditions, and modification info' {
            $res = Get-CaPolicies -TenantId 'tenant-test'
            $res.totalCount | Should -Be 3
            $res.items.Count | Should -Be 3

            $item1 = $res.items | Where-Object { $_.id -eq 'ca-001' }
            $item1.name | Should -Be 'Require MFA for Admins'
            $item1.state | Should -Be 'enabled'
            $item1.usersTargeted.summary | Should -Match '1 roles'
            $item1.usersTargeted.summary | Should -Match 'excludes 1'
            $item1.apps.summary | Should -Be 'All cloud apps'
            $item1.grantControls.summary | Should -Be 'Grant: mfa'
            $item1.conditions.summary | Should -Match 'Locations'
            $item1.modifiedDateTime | Should -Be '2026-09-20T12:00:00Z'
            $item1.modifiedBy | Should -Be 'admin@contoso.com'

            $item2 = $res.items | Where-Object { $_.id -eq 'ca-002' }
            $item2.state | Should -Be 'enabledForReportingButNotEnforced'
            $item2.grantControls.summary | Should -Be 'Block'
        }

        It 'filters by state' {
            $on = Get-CaPolicies -TenantId 'tenant-test' -State 'enabled'
            $on.totalCount | Should -Be 1
            $on.items[0].id | Should -Be 'ca-001'

            $ro = Get-CaPolicies -TenantId 'tenant-test' -State 'report-only'
            $ro.totalCount | Should -Be 1
            $ro.items[0].id | Should -Be 'ca-002'

            $off = Get-CaPolicies -TenantId 'tenant-test' -State 'disabled'
            $off.totalCount | Should -Be 1
            $off.items[0].id | Should -Be 'ca-003'
        }

        It 'filters by target' {
            $res = Get-CaPolicies -TenantId 'tenant-test' -Target 'salesforce'
            $res.totalCount | Should -Be 1
            $res.items[0].id | Should -Be 'ca-003'

            $resRoles = Get-CaPolicies -TenantId 'tenant-test' -Target 'roles'
            $resRoles.totalCount | Should -Be 1
            $resRoles.items[0].id | Should -Be 'ca-001'
        }

        It 'filters by control' {
            $mfa = Get-CaPolicies -TenantId 'tenant-test' -Control 'mfa'
            $mfa.totalCount | Should -Be 1
            $mfa.items[0].id | Should -Be 'ca-001'

            $block = Get-CaPolicies -TenantId 'tenant-test' -Control 'block'
            $block.totalCount | Should -Be 1
            $block.items[0].id | Should -Be 'ca-002'
        }

        It 'filters by condition' {
            $loc = Get-CaPolicies -TenantId 'tenant-test' -Condition 'locations'
            $loc.totalCount | Should -Be 1
            $loc.items[0].id | Should -Be 'ca-001'

            $plat = Get-CaPolicies -TenantId 'tenant-test' -Condition 'platforms'
            $plat.totalCount | Should -Be 1
            $plat.items[0].id | Should -Be 'ca-003'
        }

        It 'filters by modifiedDate' {
            $sept = Get-CaPolicies -TenantId 'tenant-test' -ModifiedDate '2026-09'
            $sept.totalCount | Should -Be 2

            $aug = Get-CaPolicies -TenantId 'tenant-test' -ModifiedDate '2026-08'
            $aug.totalCount | Should -Be 1
            $aug.items[0].id | Should -Be 'ca-003'
        }

        It 'searches by name or id' {
            $search = Get-CaPolicies -TenantId 'tenant-test' -Search 'Legacy'
            $search.totalCount | Should -Be 1
            $search.items[0].id | Should -Be 'ca-002'
        }

        It 'supports cursor pagination' {
            $page1 = Get-CaPolicies -TenantId 'tenant-test' -Top 2
            $page1.items.Count | Should -Be 2
            $page1.nextCursor | Should -Not -BeNullOrEmpty

            $page2 = Get-CaPolicies -TenantId 'tenant-test' -Top 2 -Cursor $page1.nextCursor
            $page2.items.Count | Should -Be 1
            $page2.items[0].id | Should -Be 'ca-003'
            $page2.nextCursor | Should -BeNullOrEmpty
        }
    }

    Context 'entrypoint job envelope' {
        It 'executes through the get-ca-policies.ps1 entrypoint' {
            Mock Invoke-MgGraphRequest {
                return @{
                    value = @(
                        @{
                            id = 'ca-test'
                            displayName = 'Test Policy'
                            state = 'enabled'
                        }
                    )
                }
            }

            $tempFile = [System.IO.Path]::GetTempFileName()
            try {
                @{
                    tenantId = 'tenant-xyz'
                    search = 'Test'
                } | ConvertTo-Json | Set-Content -LiteralPath $tempFile

                $jsonOutput = & $script:entrypoint -JobFile $tempFile
                $parsed = $jsonOutput | ConvertFrom-Json
                $parsed.tenantId | Should -Be 'tenant-xyz'
                $parsed.totalCount | Should -Be 1
                $parsed.items[0].id | Should -Be 'ca-test'
            }
            finally {
                Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
