BeforeAll {
    $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $script:worker = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Get-Groups.ps1'
    $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/get-groups.ps1'

    function global:Invoke-MgGraphRequest {
        param($Method, $Uri, $Body)
    }

    . $script:worker
}

Describe 'Get-Groups worker (T-0261)' {

    Context 'the worker files' {
        It 'ships the worker functions and the entrypoint' {
            Test-Path -LiteralPath $script:worker | Should -BeTrue
            Test-Path -LiteralPath $script:entrypoint | Should -BeTrue
            (Get-Command Get-Groups -CommandType Function) | Should -Not -BeNullOrEmpty
            (Get-Command Read-GroupsJob -CommandType Function) | Should -Not -BeNullOrEmpty
        }

        It 'is read-only: issues GET requests and no POST/DELETE/PATCH' {
            $source = Get-Content -LiteralPath $script:worker -Raw
            $source | Should -Match 'Invoke-MgGraphRequest -Method GET'
            $source | Should -Not -Match '-Method POST'
            $source | Should -Not -Match '-Method DELETE'
            $source | Should -Not -Match '-Method PATCH'
        }
    }

    Context 'Get-Groups live mapping and type discrimination' {
        BeforeEach {
            Mock Invoke-MgGraphRequest {
                param($Method, $Uri, $Body)
                return @{
                    value = @(
                        @{
                            id = 'grp-m365'
                            displayName = 'All Company Team'
                            description = 'Company wide M365 group'
                            groupTypes = @('Unified')
                            mailEnabled = $true
                            securityEnabled = $true
                            mail = 'allcompany@contoso.com'
                            membershipRule = $null
                            hideFromAddressLists = $false
                            requireSenderAuthenticationEnabled = $false
                            'members@odata.count' = 15
                            'owners@odata.count' = 2
                        }
                        @{
                            id = 'grp-sec'
                            displayName = 'SG-Tier1-Admins'
                            description = 'Security group for tier 1 admins'
                            groupTypes = @()
                            mailEnabled = $false
                            securityEnabled = $true
                            mail = $null
                            membershipRule = $null
                            hideFromAddressLists = $true
                            requireSenderAuthenticationEnabled = $false
                            'members@odata.count' = 5
                            'owners@odata.count' = 1
                        }
                        @{
                            id = 'grp-dist'
                            displayName = 'Finance Distro'
                            description = 'Distribution group for finance'
                            groupTypes = @()
                            mailEnabled = $true
                            securityEnabled = $false
                            mail = 'finance@contoso.com'
                            membershipRule = $null
                            hideFromAddressLists = $false
                            requireSenderAuthenticationEnabled = $true
                            'members@odata.count' = 0
                            'owners@odata.count' = 1
                        }
                        @{
                            id = 'grp-dyn'
                            displayName = 'Dynamic Engineering'
                            description = 'Engineering department dynamic'
                            groupTypes = @('DynamicMembership')
                            mailEnabled = $false
                            securityEnabled = $true
                            mail = $null
                            membershipRule = '(user.department -eq "Engineering")'
                            hideFromAddressLists = $false
                            requireSenderAuthenticationEnabled = $false
                            'members@odata.count' = 60
                            'owners@odata.count' = 2
                        }
                    )
                }
            }
        }

        It 'returns all groups with type, counts, and flags' {
            $result = Get-Groups -TenantId 'tenant-test'
            $result.tenantId | Should -Be 'tenant-test'
            $result.totalCount | Should -Be 4
            $result.items.Count | Should -Be 4

            $m365 = $result.items | Where-Object { $_.id -eq 'grp-m365' }
            $m365.type | Should -Be 'm365'
            $m365.membershipCount | Should -Be 15
            $m365.ownerCount | Should -Be 2
            $m365.hiddenFromAddressListsEnabled | Should -BeFalse
            $m365.isDynamic | Should -BeFalse

            $sec = $result.items | Where-Object { $_.id -eq 'grp-sec' }
            $sec.type | Should -Be 'security'
            $sec.membershipCount | Should -Be 5
            $sec.hiddenFromAddressListsEnabled | Should -BeTrue

            $dist = $result.items | Where-Object { $_.id -eq 'grp-dist' }
            $dist.type | Should -Be 'distribution'
            $dist.deliveryManagementEnabled | Should -BeTrue

            $dyn = $result.items | Where-Object { $_.id -eq 'grp-dyn' }
            $dyn.type | Should -Be 'dynamic'
            $dyn.isDynamic | Should -BeTrue
            $dyn.dynamicRule | Should -Be '(user.department -eq "Engineering")'
        }

        It 'filters by type' {
            $result = Get-Groups -TenantId 'tenant-test' -Type 'distribution'
            $result.totalCount | Should -Be 1
            $result.items[0].id | Should -Be 'grp-dist'
        }

        It 'filters by hidden' {
            $result = Get-Groups -TenantId 'tenant-test' -Hidden 'true'
            $result.totalCount | Should -Be 1
            $result.items[0].id | Should -Be 'grp-sec'
        }

        It 'filters by dynamic' {
            $result = Get-Groups -TenantId 'tenant-test' -Dynamic 'true'
            $result.totalCount | Should -Be 1
            $result.items[0].id | Should -Be 'grp-dyn'
        }

        It 'filters by membershipSize' {
            $empty = Get-Groups -TenantId 'tenant-test' -MembershipSize 'empty'
            $empty.totalCount | Should -Be 1
            $empty.items[0].id | Should -Be 'grp-dist'

            $large = Get-Groups -TenantId 'tenant-test' -MembershipSize 'large'
            $large.totalCount | Should -Be 1
            $large.items[0].id | Should -Be 'grp-dyn'
        }

        It 'filters by search term' {
            $result = Get-Groups -TenantId 'tenant-test' -Search 'finance'
            $result.totalCount | Should -Be 1
            $result.items[0].id | Should -Be 'grp-dist'
        }
    }
}
